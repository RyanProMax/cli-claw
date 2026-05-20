/**
 * Agent process runner for cli-claw.
 * Spawns the local OpenAI/Codex runner process and handles IPC.
 */
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import {
  APP_ROOT,
  isInstalledNodeModulesPackageRoot,
  resolveAppPath,
} from '../../core/app-root.js';

import { DATA_DIR, GROUPS_DIR } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import { loadMountAllowlist } from '../../core/workspace/mount-security.js';
import { getSystemSettings } from '../../core/runtime/config.js';
import { getAgentRuntime } from '../../core/runtime/runtime-registry.js';
import {
  AgentType,
  MessageCursor,
  MessageSourceKind,
  RegisteredGroup,
  RuntimeIdentity,
  StreamEvent,
} from '../../domain/types.js';
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
} from './output-parser.js';
import { getRuntimeBuildLogFields } from '../../core/runtime/build.js';
import { writeSelfRestartRequestChatJidToEnv } from '../../core/self/self-restart.js';

const LEGACY_OPENAI_TOKEN_ENV = 'OPENAI' + '_API_KEY';

function buildHostRuntimePath(options: {
  pathValue?: string | null;
  homeDir?: string | null;
}): string {
  const entries = (options.pathValue || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidates = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    options.homeDir ? path.join(options.homeDir, '.local', 'bin') : null,
  ].filter((entry): entry is string => Boolean(entry));
  for (const candidate of candidates) {
    if (!entries.includes(candidate)) entries.push(candidate);
  }
  return entries.join(path.delimiter);
}

export interface AgentProcessInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  agentType?: AgentType;
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
  turnId?: string;
  messageCursor?: MessageCursor;
  isHome?: boolean;
  isAdminHome?: boolean;
  isScheduledTask?: boolean;
  /** Isolated task run ID — determines IPC namespace (tasks-run/{taskRunId}/) */
  taskRunId?: string;
  /** Run one model turn and exit instead of waiting for follow-up IPC input. */
  singleTurn?: boolean;
  images?: Array<{ data: string; mimeType?: string }>;
  agentId?: string;
  agentName?: string;
  workflow?: {
    id: string;
    name: string;
    contextId: string;
    runId: string;
    threadId: string;
    nodeId: string;
    nodeType: string;
  };
  role?: {
    id: string;
    name: string;
    description?: string;
    instructions: string;
    skillIds: string[];
    permissionMode: string;
    allowedTools: string[];
  };
  allowedTools?: string[];
}

export interface AgentProcessOutput {
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
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  const filteredTasks = isAdminHome
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
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

export function writeGroupsSnapshot(
  groupFolder: string,
  isAdminHome: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

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

export function canResolveAgentRunnerDependency(input: {
  manifestPath: string;
  dependency: string;
}): boolean {
  const agentRunnerRequire = createRequire(input.manifestPath);
  try {
    agentRunnerRequire.resolve(input.dependency);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a detached runner process and its child process group.
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

export async function runAgentProcess(
  group: RegisteredGroup,
  input: AgentProcessInput,
  onProcess: (proc: ChildProcess, identifier: string) => void,
  onOutput?: (output: AgentProcessOutput) => Promise<void>,
  options?: { executionCwd?: string; processTimeoutMs?: number },
): Promise<AgentProcessOutput> {
  const startTime = Date.now();
  const setupInstallHint = 'npm --prefix container/agent-runner install';
  const setupBuildHint = 'npm --prefix container/agent-runner run build';
  const setupError = (message: string): AgentProcessOutput => ({
    status: 'error',
    result: `Agent 进程启动失败：${message}`,
    error: message,
  });

  const storageGroupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(storageGroupDir, { recursive: true });

  const initialExecutionCwd =
    options?.executionCwd || group.customCwd || storageGroupDir;
  if (!path.isAbsolute(initialExecutionCwd)) {
    return setupError(`工作目录必须是绝对路径：${initialExecutionCwd}`);
  }

  let groupDir = initialExecutionCwd;
  try {
    groupDir = fs.realpathSync(groupDir);
  } catch {
    return setupError(`工作目录不存在或无法解析：${groupDir}`);
  }
  if (!fs.statSync(groupDir).isDirectory()) {
    return setupError(`工作目录不是目录：${groupDir}`);
  }

  const allowlist = loadMountAllowlist();
  if (allowlist?.allowedRoots?.length) {
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
      return setupError(
        `工作目录 ${groupDir} 不在允许的根目录下，请检查 mount-allowlist.json`,
      );
    }
  }

  fs.mkdirSync(path.join(storageGroupDir, 'logs'), { recursive: true });

  const groupIpcDir = input.agentId
    ? path.join(DATA_DIR, 'ipc', group.folder, 'agents', input.agentId)
    : input.taskRunId
      ? path.join(DATA_DIR, 'ipc', group.folder, 'tasks-run', input.taskRunId)
      : path.join(DATA_DIR, 'ipc', group.folder);
  for (const sub of ['messages', 'tasks', 'input', 'agents'] as const) {
    fs.mkdirSync(path.join(groupIpcDir, sub), {
      recursive: true,
      mode: 0o700,
    });
  }

  const hostEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  const agentType: AgentType = 'openai';
  const selectedRunner = agentType;
  const runtimeBuildLogFields = getRuntimeBuildLogFields();

  try {
    delete hostEnv[LEGACY_OPENAI_TOKEN_ENV];
    const runtime = getAgentRuntime(agentType);
    const runtimePreparation = await runtime.prepareRuntime({
      group,
      agentId: input.agentId ?? null,
    });
    Object.assign(hostEnv, runtimePreparation.env);

    hostEnv['PATH'] = buildHostRuntimePath({
      pathValue: hostEnv['PATH'],
      homeDir: hostEnv['HOME'],
    });
    hostEnv['CLI_CLAW_BACKEND_PID'] = String(process.pid);
    hostEnv['CLI_CLAW_SAFE_RESTART_COMMAND'] = 'cli-claw restart';
    hostEnv['CLI_CLAW_SAFE_IM_RESTART_COMMAND'] = '/self-restart';
    writeSelfRestartRequestChatJidToEnv(hostEnv, input.chatJid);
    const launchdServiceName =
      process.env.CLI_CLAW_LAUNCHD_SERVICE_NAME?.trim();
    if (launchdServiceName) {
      hostEnv['CLI_CLAW_LAUNCHD_SERVICE_NAME'] = launchdServiceName;
    }

    hostEnv['CLI_CLAW_WORKSPACE_GROUP'] = groupDir;
    hostEnv['CLI_CLAW_WORKSPACE_IPC'] = groupIpcDir;

    const agentRunnerRoot = resolveAppPath('container', 'agent-runner');
    const agentRunnerManifestPath = path.join(agentRunnerRoot, 'package.json');
    const agentRunnerDist = path.join(agentRunnerRoot, 'dist', 'index.js');
    if (!fs.existsSync(agentRunnerManifestPath)) {
      logger.error(
        { group: group.name, agentRunnerRoot },
        'Agent process preflight failed: packaged agent-runner manifest missing',
      );
      return setupError(
        '缺少 container/agent-runner 资源。请使用源码仓库运行或补齐该目录后重试。',
      );
    }

    const requiredDeps = ['@openai/agents', 'openai'];
    const missingDeps = requiredDeps.filter((dep) => {
      return !canResolveAgentRunnerDependency({
        manifestPath: agentRunnerManifestPath,
        dependency: dep,
      });
    });
    if (missingDeps.length > 0) {
      const missing = missingDeps.join(', ');
      logger.error(
        { group: group.name, missingDeps },
        'Agent process preflight failed: dependencies missing',
      );
      return setupError(
        `缺少 agent-runner 依赖（${missing}）。请先执行：${setupInstallHint}`,
      );
    }

    if (!fs.existsSync(agentRunnerDist)) {
      logger.error(
        { group: group.name, agentRunnerDist },
        'Agent process preflight failed: dist not found',
      );
      return setupError(
        `agent-runner 产物缺失。请先执行：${setupBuildHint}；若这是安装包环境，请确认包含 container/agent-runner/dist。`,
      );
    }

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
        // Best effort, do not block execution.
      }
    }

    logger.info(
      {
        requestedAgentType: input.agentType || group.agentType || 'openai',
        effectiveAgentType: agentType,
        group: group.name,
        folder: group.folder,
        chatJid: input.chatJid,
        agentType,
        selectedRunner,
        sessionId: input.sessionId || null,
        agentId: input.agentId || null,
        workingDir: groupDir,
        isHome: input.isHome ?? false,
        isAdminHome: input.isAdminHome ?? false,
        ...runtimeBuildLogFields,
      },
      'Spawning agent process',
    );

    const logsDir = path.join(storageGroupDir, 'logs');

    return await new Promise<AgentProcessOutput>((resolve) => {
      let settled = false;
      const resolveOnce = (output: AgentProcessOutput): void => {
        if (settled) return;
        settled = true;
        resolve(output);
      };

      const proc = spawn('node', [agentRunnerDist], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: hostEnv,
        cwd: groupDir,
        detached: true,
      });

      const processId = `agent-${group.folder}-${Date.now()}`;
      onProcess(proc, processId);

      const stdoutState = createStdoutParserState();
      const stderrState = createStderrState();

      proc.stdin.on('error', (err) => {
        logger.error(
          { group: group.name, err },
          'Agent process stdin write failed',
        );
        killProcessTree(proc);
      });
      proc.stdin.write(JSON.stringify({ ...input, agentType }));
      proc.stdin.end();

      let timedOut = false;
      const timeoutMs =
        options?.processTimeoutMs ?? getSystemSettings().processTimeout;

      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const killOnTimeout = () => {
        timedOut = true;
        logger.info(
          { group: group.name, processId },
          'Agent process timeout, killing',
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

      attachStdoutHandler(proc.stdout, stdoutState, {
        groupName: group.name,
        label: 'Agent process',
        onOutput,
        resetTimeout,
      });
      attachStderrHandler(proc.stderr, stderrState, group.name, {
        process: group.folder,
      });

      proc.on('close', (code, signal) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        const duration = Date.now() - startTime;

        const closeCtx: CloseHandlerContext = {
          groupName: group.name,
          label: 'Agent Process',
          filePrefix: 'agent',
          identifier: processId,
          logsDir,
          input: {
            ...input,
            agentType,
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
                ? `Agent 进程启动失败：缺少依赖 ${missingPackageMatch[1]}。请先执行：${setupInstallHint}`
                : null) || formatUserFacingRuntimeError(stderrContent);
            return {
              result: userFacingError,
              error: `Agent process exited with ${exitLabel}: ${stderrContent.slice(-200)}`,
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
          'Agent process spawn error',
        );
        resolveOnce({
          status: 'error',
          result: null,
          error: `Agent process spawn error: ${err.message}`,
        });
      });
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ group: group.name, err }, 'Agent process setup failed');
    return setupError(error);
  }
}
