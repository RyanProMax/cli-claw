/**
 * Pure utility functions for IM slash commands.
 * Extracted from index.ts to enable unit testing without DB/state dependencies.
 */

import type { ImMessageLifecycleEvent } from '../domain/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface AgentInfo {
  id: string;
  name: string;
  status: string;
}

export interface WorkspaceInfo {
  folder: string;
  name: string;
  agents: AgentInfo[];
}

// ─── List Formatting ────────────────────────────────────────────

/**
 * Format workspace list with current-position markers.
 */
export function formatWorkspaceList(
  workspaces: WorkspaceInfo[],
  currentFolder: string,
  currentAgentId: string | null,
  currentOnMain = true,
): string {
  if (workspaces.length === 0) return '没有可用的工作区';

  const lines: string[] = ['📂 工作区列表：'];

  for (const ws of workspaces) {
    const isCurrent = ws.folder === currentFolder;
    const marker = isCurrent ? ' ▶' : '';
    lines.push(`${marker} ${ws.name} (${ws.folder})`);

    const mainMarker = isCurrent && currentOnMain ? ' ← 当前' : '';
    lines.push(`  · 主对话${mainMarker}`);

    for (const agent of ws.agents) {
      const agentMarker =
        isCurrent && currentAgentId === agent.id ? ' ← 当前' : '';
      const statusIcon = agent.status === 'running' ? '🔄' : '';
      const shortId = agent.id.slice(0, 4);
      lines.push(`  · ${agent.name} [${shortId}] ${statusIcon}${agentMarker}`);
    }
  }

  lines.push('');
  lines.push('💡 /sw <消息> 并行任务 · /clear 重置');
  return lines.join('\n');
}

// ─── Location Info ────────────────────────────────────────────

export interface LocationInfo {
  locationLine: string;
  folder: string;
  replyPolicy: string | null;
}

export interface BoundChatTarget {
  baseChatJid: string;
  targetChatJid: string;
  folder: string;
  agentId: string | null;
  locationLine: string;
}

export interface RegisteredGroupLike {
  folder: string;
  name: string;
  target_agent_id?: string | null;
  target_main_jid?: string | null;
  reply_policy?: string | null;
}

export interface AgentLike {
  name: string;
  chat_jid: string;
}

/**
 * Resolve location info from a registered group.
 * Pure function — all state access goes through callbacks.
 */
export function resolveLocationInfo(
  group: RegisteredGroupLike,
  getRegisteredGroup: (jid: string) => RegisteredGroupLike | undefined,
  getAgent: (id: string) => AgentLike | undefined,
  findGroupNameByFolder: (folder: string) => string,
): LocationInfo {
  let locationLine: string;
  let folder: string;

  if (group.target_agent_id) {
    const agent = getAgent(group.target_agent_id);
    const parent = agent ? getRegisteredGroup(agent.chat_jid) : undefined;
    const workspaceName = parent?.name || parent?.folder || group.folder;
    locationLine = `${workspaceName} / ${agent?.name || group.target_agent_id}`;
    folder = parent?.folder || group.folder;
  } else if (group.target_main_jid) {
    const target = getRegisteredGroup(group.target_main_jid);
    locationLine = `${target?.name || group.target_main_jid} / 主对话`;
    folder = target?.folder || group.folder;
  } else {
    const folderName = findGroupNameByFolder(group.folder);
    locationLine = `${folderName} / 主对话`;
    folder = group.folder;
  }

  const replyPolicy =
    group.target_main_jid || group.target_agent_id
      ? group.reply_policy || 'source_only'
      : null;

  return { locationLine, folder, replyPolicy };
}

/**
 * Resolve the real chat target for IM slash commands.
 *
 * Non-main workspaces use random web JIDs (`web:<uuid>`), so commands must not
 * reconstruct targets from `folder`. They need the actual bound workspace JID.
 */
export function resolveBoundChatTarget(
  sourceChatJid: string,
  group: RegisteredGroupLike,
  getRegisteredGroup: (jid: string) => RegisteredGroupLike | undefined,
  getAgent: (id: string) => AgentLike | undefined,
  findGroupNameByFolder: (folder: string) => string,
): BoundChatTarget {
  if (group.target_agent_id) {
    const agent = getAgent(group.target_agent_id);
    const parent = agent ? getRegisteredGroup(agent.chat_jid) : undefined;
    const workspaceName =
      parent?.name || findGroupNameByFolder(parent?.folder || group.folder);
    const baseChatJid = agent?.chat_jid || sourceChatJid;
    return {
      baseChatJid,
      targetChatJid: `${baseChatJid}#agent:${group.target_agent_id}`,
      folder: parent?.folder || group.folder,
      agentId: group.target_agent_id,
      locationLine: `${workspaceName} / ${agent?.name || group.target_agent_id}`,
    };
  }

  if (group.target_main_jid) {
    const target = getRegisteredGroup(group.target_main_jid);
    return {
      baseChatJid: group.target_main_jid,
      targetChatJid: group.target_main_jid,
      folder: target?.folder || group.folder,
      agentId: null,
      locationLine: `${target?.name || group.target_main_jid} / 主对话`,
    };
  }

  const workspaceName = findGroupNameByFolder(group.folder);
  return {
    baseChatJid: sourceChatJid,
    targetChatJid: sourceChatJid,
    folder: group.folder,
    agentId: null,
    locationLine: `${workspaceName} / 主对话`,
  };
}

// ─── System Status Formatting ─────────────────────────────────

export interface QueueStatusInfo {
  activeContainerCount: number;
  activeHostProcessCount: number;
  maxContainers: number;
  maxHostProcesses: number;
  waitingCount: number;
  waitingGroupJids: string[];
}

export interface StatusDisplayInfo {
  agentType: string;
  model: string;
  reasoningEffort: string | null;
  speedTier?: string | null;
  primaryRemaining: string;
  primaryReset: string;
  secondaryRemaining: string;
  secondaryReset: string;
  currentBinding?: string | null;
  replyPolicy?: string | null;
  workspaceName: string;
  currentSessionName: string;
  sessionCount: number;
  cwd: string;
}

/**
 * Format system status output for /status command.
 */
export function formatSystemStatus(
  queueStatus: QueueStatusInfo,
  isActive: boolean,
  queuePosition: number | null,
  status: StatusDisplayInfo,
): string {
  const statusText = isActive
    ? '运行中'
    : queuePosition !== null
      ? `排队中 (#${queuePosition})`
      : '空闲';
  const reasoningEffort = status.reasoningEffort?.trim() || '不支持';
  const speedTier =
    status.agentType === 'openai'
      ? status.speedTier === 'fast'
        ? 'fast (2x)'
        : 'standard (1x)'
      : '不支持';

  const lines = [
    '🤖 Agent',
    '━━━━━━━━━━',
    `🤖 当前 Agent: ${status.agentType}`,
    `🧠 当前模型: ${status.model}`,
    `⚙️ 当前推理强度: ${reasoningEffort}`,
    `🚀 当前速度: ${speedTier}`,
    '⏳ 5h 剩余: unavailable（重置时间：unknown）',
    '📅 7d 剩余: unavailable（重置时间：unknown）',
    '',
    '📊 运行状态',
    '━━━━━━━━━━',
    ...(status.currentBinding ? [`📍 当前绑定: ${status.currentBinding}`] : []),
    ...(status.replyPolicy ? [`🔁 回复策略: ${status.replyPolicy}`] : []),
    `🗂️ 当前工作区: ${status.workspaceName}`,
    `💬 当前会话: ${status.currentSessionName}`,
    `🔢 会话数: ${status.sessionCount}`,
    `⚡ 状态: ${statusText}`,
    `📦 负载: ${queueStatus.activeContainerCount}/${queueStatus.maxContainers} 容器, ${queueStatus.activeHostProcessCount}/${queueStatus.maxHostProcesses} 进程`,
    `📍 cwd: ${status.cwd}`,
  ];

  return lines.join('\n');
}

function compactLifecycleMessageId(messageId: string): string {
  return messageId.length > 11 ? `...${messageId.slice(-11)}` : messageId;
}

export function formatImLifecycleStatus(
  events: readonly ImMessageLifecycleEvent[],
  issueEvents?: readonly ImMessageLifecycleEvent[],
): string {
  const lines: string[] = [];
  if (events.length === 0) {
    lines.push('🧭 飞书链路: 最近无记录');
  } else {
    const summary = events
      .slice(0, 3)
      .map((event) => {
        const reason = event.reason ? `(${event.reason})` : '';
        return `${compactLifecycleMessageId(event.message_id)} ${event.stage}${reason}`;
      })
      .join(' · ');
    lines.push(`🧭 飞书链路: ${summary}`);
  }

  const issueSummary = formatImLifecycleIssueSummary(issueEvents);
  if (issueSummary) {
    lines.push(issueSummary);
  }

  return lines.join('\n');
}

function formatImLifecycleIssueSummary(
  issueEvents?: readonly ImMessageLifecycleEvent[],
): string | null {
  const errorEvents =
    issueEvents?.filter((event) => event.status === 'error') ?? [];
  if (errorEvents.length === 0) return null;
  const issueSummary = errorEvents
    .slice(0, 3)
    .map((event) => {
      const reason = event.reason ? `(${event.reason})` : '';
      return `${compactLifecycleMessageId(event.message_id)} ${event.stage} ${event.status}${reason}`;
    })
    .join(' · ');
  return `⚠️ 飞书异常: ${issueSummary}`;
}

// ─── Conversation Status Formatting ────────────────────────────

export interface ConversationBindingInfo {
  type: 'default' | 'main' | 'agent';
  label: string;
  replyPolicy: string | null;
}

export interface ConversationStatusInfo {
  workspace: WorkspaceInfo;
  currentAgentId: string | null;
  currentOnMain: boolean;
  binding: ConversationBindingInfo;
}

/**
 * Format the current workspace's conversations and IM binding target for
 * /status. This stays pure so IM/Web route handlers can unit-test formatting
 * without touching DB state.
 */
export function formatConversationStatus(info: ConversationStatusInfo): string {
  const lines = [
    '🧵 会话与绑定',
    '━━━━━━━━━━',
    `📁 工作区: ${info.workspace.name} (${info.workspace.folder})`,
    `🔗 当前绑定: ${info.binding.label}`,
  ];

  if (info.binding.replyPolicy) {
    lines.push(`🔁 回复策略: ${info.binding.replyPolicy}`);
  }

  lines.push('💬 会话:');

  const mainPrefix = info.currentOnMain ? '▶' : '·';
  const mainCurrent = info.currentOnMain ? ' ← 当前' : '';
  lines.push(`  ${mainPrefix} 主对话${mainCurrent}`);

  for (const agent of info.workspace.agents) {
    const isCurrent = info.currentAgentId === agent.id;
    const marker = isCurrent ? '▶' : '·';
    const current = isCurrent ? ' ← 当前' : '';
    const shortId = agent.id.slice(0, 4);
    lines.push(
      `  ${marker} ${agent.name} [${shortId}] ${agent.status}${current}`,
    );
  }

  if (info.workspace.agents.length === 0) {
    lines.push('  · 暂无 conversation agent');
  }

  return lines.join('\n');
}

// ─── Self Iteration Formatting ─────────────────────────────────

export interface SelfBuildArtifactStatusInfo {
  stale: boolean;
  loadedMtimeIso: string | null;
  currentMtimeIso: string | null;
}

export interface SelfCheckResultInfo {
  status: 'passed' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  port: number;
  command: string;
  args: string[];
  cwd: string;
  tempHome: string;
  healthUrl: string;
  error: string | null;
  exitCode: number | null;
  signal: string | null;
  outputTail: string[];
}

export interface SelfStatusInfo {
  pid: number;
  startedAt: string;
  cwd: string;
  restart: {
    restartable: boolean;
    source: string;
    artifactMode?: string;
    displayCommand: string;
    validationError: string | null;
  };
  stale: boolean;
  backend: SelfBuildArtifactStatusInfo;
  agentRunner: SelfBuildArtifactStatusInfo;
  lastCheck: SelfCheckResultInfo | null;
  feishuIssueEvents?: readonly ImMessageLifecycleEvent[];
}

function formatMtime(value: string | null): string {
  return value || 'missing';
}

function formatArtifactLine(
  label: string,
  artifact: SelfBuildArtifactStatusInfo,
): string {
  const state = artifact.stale ? 'stale' : 'ok';
  const loaded = formatMtime(artifact.loadedMtimeIso);
  const current = formatMtime(artifact.currentMtimeIso);
  const suffix = artifact.stale ? `${loaded} → ${current}` : loaded;
  return `  ${label}: ${state} ${suffix}`;
}

export function formatSelfStatus(info: SelfStatusInfo): string {
  const sourceLaunched = info.restart.artifactMode === 'source';
  const buildState = sourceLaunched
    ? info.agentRunner.stale
      ? '源码运行，agent-runner build 需要重启'
      : '源码运行，dist build 仅供打包参考'
    : info.stale
      ? '需要重启'
      : '已是当前 build';
  const lastCheck = info.lastCheck
    ? `${info.lastCheck.status === 'passed' ? '通过' : '失败'} ${info.lastCheck.finishedAt}`
    : '未运行';
  const restartState = info.restart.restartable
    ? `可用 (${info.restart.source})`
    : `不可用 (${info.restart.source})`;

  const lines = [
    '🧭 自迭代状态',
    '━━━━━━━━━━',
    `🆔 PID: ${info.pid}`,
    `⏱️ 启动: ${info.startedAt}`,
    `📂 cwd: ${info.cwd}`,
    `🔁 自重启: ${restartState}`,
    `🚀 启动命令: ${info.restart.displayCommand || 'unknown'}`,
  ];

  if (!info.restart.restartable && info.restart.validationError) {
    lines.push(`⚠️ 原因: ${info.restart.validationError}`);
  }

  if (info.restart.source === 'direct_backend') {
    lines.push('⚠️ 启动模式: direct_backend 是开发直启路径');
    lines.push('✅ 推荐入口: cli-claw start / cli-claw restart');
  } else if (sourceLaunched) {
    lines.push('⚠️ 启动模式: repo-local source launcher 是开发入口');
    lines.push('✅ 推荐入口: cli-claw start / cli-claw restart');
  }

  lines.push(`📦 build: ${buildState}`);
  lines.push(formatArtifactLine('backend', info.backend));
  lines.push(formatArtifactLine('agent-runner', info.agentRunner));
  lines.push(
    `🧪 最近自检: ${lastCheck}`,
    '💡 /self-check 冷启动验证，不会重启当前服务',
  );

  const feishuIssueSummary = formatImLifecycleIssueSummary(
    info.feishuIssueEvents,
  );
  if (feishuIssueSummary) {
    lines.push(feishuIssueSummary);
  }

  return lines.join('\n');
}

export function formatSelfCheckResult(result: SelfCheckResultInfo): string {
  const command = [result.command, ...result.args].filter(Boolean).join(' ');
  const lines = [
    `🧪 自检结果: ${result.status === 'passed' ? '通过' : '失败'}`,
    '━━━━━━━━━━',
    `⏱️ 耗时: ${result.durationMs}ms`,
    `🚀 候选命令: ${command || 'unknown'}`,
    `🌐 端口: ${result.port}`,
    `📂 隔离 HOME: ${result.tempHome}`,
  ];

  if (result.status === 'passed') {
    lines.push('✅ 候选服务冷启动健康，当前服务未重启');
    return lines.join('\n');
  }

  lines.push(`❌ 原因: ${result.error || 'unknown error'}`);

  if (result.exitCode !== null || result.signal !== null) {
    const exitParts: string[] = [];
    if (result.exitCode !== null) exitParts.push(`code=${result.exitCode}`);
    if (result.signal !== null) exitParts.push(`signal=${result.signal}`);
    lines.push(`🚪 退出: ${exitParts.join(', ')}`);
  }

  if (result.outputTail.length > 0) {
    lines.push('📜 输出:');
    lines.push(...result.outputTail);
  }

  return lines.join('\n');
}

export interface SelfRestartAcceptedInfo {
  intentPath: string;
  watchdogPid: number | null;
}

export function formatSelfRestartAccepted(
  info: SelfRestartAcceptedInfo,
): string {
  return [
    '🔁 自重启已受理',
    '━━━━━━━━━━',
    `🧾 intent: ${info.intentPath}`,
    `👁️ watchdog PID: ${info.watchdogPid ?? 'unknown'}`,
    '💬 重启成功后会回到当前会话补发结果',
    '⚠️ 后续由独立 watchdog 执行；当前 IM 可能短暂离线',
  ].join('\n');
}

export interface SelfRestartSuccessInfo {
  intentPath: string;
  selfStatus: string;
  residualSummary: string;
}

export function formatSelfRestartSuccess(info: SelfRestartSuccessInfo): string {
  return [
    '✅ 自重启成功',
    '━━━━━━━━━━',
    `🧾 intent: ${info.intentPath}`,
    info.selfStatus,
    info.residualSummary,
  ].join('\n');
}
