/**
 * Container Runner for cli-claw
 * Spawns agent execution in Docker container and handles IPC
 */
import {
  ChildProcess,
  exec,
  execFile,
  execFileSync,
  spawn,
} from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import {
  APP_ROOT,
  LAUNCH_CWD,
  isInstalledNodeModulesPackageRoot,
  resolveAppPath,
} from './app-root.js';

import { CONTAINER_IMAGE, DATA_DIR, GROUPS_DIR } from './config.js';
import { logger } from './logger.js';
import {
  loadMountAllowlist,
  validateAdditionalMounts,
} from './mount-security.js';
import {
  buildContainerEnvLines,
  getClaudeProviderConfig,
  getContainerEnvConfig,
  getEnabledProviders,
  getBalancingConfig,
  getSystemSettings,
  mergeClaudeEnvConfig,
  resolveProviderById,
  shellQuoteEnvLines,
  writeCredentialsFile,
} from './runtime-config.js';
import { providerPool } from './provider-pool.js';
import { isApiError } from './agent-output-parser.js';
import type { ClaudeProviderConfig } from './runtime-config.js';
import { loadUserMcpServers } from './mcp-utils.js';
import {
  AgentType,
  MessageSourceKind,
  RegisteredGroup,
  RuntimeIdentity,
  StreamEvent,
} from './types.js';
import {
  attachStderrHandler,
  attachStdoutHandler,
  createStderrState,
  createStdoutParserState,
  formatUserFacingRuntimeError,
  handleNonZeroExit,
  handleSuccessClose,
  handleTimeoutClose,
  writeRunLog,
  type CloseHandlerContext,
} from './agent-output-parser.js';
import { getRuntimeBuildLogFields } from './runtime-build.js';

/**
 * Required env flags for settings.json — 每次容器/进程启动时强制写入，不可被用户覆盖。
 * 合并模式：仅覆盖这些 key，保留用户自定义的其他 key。
 */
const REQUIRED_SETTINGS_ENV: Record<string, string> = {
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0',
  CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
};

/** Read existing settings.json, deep-merge required env keys and mcpServers, write only if changed */
function ensureSettingsJson(
  settingsFile: string,
  mcpServers?: Record<string, Record<string, unknown>>,
): void {
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(settingsFile)) {
      existing = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    }
  } catch {
    /* ignore parse errors, overwrite */
  }

  const existingEnv = (existing.env as Record<string, string>) || {};
  const mergedEnv = { ...existingEnv, ...REQUIRED_SETTINGS_ENV };
  const merged: Record<string, unknown> = { ...existing, env: mergedEnv };

  // Merge user-configured MCP servers into settings
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    const existingMcp = (existing.mcpServers as Record<string, unknown>) || {};
    merged.mcpServers = { ...existingMcp, ...mcpServers };
  }

  const newContent = JSON.stringify(merged, null, 2) + '\n';

  // Only write when content actually changed
  try {
    if (fs.existsSync(settingsFile)) {
      const current = fs.readFileSync(settingsFile, 'utf8');
      if (current === newContent) return;
    }
  } catch {
    /* write anyway */
  }

  fs.writeFileSync(settingsFile, newContent, { mode: 0o644 });
}

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  agentType?: AgentType;
  model?: string | null;
  reasoningEffort?: string | null;
  /** @deprecated Use isHome + isAdminHome instead */
  isMain: boolean;
  turnId?: string;
  isHome?: boolean;
  isAdminHome?: boolean;
  isScheduledTask?: boolean;
  /** Isolated task run ID — determines IPC namespace (tasks-run/{taskRunId}/) */
  taskRunId?: string;
  images?: Array<{ data: string; mimeType?: string }>;
  agentId?: string;
  agentName?: string;
}

export interface ContainerOutput {
  status: 'success' | 'error' | 'stream' | 'closed';
  result: string | null;
  newSessionId?: string;
  error?: string;
  alreadyStreamedError?: boolean;
  runtimeIdentity?: RuntimeIdentity | null;
  streamEvent?: StreamEvent;
  turnId?: string;
  sessionId?: string;
  sdkMessageUuid?: string;
  sourceKind?: Exclude<MessageSourceKind, 'user_command'>;
  finalizationReason?: 'completed' | 'interrupted' | 'error';
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

function requireWorkspaceOwner(
  group: RegisteredGroup,
  context: string,
): string {
  if (!group.created_by) {
    throw new Error(
      `Workspace ${group.folder} is missing created_by; ${context} requires an owned workspace`,
    );
  }
  return group.created_by;
}

/**
 * Create directory with 0o777 permissions for container volume mounts.
 * Fixes uid mismatch between host user and container node user (uid 1000),
 * especially in rootless podman where uid remapping causes permission denied.
 */
function mkdirForContainer(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.chmodSync(dirPath, 0o777);
  } catch {
    // Ignore — may fail on read-only filesystem or special mounts
  }
}

interface ResolvedProvider {
  config: ClaudeProviderConfig;
  customEnv: Record<string, string>;
}

/**
 * Try to select a provider from the pool. Returns profileId + resolved config,
 * or null if pool mode is off (≤1 enabled) / group has provider override / selection fails.
 */
function trySelectPoolProvider(
  groupFolder: string,
): { profileId: string; resolved: ResolvedProvider } | null {
  const override = getContainerEnvConfig(groupFolder);
  const hasOverride = !!(
    override.anthropicApiKey ||
    override.anthropicAuthToken ||
    override.anthropicBaseUrl
  );
  if (hasOverride) return null;

  // Refresh pool state from V4 config
  const enabledProviders = getEnabledProviders();
  if (enabledProviders.length <= 1) return null; // No pool needed for 0-1 providers

  const balancing = getBalancingConfig();
  providerPool.refreshFromConfig(enabledProviders, balancing);

  try {
    const profileId = providerPool.selectProvider();
    const resolved = resolveProviderById(profileId);
    providerPool.acquireSession(profileId);
    return {
      profileId,
      resolved: { config: resolved.config, customEnv: resolved.customEnv },
    };
  } catch (err) {
    logger.warn(
      { err },
      'Provider pool selection failed, falling back to active profile',
    );
    return null;
  }
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isAdminHome: boolean,
  mountUserSkills = true,
  agentId?: string,
  ownerHomeFolder?: string,
  taskRunId?: string,
  resolvedProvider?: ResolvedProvider,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const packageRoot = APP_ROOT;
  const launchCwd = LAUNCH_CWD;

  // Per-user global memory directory:
  // Each user gets their own user-global/{userId}/ mounted as /workspace/global
  const ownerId = requireWorkspaceOwner(group, 'container mounts');
  const userGlobalDir = path.join(GROUPS_DIR, 'user-global', ownerId);
  mkdirForContainer(userGlobalDir);
  mounts.push({
    hostPath: userGlobalDir,
    containerPath: '/workspace/global',
    readonly: !group.is_home,
  });

  if (isAdminHome) {
    // Preserve the launch directory separately from packaged resources.
    // Admin home continues to see the operator's startup cwd as /workspace/project.
    mounts.push({
      hostPath: launchCwd,
      containerPath: '/workspace/project',
      readonly: false,
    });

    // Admin home also gets its group folder as the working directory
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    // Member home and non-home groups only get their own folder
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });
  }

  // Memory directory: home containers write their own; non-home containers read owner's home memory
  const memoryFolder = group.is_home
    ? group.folder
    : ownerHomeFolder || group.folder;
  const memoryDir = path.join(DATA_DIR, 'memory', memoryFolder);
  mkdirForContainer(memoryDir);
  mounts.push({
    hostPath: memoryDir,
    containerPath: '/workspace/memory',
    readonly: !group.is_home,
  });

  // Per-group Claude sessions directory (isolated from other groups)
  // Sub-agents get their own session dir under agents/{agentId}/.claude/
  const groupSessionsDir = agentId
    ? path.join(
        DATA_DIR,
        'sessions',
        group.folder,
        'agents',
        agentId,
        '.claude',
      )
    : path.join(DATA_DIR, 'sessions', group.folder, '.claude');
  mkdirForContainer(groupSessionsDir);
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  const mcpServers = ownerId ? loadUserMcpServers(ownerId) : {};
  ensureSettingsJson(settingsFile, mcpServers);

  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  // Skills：以只读卷挂载宿主机目录（由 entrypoint 创建符号链接）
  // 用户的所有 skills 在其所有工作区中全量生效
  const projectSkillsDir = path.join(packageRoot, 'container', 'skills');
  const userSkillsDir =
    mountUserSkills && ownerId ? path.join(DATA_DIR, 'skills', ownerId) : null;

  // Ensure user skills directory exists so it can always be mounted.
  // Skills may be installed after the group is created; without pre-creating,
  // the existsSync check would skip mounting and the container would never see them.
  if (userSkillsDir) {
    fs.mkdirSync(userSkillsDir, { recursive: true });
  }

  // 全量挂载：用户的所有 skills 在所有工作区中生效
  if (fs.existsSync(projectSkillsDir)) {
    mounts.push({
      hostPath: projectSkillsDir,
      containerPath: '/workspace/project-skills',
      readonly: true,
    });
  }
  if (userSkillsDir) {
    mounts.push({
      hostPath: userSkillsDir,
      containerPath: '/workspace/user-skills',
      readonly: true,
    });
  }

  // Per-group IPC namespace: each group gets its own IPC directory
  // Sub-agents get their own IPC subdirectory under agents/{agentId}/
  // Isolated tasks get their own IPC subdirectory under tasks-run/{taskRunId}/
  // Use 0o777 so container (node/1000) and host (agent/1002) can both read/write.
  const groupIpcDir = agentId
    ? path.join(DATA_DIR, 'ipc', group.folder, 'agents', agentId)
    : taskRunId
      ? path.join(DATA_DIR, 'ipc', group.folder, 'tasks-run', taskRunId)
      : path.join(DATA_DIR, 'ipc', group.folder);
  mkdirForContainer(groupIpcDir);
  // All agents (main + sub/conversation) get agents/ subdir for spawn/message IPC
  // Use chmod 777 so both host (agent/1002) and container (node/1000) can write
  for (const sub of ['messages', 'tasks', 'input', 'agents'] as const) {
    const subDir = path.join(groupIpcDir, sub);
    fs.mkdirSync(subDir, { recursive: true });
    try {
      fs.chmodSync(subDir, 0o777);
    } catch {
      /* ignore if already correct */
    }
  }
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Per-container environment file (keeps credentials out of process listings)
  // Global config merged with per-container overrides.
  const envDir = path.join(DATA_DIR, 'env', group.folder);
  fs.mkdirSync(envDir, { recursive: true });
  const globalConfig = resolvedProvider?.config ?? getClaudeProviderConfig();
  const containerOverride = getContainerEnvConfig(group.folder);
  const envLines = buildContainerEnvLines(
    globalConfig,
    containerOverride,
    resolvedProvider?.customEnv,
  );
  if (envLines.length > 0) {
    const envFilePath = path.join(envDir, 'env');
    const quotedLines = shellQuoteEnvLines(envLines);
    fs.writeFileSync(envFilePath, quotedLines.join('\n') + '\n', {
      mode: 0o600,
    });
    try {
      fs.chmodSync(envFilePath, 0o600);
    } catch (err) {
      logger.warn(
        { group: group.name, err },
        'Failed to enforce env file permissions',
      );
    }
    mounts.push({
      hostPath: envDir,
      containerPath: '/workspace/env-dir',
      readonly: true,
    });
  }

  // Write .credentials.json for OAuth credentials (session dir is already mounted)
  const mergedConfig = mergeClaudeEnvConfig(globalConfig, containerOverride);
  if (mergedConfig.claudeOAuthCredentials) {
    try {
      writeCredentialsFile(groupSessionsDir, mergedConfig);
    } catch (err) {
      logger.warn(
        { group: group.name, err },
        'Failed to write .credentials.json',
      );
    }
  }

  // Mount agent-runner source from host — recompiled on container startup.
  // Bypasses Docker 镜像构建缓存，确保代码变更生效。
  const agentRunnerSrc = path.join(
    packageRoot,
    'container',
    'agent-runner',
    'src',
  );
  mounts.push({
    hostPath: agentRunnerSrc,
    containerPath: '/app/src',
    readonly: true,
  });

  // External Claude runtime contract: keep ~/.claude/CLAUDE.md and rules/
  // mounted into /workspace/ so the SDK's directory traversal (cwd → root)
  // can still discover upstream Claude config files.
  // Only for admin-created workspaces (ownerHomeFolder === 'main').
  const isCreatorAdmin = ownerHomeFolder === 'main';
  if (isCreatorAdmin) {
    const hostClaudeDir = path.join(os.homedir(), '.claude');
    const hostClaudeMd = path.join(hostClaudeDir, 'CLAUDE.md');
    const hostRulesDir = path.join(hostClaudeDir, 'rules');

    if (fs.existsSync(hostClaudeMd)) {
      mounts.push({
        hostPath: hostClaudeMd,
        containerPath: '/workspace/CLAUDE.md',
        readonly: true,
      });
    }
    if (fs.existsSync(hostRulesDir)) {
      mounts.push({
        hostPath: hostRulesDir,
        containerPath: '/workspace/.claude/rules',
        readonly: true,
      });
    }
  }

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isAdminHome,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Docker: -v with :ro suffix for readonly
  for (const mount of mounts) {
    if (mount.readonly) {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}:ro`);
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  ownerHomeFolder?: string,
): Promise<ContainerOutput> {
  if ((group.agentType ?? 'claude') === 'codex') {
    return {
      status: 'error',
      result: null,
      error: 'Codex only supports host execution mode',
    };
  }
  const startTime = Date.now();
  const agentType = input.agentType || group.agentType || 'claude';
  const selectedRunner = 'claude';
  const runtimeBuildLogFields = getRuntimeBuildLogFields();

  const groupDir = path.join(GROUPS_DIR, group.folder);
  mkdirForContainer(groupDir);

  // ─── Provider Pool selection ───
  const poolResult = trySelectPoolProvider(group.folder);
  const selectedProfileId = poolResult?.profileId ?? null;
  const resolvedProvider = poolResult?.resolved;

  try {
    // Determine if this is an admin home container (full privileges)
    const isAdminHome = !!group.is_home && group.folder === 'main';
    // Per-user skills: always mount if the group has an owner
    const shouldMountUserSkills = !!group.created_by;
    const mounts = buildVolumeMounts(
      group,
      isAdminHome,
      shouldMountUserSkills,
      input.agentId,
      ownerHomeFolder,
      input.taskRunId,
      resolvedProvider,
    );
    const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
    const agentSuffix = input.agentId
      ? `-${input.agentId.replace(/[^a-zA-Z0-9-]/g, '-')}`
      : '';
    const containerName = `cli-claw-${safeName}${agentSuffix}-${Date.now()}`;
    const containerArgs = buildContainerArgs(mounts, containerName);

    logger.debug(
      {
        group: group.name,
        containerName,
        mounts: mounts.map(
          (m) =>
            `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
        ),
        containerArgs: containerArgs.join(' '),
      },
      'Container mount configuration',
    );

    logger.info(
      {
        requestedAgentType: input.agentType || group.agentType || 'claude',
        effectiveAgentType: agentType,
        group: group.name,
        folder: group.folder,
        chatJid: input.chatJid,
        agentType,
        selectedRunner,
        executionMode: 'container',
        sessionId: input.sessionId || null,
        agentId: input.agentId || null,
        containerName,
        mountCount: mounts.length,
        isMain: input.isMain,
        ...runtimeBuildLogFields,
      },
      'Spawning container agent',
    );

    const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const result = await new Promise<ContainerOutput>((resolve) => {
      const container = spawn('docker', containerArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      onProcess(container, containerName);

      const stdoutState = createStdoutParserState();
      const stderrState = createStderrState();

      // Write input and close stdin (容器需要 EOF 来刷新 stdin 管道)
      container.stdin.on('error', (err) => {
        logger.error(
          { group: group.name, err },
          'Container stdin write failed',
        );
        container.kill();
      });
      container.stdin.write(JSON.stringify(input));
      container.stdin.end();

      let timedOut = false;
      const timeoutMs =
        group.containerConfig?.timeout || getSystemSettings().containerTimeout;

      const killOnTimeout = () => {
        timedOut = true;
        logger.error(
          { group: group.name, containerName },
          'Container timeout, stopping gracefully',
        );
        execFile(
          'docker',
          ['stop', containerName],
          { timeout: 15000 },
          (err) => {
            if (err) {
              logger.warn(
                { group: group.name, containerName, err },
                'Graceful stop failed, force killing',
              );
              container.kill('SIGKILL');
            }
          },
        );
      };

      let timeout = setTimeout(killOnTimeout, timeoutMs);

      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(killOnTimeout, timeoutMs);
      };

      // Attach stdout/stderr handlers using shared parser
      attachStdoutHandler(container.stdout, stdoutState, {
        groupName: group.name,
        label: 'Container',
        onOutput,
        resetTimeout,
      });
      attachStderrHandler(container.stderr, stderrState, group.name, {
        container: group.folder,
      });

      container.on('close', (code, signal) => {
        clearTimeout(timeout);
        const duration = Date.now() - startTime;

        const closeCtx: CloseHandlerContext = {
          groupName: group.name,
          label: 'Container',
          filePrefix: 'container',
          identifier: containerName,
          logsDir,
          input: {
            ...input,
            agentType,
            executionMode: 'container',
            agentId: input.agentId,
          },
          stdoutState,
          stderrState,
          onOutput,
          resolvePromise: resolve,
          startTime,
          timeoutMs,
          agentIdentity: {
            chatJid: input.chatJid,
            groupFolder: group.folder,
            agentType,
            executionMode: 'container',
            selectedRunner,
            agentId: input.agentId || null,
          },
          runtimeBuildInfo: runtimeBuildLogFields,
          extraSummaryLines: [
            ``,
            `=== Mounts ===`,
            mounts
              .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
              .join('\n'),
          ],
          extraVerboseLines: [
            `=== Container Args ===`,
            containerArgs.join(' '),
            ``,
            `=== Mounts (detailed) ===`,
            mounts
              .map(
                (m) =>
                  `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
              )
              .join('\n'),
          ],
        };

        if (handleTimeoutClose(closeCtx, code, duration, timedOut)) return;
        const logFile = writeRunLog(closeCtx, code, duration);
        if (handleNonZeroExit(closeCtx, code, signal, duration, logFile))
          return;
        handleSuccessClose(closeCtx, duration);
      });

      container.on('error', (err) => {
        clearTimeout(timeout);
        logger.error(
          { group: group.name, containerName, error: err },
          'Container spawn error',
        );
        resolve({
          status: 'error',
          result: null,
          error: `Container spawn error: ${err.message}`,
        });
      });
    });

    // ─── Provider Pool health reporting ───
    if (selectedProfileId) {
      if (result.status === 'success' || result.status === 'closed') {
        providerPool.reportSuccess(selectedProfileId);
      } else if (result.status === 'error' && isApiError(result.error || '')) {
        providerPool.reportFailure(selectedProfileId);
      }
    }

    return result;
  } finally {
    // Guarantee session release even if buildVolumeMounts/spawn throws
    if (selectedProfileId) {
      providerPool.releaseSession(selectedProfileId);
    }
  }
}

export function writeTasksSnapshot(
  groupFolder: string,
  isAdminHome: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Admin home sees all tasks, others only see their own
  const filteredTasks = isAdminHome
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  // 删除后重建：容器创建的文件归属 node(1000) 用户，宿主机进程无法覆写
  try {
    fs.unlinkSync(tasksFile);
  } catch {
    /* ignore */
  }
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the container to read.
 * Only admin home can see all available groups (for activation).
 * Other groups see nothing (they can't activate groups).
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isAdminHome: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Admin home sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isAdminHome ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  try {
    fs.unlinkSync(groupsFile);
  } catch {
    /* ignore */
  }
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

/**
 * 杀死进程及其所有子进程。
 * 如果进程以 detached 模式启动（独立进程组），使用负 PID 杀整个进程组。
 */
export function killProcessTree(
  proc: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
): boolean {
  try {
    if (proc.pid) {
      process.kill(-proc.pid, signal);
      return true;
    }
  } catch {
    try {
      proc.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Run agent directly on the host machine (no Docker container).
 * Used for host execution mode — the agent gets full access to the host filesystem.
 */
export async function runHostAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, identifier: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  ownerHomeFolder?: string,
  options?: { executionCwd?: string },
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const setupInstallHint = 'npm --prefix container/agent-runner install';
  const setupBuildHint = 'npm --prefix container/agent-runner run build';
  const hostModeSetupError = (message: string): ContainerOutput => ({
    status: 'error',
    result: `宿主机模式启动失败：${message}`,
    error: message,
  });

  // 1. 确定存储目录与实际执行目录
  const storageGroupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(storageGroupDir, { recursive: true });

  const initialExecutionCwd =
    options?.executionCwd ||
    (group.executionMode === 'host' ? group.customCwd : storageGroupDir);
  if (!initialExecutionCwd) {
    return hostModeSetupError(
      'Host workspace is missing custom_cwd. Run cli-claw start from the target directory or set custom_cwd explicitly.',
    );
  }
  if (!path.isAbsolute(initialExecutionCwd)) {
    return hostModeSetupError(`工作目录必须是绝对路径：${initialExecutionCwd}`);
  }
  // Resolve symlinks to prevent TOCTOU attacks
  let groupDir = initialExecutionCwd;
  try {
    groupDir = fs.realpathSync(groupDir);
  } catch {
    return hostModeSetupError(`工作目录不存在或无法解析：${groupDir}`);
  }
  if (!fs.statSync(groupDir).isDirectory()) {
    return hostModeSetupError(`工作目录不是目录：${groupDir}`);
  }

  // Runtime allowlist validation for host CWD (defense-in-depth: web.ts validates at creation,
  // but re-check here in case allowlist was tightened or path was injected via DB)
  if (group.executionMode === 'host') {
    const allowlist = loadMountAllowlist();
    if (
      allowlist &&
      allowlist.allowedRoots &&
      allowlist.allowedRoots.length > 0
    ) {
      let allowed = false;
      for (const root of allowlist.allowedRoots) {
        const expandedRoot = root.path.startsWith('~')
          ? path.join(
              process.env.HOME || '/Users/user',
              root.path.slice(root.path.startsWith('~/') ? 2 : 1),
            )
          : path.resolve(root.path);

        let realRoot: string;
        try {
          realRoot = fs.realpathSync(expandedRoot);
        } catch {
          continue;
        }

        const relative = path.relative(realRoot, groupDir);
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          allowed = true;
          break;
        }
      }

      if (!allowed) {
        return hostModeSetupError(
          `工作目录 ${groupDir} 不在允许的根目录下，请检查 mount-allowlist.json`,
        );
      }
    }
  }

  fs.mkdirSync(path.join(storageGroupDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'memory', group.folder), {
    recursive: true,
  });

  // 2. 确保目录结构（宿主机模式下限制目录权限）
  // Sub-agents get their own IPC and session directories
  // Isolated tasks get their own IPC subdirectory under tasks-run/{taskRunId}/
  const groupIpcDir = input.agentId
    ? path.join(DATA_DIR, 'ipc', group.folder, 'agents', input.agentId)
    : input.taskRunId
      ? path.join(DATA_DIR, 'ipc', group.folder, 'tasks-run', input.taskRunId)
      : path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), {
    recursive: true,
    mode: 0o700,
  });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), {
    recursive: true,
    mode: 0o700,
  });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), {
    recursive: true,
    mode: 0o700,
  });
  // All agents (main + sub/conversation) get agents/ subdir for spawn/message IPC
  fs.mkdirSync(path.join(groupIpcDir, 'agents'), {
    recursive: true,
    mode: 0o700,
  });

  const groupSessionsDir = input.agentId
    ? path.join(
        DATA_DIR,
        'sessions',
        group.folder,
        'agents',
        input.agentId,
        '.claude',
      )
    : path.join(DATA_DIR, 'sessions', group.folder, '.claude');
  fs.mkdirSync(groupSessionsDir, { recursive: true });

  // 3. 写入 settings.json（合并模式，不覆盖已有用户配置）
  // Load user's global MCP servers (same logic as Docker mode).
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  const hostMcpServers = group.created_by
    ? loadUserMcpServers(group.created_by)
    : {};
  ensureSettingsJson(settingsFile, hostMcpServers);

  // 4. Skills 自动链接到 session 目录
  // 链接顺序：项目级 → 用户级(覆盖同名项目级)
  // 用户的所有 skills 在所有工作区中生效
  try {
    const skillsDir = path.join(groupSessionsDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    // 清空已有符号链接
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      const entryPath = path.join(skillsDir, entry.name);
      try {
        if (entry.isSymbolicLink() || entry.isDirectory()) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        }
      } catch {
        /* ignore */
      }
    }

    const linkSkillEntries = (sourceDir: string) => {
      if (!fs.existsSync(sourceDir)) return;
      for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const linkPath = path.join(skillsDir, entry.name);
        try {
          // 移除已有符号链接（高优先级覆盖低优先级）
          if (fs.existsSync(linkPath)) {
            fs.rmSync(linkPath, { recursive: true, force: true });
          }
          fs.symlinkSync(path.join(sourceDir, entry.name), linkPath);
        } catch {
          /* ignore */
        }
      }
    };

    // 项目级 skills
    linkSkillEntries(resolveAppPath('container', 'skills'));
    // 用户级 skills（覆盖同名项目级）
    const ownerId = group.created_by;
    if (ownerId) {
      linkSkillEntries(path.join(DATA_DIR, 'skills', ownerId));
    }
  } catch (err) {
    logger.warn(
      { folder: group.folder, err },
      '宿主机模式 skills 符号链接失败',
    );
  }

  // 5. 构建环境变量
  const hostEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  const agentType = group.agentType ?? 'claude';
  const selectedRunner = agentType;
  const runtimeBuildLogFields = getRuntimeBuildLogFields();

  // ─── Provider Pool selection (host mode) ───
  const containerOverride = getContainerEnvConfig(group.folder);
  const hostPoolResult =
    agentType === 'claude' ? trySelectPoolProvider(group.folder) : null;
  const hostSelectedProfileId = hostPoolResult?.profileId ?? null;
  const globalConfig =
    agentType === 'claude'
      ? (hostPoolResult?.resolved.config ?? getClaudeProviderConfig())
      : null;

  try {
    if (agentType === 'claude' && globalConfig) {
      // 配置层环境变量
      const envLines = buildContainerEnvLines(
        globalConfig,
        containerOverride,
        hostPoolResult?.resolved.customEnv,
      );
      for (const line of envLines) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          hostEnv[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
        }
      }

      // Write .credentials.json for OAuth credentials
      const mergedConfig = mergeClaudeEnvConfig(
        globalConfig,
        containerOverride,
      );
      if (mergedConfig.claudeOAuthCredentials) {
        try {
          writeCredentialsFile(groupSessionsDir, mergedConfig);
        } catch (err) {
          logger.warn(
            { folder: group.folder, err },
            'Failed to write .credentials.json for host agent',
          );
        }
      }
    }

    // 路径映射
    hostEnv['CLI_CLAW_WORKSPACE_GROUP'] = groupDir;
    // Per-user global memory
    const ownerId = requireWorkspaceOwner(group, 'host runtime');
    const userGlobalDir = path.join(GROUPS_DIR, 'user-global', ownerId);
    fs.mkdirSync(userGlobalDir, { recursive: true });
    hostEnv['CLI_CLAW_WORKSPACE_GLOBAL'] = userGlobalDir;
    const memoryFolder = group.is_home
      ? group.folder
      : ownerHomeFolder || group.folder;
    hostEnv['CLI_CLAW_WORKSPACE_MEMORY'] = path.join(
      DATA_DIR,
      'memory',
      memoryFolder,
    );
    hostEnv['CLI_CLAW_WORKSPACE_IPC'] = groupIpcDir;
    if (agentType === 'claude') {
      hostEnv['CLAUDE_CONFIG_DIR'] = groupSessionsDir;
      // 让 SDK 捕获 CLI 的 stderr 输出，便于排查启动失败
      hostEnv['DEBUG_CLAUDE_AGENT_SDK'] = '1';
      // CLI 禁止 root 用户使用 --dangerously-skip-permissions，
      // 通过 IS_SANDBOX 标记告知 CLI 当前运行在受控环境中以绕过此限制
      if (typeof process.getuid === 'function' && process.getuid() === 0) {
        hostEnv['IS_SANDBOX'] = '1';
      }
    }

    // 6. 编译检查
    const agentRunnerRoot = resolveAppPath('container', 'agent-runner');
    const agentRunnerManifestPath = path.join(agentRunnerRoot, 'package.json');
    const agentRunnerDist = path.join(agentRunnerRoot, 'dist', 'index.js');
    if (!fs.existsSync(agentRunnerManifestPath)) {
      logger.error(
        { group: group.name, agentRunnerRoot },
        'Host agent preflight failed: packaged agent-runner manifest missing',
      );
      return hostModeSetupError(
        '缺少 container/agent-runner 资源。当前安装不支持 packaged host-mode agent-runner，请改用源码仓库运行或补齐该目录后重试。',
      );
    }
    const requiredDeps =
      agentType === 'claude'
        ? ['@anthropic-ai/claude-agent-sdk']
        : ['@agentclientprotocol/sdk'];
    const agentRunnerRequire = createRequire(agentRunnerManifestPath);
    const missingDeps = requiredDeps.filter((dep) => {
      try {
        agentRunnerRequire.resolve(`${dep}/package.json`);
        return false;
      } catch {
        return true;
      }
    });
    if (missingDeps.length > 0) {
      const missing = missingDeps.join(', ');
      logger.error(
        { group: group.name, missingDeps },
        'Host agent preflight failed: dependencies missing',
      );
      return hostModeSetupError(
        `缺少 agent-runner 依赖（${missing}）。请先执行：${setupInstallHint}`,
      );
    }
    if (!fs.existsSync(agentRunnerDist)) {
      logger.error(
        { group: group.name, agentRunnerDist },
        'Host agent preflight failed: dist not found',
      );
      return hostModeSetupError(
        `agent-runner 产物缺失。请先执行：${setupBuildHint}；若这是安装包环境，请确认包含 container/agent-runner/dist。`,
      );
    }
    if (agentType === 'codex') {
      try {
        execFileSync('codex', ['login', 'status'], {
          stdio: 'ignore',
          timeout: 10_000,
        });
      } catch {
        return hostModeSetupError(
          'Codex CLI 未登录。请先在服务器上执行：codex login',
        );
      }
    }

    // Auto-rebuild only in local/dev checkouts. Installed npm packages may
    // normalize mtimes such that src appears slightly newer than dist.
    if (!isInstalledNodeModulesPackageRoot(APP_ROOT)) {
      try {
        const distMtime = fs.statSync(agentRunnerDist).mtimeMs;
        const srcDir = path.join(agentRunnerRoot, 'src');
        const srcFiles = fs.readdirSync(srcDir);
        const newestSrc = Math.max(
          ...srcFiles.map((f) => fs.statSync(path.join(srcDir, f)).mtimeMs),
        );
        if (newestSrc > distMtime) {
          logger.info(
            { group: group.name },
            'agent-runner dist 已过期，自动重新编译...',
          );
          try {
            const { execSync } = await import('child_process');
            execSync('npm run build', {
              cwd: agentRunnerRoot,
              stdio: 'pipe',
              timeout: 30_000,
            });
            logger.info({ group: group.name }, 'agent-runner 自动编译完成');
          } catch (buildErr) {
            logger.warn(
              { group: group.name, err: buildErr },
              `agent-runner 自动编译失败，使用旧版 dist。手动执行：${setupBuildHint}`,
            );
          }
        }
      } catch {
        // Best effort, don't block execution
      }
    }

    logger.info(
      {
        requestedAgentType: input.agentType || group.agentType || 'claude',
        effectiveAgentType: agentType,
        group: group.name,
        folder: group.folder,
        chatJid: input.chatJid,
        agentType,
        selectedRunner,
        executionMode: 'host',
        sessionId: input.sessionId || null,
        agentId: input.agentId || null,
        workingDir: groupDir,
        isMain: input.isMain,
        ...runtimeBuildLogFields,
      },
      'Spawning host agent',
    );

    const logsDir = path.join(storageGroupDir, 'logs');

    const hostResult = await new Promise<ContainerOutput>((resolve) => {
      let settled = false;
      const resolveOnce = (output: ContainerOutput): void => {
        if (settled) return;
        settled = true;
        resolve(output);
      };

      // 7. 启动进程
      const proc = spawn('node', [agentRunnerDist], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: hostEnv,
        cwd: groupDir,
        detached: true,
      });

      const processId = `host-${group.folder}-${Date.now()}`;
      onProcess(proc, processId);

      const stdoutState = createStdoutParserState();
      const stderrState = createStderrState();

      // 8. stdin 输入
      proc.stdin.on('error', (err) => {
        logger.error(
          { group: group.name, err },
          'Host agent stdin write failed',
        );
        killProcessTree(proc);
      });
      proc.stdin.write(JSON.stringify(input));
      proc.stdin.end();

      // 9. 超时管理
      let timedOut = false;
      const timeoutMs =
        group.containerConfig?.timeout || getSystemSettings().containerTimeout;

      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const killOnTimeout = () => {
        timedOut = true;
        logger.error(
          { group: group.name, processId },
          'Host agent timeout, killing',
        );
        killProcessTree(proc, 'SIGTERM');
        killTimer = setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) {
            killProcessTree(proc, 'SIGKILL');
          }
        }, 5000);
      };

      let timeout = setTimeout(killOnTimeout, timeoutMs);

      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(killOnTimeout, timeoutMs);
      };

      // 10. stdout/stderr 解析
      attachStdoutHandler(proc.stdout, stdoutState, {
        groupName: group.name,
        label: 'Host agent',
        onOutput,
        resetTimeout,
      });
      attachStderrHandler(proc.stderr, stderrState, group.name, {
        host: group.folder,
      });

      // 11. close 事件处理
      proc.on('close', (code, signal) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        const duration = Date.now() - startTime;

        const closeCtx: CloseHandlerContext = {
          groupName: group.name,
          label: 'Host Agent',
          filePrefix: 'host',
          identifier: processId,
          logsDir,
          input: {
            ...input,
            agentType,
            executionMode: 'host',
            agentId: input.agentId,
          },
          stdoutState,
          stderrState,
          onOutput,
          resolvePromise: resolveOnce,
          startTime,
          timeoutMs,
          agentIdentity: {
            chatJid: input.chatJid,
            groupFolder: group.folder,
            agentType,
            executionMode: 'host',
            selectedRunner,
            agentId: input.agentId || null,
          },
          runtimeBuildInfo: runtimeBuildLogFields,
          extraSummaryLines: [`Working Directory: ${groupDir}`],
          enrichError: (stderrContent, exitLabel) => {
            const missingPackageMatch = stderrContent.match(
              /Cannot find package '([^']+)' imported from/u,
            );
            const userFacingError =
              (missingPackageMatch
                ? `宿主机模式启动失败：缺少依赖 ${missingPackageMatch[1]}。请先执行：${setupInstallHint}`
                : null) || formatUserFacingRuntimeError(stderrContent);
            return {
              result: userFacingError,
              error: `Host agent exited with ${exitLabel}: ${stderrContent.slice(-200)}`,
            };
          },
        };

        if (handleTimeoutClose(closeCtx, code, duration, timedOut)) return;
        const logFile = writeRunLog(closeCtx, code, duration);
        if (handleNonZeroExit(closeCtx, code, signal, duration, logFile))
          return;
        handleSuccessClose(closeCtx, duration);
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        logger.error(
          { group: group.name, processId, error: err },
          'Host agent spawn error',
        );
        resolveOnce({
          status: 'error',
          result: null,
          error: `Host agent spawn error: ${err.message}`,
        });
      });
    });

    // ─── Provider Pool health reporting (host mode) ───
    if (agentType === 'claude' && hostSelectedProfileId) {
      if (hostResult.status === 'success' || hostResult.status === 'closed') {
        providerPool.reportSuccess(hostSelectedProfileId);
      } else if (
        hostResult.status === 'error' &&
        isApiError(hostResult.error || '')
      ) {
        providerPool.reportFailure(hostSelectedProfileId);
      }
    }

    return hostResult;
  } finally {
    // Guarantee session release even if spawn/setup throws
    if (agentType === 'claude' && hostSelectedProfileId) {
      providerPool.releaseSession(hostSelectedProfileId);
    }
  }
}
