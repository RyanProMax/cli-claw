import { ChildProcess, execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import {
  appendStreamPresentationText,
  classifyStreamPresentationTextChannel,
  createEmptyStreamPresentationTextState,
  type StreamPresentationTextState,
} from '../shared/dist/stream-presentation.js';
import type { StreamRuntimeIdentity } from '../shared/dist/stream-event.js';

import { CronExpressionParser } from 'cron-parser';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  TIMEZONE,
  WEB_PORT,
  updateWeChatNoProxy,
} from './core/config.js';
import { LAUNCH_CWD, resolveAppPath } from './core/app-root.js';
import { interruptibleSleep } from './messaging/notifier.js';
import {
  AvailableGroup,
  AgentProcessInput,
  AgentProcessOutput,
  runAgentProcess,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './agent/runner/container-runner.js';
import {
  closeDatabase,
  createTask,
  deleteExpiredSessions,
  getExpiredSessionIds,
  deleteTask,
  ensureChatExists,
  ensureUserHomeGroup,
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getJidsByFolder,
  getLastGroupSync,
  getRegisteredGroup,
  getRecentImMessageLifecycleEvents,
  getRecentImMessageLifecycleIssueEvents,
  getTaskRunLogs,
  getUserById,
  getLatestInterruptedPartialMessageSince,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  getRouterStateByPrefix,
  deleteRouterState,
  deleteRegisteredGroup,
  getTaskById,
  getUserHomeGroup,
  getMessagesPage,
  initDatabase,
  isGroupShared,
  listUsers,
  setLastGroupSync,
  setRegisteredGroup,
  setRouterState,
  setSession,
  deletePrimaryRuntimeSessions,
  deleteSession,
  storeMessageDirect,
  updateLatestMessageTokenUsage,
  updateChatName,
  updateTask,
  createAgent,
  getAgent,
  updateAgentStatus,
  updateAgentLastImJid,
  updateAgentInfo,
  deleteCompletedAgents,
  getRunningTaskAgentsByChat,
  markRunningTaskAgentsAsError,
  markAllRunningTaskAgentsAsError,
  markStaleSpawnAgentsAsError,
  listActiveConversationAgents,
  getSession,
  listAgentsByJid,
  getGroupsByOwner,
  addGroupMember,
  cleanupOldDailyUsage,
  cleanupOldBillingAuditLog,
  insertUsageRecord,
} from './storage/db.js';
// feishu.js deprecated exports are no longer needed; imManager handles all connections
import { imManager } from './messaging/manager.js';
import {
  getChannelType,
  extractChatId,
  type OutboundMessageMeta,
} from './messaging/channel.js';
import {
  buildRuntimeSelectionCard,
  registerStreamingSession,
  unregisterStreamingSession,
  hasActiveStreamingSession,
  abortAllStreamingSessions,
  registerMessageIdMapping,
  getStreamingSession,
  StreamingCardController,
} from './messaging/providers/feishu/streaming-card.js';
import {
  resolveVisibleReplyParts,
  type ResolvedVisibleReplyParts,
} from './presentation/reply-visibility.js';
import { type AssistantFooterTokenUsage } from './presentation/assistant-meta-footer.js';
import {
  recordDeadLetteredLifecycleForPendingMessages,
  recordDirectImDeliveryLifecycleForMessages,
  recordLifecycleForMessages,
  recordStreamStartedLifecycleForMessages,
} from './messaging/lifecycle.js';
import {
  buildProvisionalTokenUsage,
  normalizeFooterUsageForCurrentTurn,
  normalizeStreamingStatusText,
  serializeAssistantTokenUsage,
} from './presentation/streaming-runtime-meta.js';
import {
  formatImLifecycleStatus,
  formatSelfCheckResult,
  formatSelfRestartAccepted,
  formatSelfRestartSuccess,
  formatSelfStatus,
  formatWorkspaceList,
  formatSystemStatus,
  resolveBoundChatTarget,
  resolveLocationInfo,
  type WorkspaceInfo,
} from './messaging/command-utils.js';
import {
  applyRuntimeWorkspaceSelection,
  executeRuntimeWorkspaceCommand,
  resolveRuntimeWorkspaceTarget,
  type ResolvedRuntimeWorkspaceTarget,
} from './core/runtime/command-handler.js';
import { getAvailableRuntimeModelOptions } from './core/runtime/model-options.js';
import {
  attachRuntimeUsageFooterMeta,
  getRuntimeUsageSnapshot,
} from './core/runtime/usage.js';
import {
  discoverSkillCommands,
  executeDiscoveredSkillCommandResult,
  formatSkillCommandHelpLines,
  resolveSkillCommandRoots,
  type SkillCommandDiscoveryResult,
} from './skills/command-dispatch.js';
import { executeWorkflowCommand } from './agent/workflow/command.js';
import { listWorkflowRuns } from './agent/workflow/context.js';
import { encodeImSlashRewriteMessage } from './messaging/slash-command.js';
import {
  formatUnknownRuntimeCommandReply,
  parseRuntimeCommand,
  parseSlashCommandCandidate,
} from './core/runtime/command-registry.js';
import { createImNewWorkspaceGroup } from './messaging/new-workspace.js';
import { serializeErrorForOutput } from '../shared/dist/error-serialization.js';
import { resolveManagedSelfRestartCommand } from '../shared/dist/service-restart-guard.js';
import { invalidateSessionCache, getWebDeps } from './web/context.js';
import {
  getFeishuProviderConfigWithSource,
  getTelegramProviderConfig,
  getTelegramProviderConfigWithSource,
  getUserFeishuConfig,
  getUserTelegramConfig,
  getUserQQConfig,
  getUserWeChatConfig,
  getUserDingTalkConfig,
  getSystemSettings,
  getOpenAiRuntimeDefaults,
  saveUserFeishuConfig,
  saveUserTelegramConfig,
} from './core/runtime/config.js';
import type {
  FeishuConnectConfig,
  TelegramConnectConfig,
  QQConnectConfig,
  WeChatConnectConfig,
  DingTalkConnectConfig,
} from './messaging/manager.js';
import { GroupQueue } from './agent/queue/group-queue.js';
import { startSchedulerLoop, triggerTaskNow } from './agent/scheduler/index.js';
import {
  checkBillingAccessFresh,
  formatBillingAccessDeniedMessage,
  updateUsage,
  deductUsageCost,
  checkAndExpireSubscriptions,
  isBillingEnabled,
  getUserConcurrentProcessLimit,
  reconcileMonthlyUsage,
} from './core/billing.js';
import {
  AgentStatus,
  MessageCursor,
  MessageSourceKind,
  NewMessage,
  RegisteredGroup,
  RuntimeIdentity,
  StreamEvent,
  SubAgent,
} from './domain/types.js';
import { logger } from './core/logger.js';
import {
  getRuntimeBuildLogFields,
  getRuntimeBuildStatus,
} from './core/runtime/build.js';
import {
  buildEffectiveGroupFromHomeSibling,
  normalizeAgentType,
  resolveEffectiveRuntimeIdentity,
} from './core/runtime/group-runtime.js';
import {
  materializeWorkspaceDefaultCwd,
  validateWorkspaceCwd,
} from './core/workspace/workspace-cwd.js';
import { resolveTaskOwner } from './agent/task-utils.js';
import {
  ensureAgentDirectories,
  stripAgentInternalTags,
  stripVirtualJidSuffix,
} from './core/utils.js';
import { normalizeImageAttachments } from './messaging/attachments.js';
import {
  startWebServer,
  broadcastToWebClients,
  broadcastNewMessage,
  broadcastTyping,
  broadcastStreamEvent,
  broadcastAgentStatus,
  broadcastGroupCreated,
  broadcastBillingUpdate,
  shutdownWebServer,
  getActiveStreamingTexts,
  clearStreamingSnapshot,
} from './web/app.js';
import {
  installSkillForUser,
  deleteSkillForUser,
  syncHostSkillsForUser,
} from './web/routes/skills.js';
import { verifyPairingCode } from './messaging/providers/telegram-pairing.js';
import { executeSessionReset } from './commands.js';
import { formatLoopStatusSection } from './presentation/loop-status.js';
import { mergeRuntimeIdentity } from './core/runtime/identity.js';
import { runSelfCheck, type SelfCheckResult } from './core/self/self-check.js';
import {
  hasPendingSelfRestartForChat,
  findPendingSelfRestartNotifications,
  inspectAndCleanupResidualProcesses,
  markSelfRestartNotificationSent,
  readCurrentBackendRestartState,
  requestSelfRestart,
  resolveLaunchdServiceNameFromEnv,
  writeCurrentBackendRestartState,
} from './core/self/self-restart.js';
import {
  inferStartupLaunchSpecFromProcess,
  type StartupLaunchSpec,
} from './core/self/startup-launch.js';
import { compactMessagesForAgent } from './agent/runner/context-compaction.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const execFileAsync = promisify(execFile);
const DEFAULT_MAIN_JID = 'web:main';
const DEFAULT_MAIN_NAME = 'Main';
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9_-]+$/;
const OOM_EXIT_RE = /code 137/;
const SELF_CHECK_MODE = process.env.CLI_CLAW_SELF_CHECK === '1';
let lastSelfCheckResult: SelfCheckResult | null = null;
let selfCheckRunning = false;
let startupLaunchSpec: StartupLaunchSpec = inferStartupLaunchSpecFromProcess();

function getOpenAiRuntimeIdentityOptions(): {
  openAiModel: string | null;
  openAiReasoningEffort: string | null;
  openAiSpeedTier: string | null;
} {
  const fallback = getOpenAiRuntimeDefaults();
  return {
    openAiModel: fallback.model,
    openAiReasoningEffort: fallback.reasoningEffort,
    openAiSpeedTier: fallback.speedTier,
  };
}

function normalizeLogText(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

function previewTextForLog(
  value: string | null | undefined,
  maxLength = 220,
): string | null {
  const normalized = normalizeLogText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function firstNonEmptyLineForLog(
  value: string | null | undefined,
): string | null {
  const line = normalizeLogText(value)
    .split('\n')
    .find((candidate) => candidate.trim());
  return line ? line.trim().slice(0, 220) : null;
}

function startsWithResearchTitleForLog(
  value: string | null | undefined,
): boolean {
  return /^\*\*\/research｜[^*\n]+\*\*/u.test(
    normalizeLogText(value).trimStart(),
  );
}

function logOpenAiFinalVisibleReplyFields(input: {
  chatJid?: string;
  virtualChatJid?: string;
  group?: string;
  agentId?: string;
  turnId?: unknown;
  sessionId?: unknown;
  sdkMessageUuid?: unknown;
  sourceKind?: string | null;
  finalizationReason?: string | null;
  rawText: string;
  presentationText: StreamPresentationTextState;
  runtimeIdentity: RuntimeIdentity | null;
  visibleReplyParts: ResolvedVisibleReplyParts;
  message: string;
}): void {
  if (input.runtimeIdentity?.agentType !== 'openai') return;

  logger.info(
    {
      chatJid: input.chatJid,
      virtualChatJid: input.virtualChatJid,
      group: input.group,
      agentId: input.agentId,
      turnId: input.turnId,
      sessionId: input.sessionId,
      sdkMessageUuid: input.sdkMessageUuid,
      sourceKind: input.sourceKind || 'sdk_final',
      finalizationReason: input.finalizationReason || 'completed',
      runtimeIdentity: input.runtimeIdentity,
      rawFinalLength: input.rawText.length,
      rawFinalFirstLine: firstNonEmptyLineForLog(input.rawText),
      rawFinalPreview: previewTextForLog(input.rawText),
      presentationAnswerLength: input.presentationText.answerText.length,
      presentationAnswerFirstLine: firstNonEmptyLineForLog(
        input.presentationText.answerText,
      ),
      presentationAnswerPreview: previewTextForLog(
        input.presentationText.answerText,
      ),
      presentationCommentaryLength:
        input.presentationText.commentaryText.length,
      presentationCommentaryFirstLine: firstNonEmptyLineForLog(
        input.presentationText.commentaryText,
      ),
      presentationCommentaryPreview: previewTextForLog(
        input.presentationText.commentaryText,
      ),
      visibleTextLength: input.visibleReplyParts.visibleText.length,
      visibleFirstLine: firstNonEmptyLineForLog(
        input.visibleReplyParts.visibleText,
      ),
      visiblePreview: previewTextForLog(input.visibleReplyParts.visibleText),
      commentaryTextLength: input.visibleReplyParts.commentaryText.length,
      commentaryFirstLine: firstNonEmptyLineForLog(
        input.visibleReplyParts.commentaryText,
      ),
      commentaryPreview: previewTextForLog(
        input.visibleReplyParts.commentaryText,
      ),
      droppedPresentationAnswer: Boolean(
        input.visibleReplyParts.droppedPresentationAnswer,
      ),
      strippedLeadingCommentary:
        input.visibleReplyParts.visibleText.trim() !== input.rawText.trim(),
      startsWithResearchTitle: startsWithResearchTitleForLog(
        input.visibleReplyParts.visibleText,
      ),
    },
    input.message,
  );
}

/**
 * Feed a stream event into a Feishu streaming card controller.
 * Centralizes the event → card mapping for both main and sub-agent handlers.
 */
export function normalizeStreamEventUsageForCard(
  se: StreamEvent,
  startedAtMs: number,
): StreamEvent {
  if (se.eventType !== 'usage' || !se.usage) return se;
  return {
    ...se,
    usage: normalizeFooterUsageForCurrentTurn(se.usage, startedAtMs),
  };
}

export function feedStreamEventToCard(
  session: StreamingCardController,
  se: StreamEvent,
  presentationText: StreamPresentationTextState,
): void {
  if (se.runtimeIdentity) {
    session.setRuntimeIdentity(se.runtimeIdentity);
  }
  switch (se.eventType) {
    case 'text_delta':
      if (se.text) {
        const channel = classifyStreamPresentationTextChannel(
          se,
          se.runtimeIdentity,
        );
        if (!channel) break;
        if (channel === 'commentary') {
          session.appendCommentary(presentationText.commentaryText);
        } else {
          if (
            se.runtimeIdentity?.agentType === 'openai' &&
            presentationText.commentaryText.trim()
          ) {
            session.appendCommentary(presentationText.commentaryText);
          }
          if (presentationText.answerText) {
            session.append(presentationText.answerText);
          }
        }
      }
      break;
    case 'thinking_delta':
      if (se.text) {
        session.appendThinking(se.text);
      } else if (
        !presentationText.answerText &&
        !presentationText.commentaryText
      ) {
        // Only call setThinking() when no text was appended
        // (appendThinking already sets thinking=true and triggers card creation)
        session.setThinking();
      }
      break;
    case 'tool_use_start':
      if (se.toolUseId && se.toolName) {
        session.startTool(se.toolUseId, se.toolName);
        const label = se.skillName ? `技能 ${se.skillName}` : se.toolName;
        session.pushRecentEvent(`🔄 ${label}`);
      }
      break;
    case 'tool_use_end':
      if (se.toolUseId) {
        const info = session.getToolInfo(se.toolUseId);
        session.endTool(se.toolUseId, false);
        if (info) session.pushRecentEvent(`✅ ${info.name}`);
      }
      break;
    case 'tool_progress':
      if (se.toolUseId && se.toolInputSummary) {
        session.updateToolSummary(se.toolUseId, se.toolInputSummary);
      }
      break;
    case 'status':
      if (se.statusText && se.statusText !== 'interrupted') {
        session.setSystemStatus(normalizeStreamingStatusText(se.statusText));
      }
      break;
    case 'hook_started':
      session.setHook({
        hookName: se.hookName || '',
        hookEvent: se.hookEvent || '',
      });
      break;
    case 'hook_response':
      if (se.hookName) {
        session.pushRecentEvent(`✅ Hook: ${se.hookName}`);
      }
      session.setHook(null);
      break;
    case 'todo_update':
      if (se.todos) session.setTodos(se.todos);
      break;
    case 'task_start':
      if (se.toolUseId) {
        const label = se.taskDescription
          ? `Task: ${se.taskDescription.slice(0, 40)}`
          : 'Task';
        session.startTool(se.toolUseId, label);
        session.pushRecentEvent(`🚀 ${label}`);
      }
      break;
    case 'task_notification':
      if (se.toolUseId || se.taskId) {
        const id = se.toolUseId || se.taskId || '';
        session.endTool(id, false);
        const label = se.taskSummary
          ? `Task: ${se.taskSummary.slice(0, 40)}`
          : 'Task 完成';
        session.pushRecentEvent(`✅ ${label}`);
      }
      break;
    case 'hook_progress':
      // Update hook state (no card push needed — card already shows hook indicator)
      session.setHook({
        hookName: se.hookName || '',
        hookEvent: se.hookEvent || '',
      });
      break;
    case 'usage':
      if (se.usage) session.patchUsageNote(se.usage);
      break;
    case 'init':
      // Internal signal, no card display needed
      break;
  }
}

export function syncTerminalPresentationTextToCard(
  session: StreamingCardController,
  presentationText: StreamPresentationTextState,
  commentaryTextOverride?: string,
): void {
  if (commentaryTextOverride === undefined) return;

  const commentaryText = commentaryTextOverride ?? '';
  if (commentaryText.trim()) {
    session.appendCommentary(commentaryText);
    return;
  }

  if (presentationText.commentaryText.trim()) {
    session.appendCommentary('');
  }
}

export interface StreamingTurnBoundaryState {
  turnId?: string;
  messageCursorId?: string;
  startedAtMs?: number;
  presentationText: StreamPresentationTextState;
  thinkingText: string;
  interrupted: boolean;
}

function buildResetStreamingTurnBoundaryState(
  turnId?: string,
  messageCursorId?: string,
  startedAtMs?: number,
): StreamingTurnBoundaryState {
  return {
    ...(turnId ? { turnId } : {}),
    ...(messageCursorId ? { messageCursorId } : {}),
    ...(typeof startedAtMs === 'number' ? { startedAtMs } : {}),
    presentationText: createEmptyStreamPresentationTextState(),
    thinkingText: '',
    interrupted: false,
  };
}

export function applyStreamingTurnBoundary(
  current: StreamingTurnBoundaryState,
  event: Pick<StreamEvent, 'turnId' | 'messageCursor'>,
  nowMs?: number,
): { nextState: StreamingTurnBoundaryState; turnChanged: boolean } {
  const nextTurnId = event.turnId?.trim() || undefined;
  const nextMessageCursorId = event.messageCursor?.id?.trim() || undefined;
  if (!nextTurnId && !nextMessageCursorId) {
    return { nextState: current, turnChanged: false };
  }

  if (!current.turnId && !current.messageCursorId) {
    const startedAtMs =
      typeof current.startedAtMs === 'number'
        ? typeof nowMs === 'number'
          ? nowMs
          : Date.now()
        : undefined;
    return {
      nextState: {
        ...current,
        ...(nextTurnId ? { turnId: nextTurnId } : {}),
        ...(nextMessageCursorId
          ? { messageCursorId: nextMessageCursorId }
          : {}),
        ...(typeof startedAtMs === 'number' ? { startedAtMs } : {}),
      },
      turnChanged: false,
    };
  }

  const turnChanged = Boolean(
    nextTurnId && current.turnId && current.turnId !== nextTurnId,
  );
  const cursorChanged = Boolean(
    nextMessageCursorId &&
    current.messageCursorId &&
    current.messageCursorId !== nextMessageCursorId,
  );
  if (!turnChanged && !cursorChanged) {
    const nextState =
      nextMessageCursorId && !current.messageCursorId
        ? { ...current, messageCursorId: nextMessageCursorId }
        : current;
    if (nextTurnId && !nextState.turnId) {
      return {
        nextState: { ...nextState, turnId: nextTurnId },
        turnChanged: false,
      };
    }
    return { nextState, turnChanged: false };
  }

  return {
    nextState: buildResetStreamingTurnBoundaryState(
      nextTurnId,
      nextMessageCursorId,
      typeof current.startedAtMs === 'number'
        ? typeof nowMs === 'number'
          ? nowMs
          : Date.now()
        : undefined,
    ),
    turnChanged: true,
  };
}

export function resetStreamingTurnBoundaryForNewInput(
  _current?: StreamingTurnBoundaryState,
): StreamingTurnBoundaryState {
  return buildResetStreamingTurnBoundaryState();
}

export function shouldRebuildStreamingSessionBeforeEvent(
  session:
    | Pick<StreamingCardController, 'currentState' | 'isActive'>
    | undefined,
): boolean {
  if (!session) return false;
  if (session.isActive()) return false;
  return session.currentState !== 'idle';
}

let globalMessageCursor: MessageCursor = { timestamp: '', id: '' };
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, MessageCursor> = {};
// Recovery-safe cursor: only advances when an agent actually finishes processing.
// recoverPendingMessages() uses this to detect IPC-injected but unprocessed messages.
let lastCommittedCursor: Record<string, MessageCursor> = {};
export interface PersistedStreamingTurnState {
  commitJid: string;
  replyJid: string;
  snapshotJid: string;
  cursor: MessageCursor;
  turnId?: string;
  messageCursorId?: string;
}
export interface StreamingRecoveryEntry extends PersistedStreamingTurnState {
  streamingKey: string;
  partialText: string;
  commentaryText: string;
}

export interface ActiveStreamingTextSnapshot {
  partialText: string;
  commentaryText: string;
  turnId?: string;
  messageCursorId?: string;
}
let activeStreamingTurns: Record<string, PersistedStreamingTurnState> = {};

export function buildStreamingShutdownKey(
  chatJid: string,
  relatedJids: string[] = [],
  agentId?: string,
): string {
  const baseJid = chatJid.startsWith('web:')
    ? chatJid
    : relatedJids.find((jid) => jid.startsWith('web:')) || chatJid;
  return agentId ? `${baseJid}#agent:${agentId}` : baseJid;
}

export function buildStreamingTurnStateKey(
  chatJid: string,
  agentId?: string,
): string {
  return agentId ? `${chatJid}#agent:${agentId}` : chatJid;
}

export function applyActiveStreamingTurnCommittedCursor(
  committedCursors: Record<string, MessageCursor>,
  recoveryEntry: Pick<PersistedStreamingTurnState, 'commitJid' | 'cursor'>,
): Record<string, MessageCursor> {
  const current = committedCursors[recoveryEntry.commitJid];
  if (current && !isCursorAfter(recoveryEntry.cursor, current)) {
    return committedCursors;
  }
  return {
    ...committedCursors,
    [recoveryEntry.commitJid]: recoveryEntry.cursor,
  };
}

export function applyShutdownInterruptedStreamingCommittedCursor(
  committedCursors: Record<string, MessageCursor>,
  _recoveryEntry: Pick<
    PersistedStreamingTurnState,
    'commitJid' | 'cursor' | 'replyJid'
  >,
  _options: { imDeliverySuppressed?: boolean } = {},
): Record<string, MessageCursor> {
  return committedCursors;
}

export function resolveConversationAgentRecoveryCursor(
  committedCursors: Readonly<Record<string, MessageCursor>>,
  virtualChatJid: string,
): MessageCursor | null {
  return committedCursors[virtualChatJid] ?? null;
}

export function buildStreamingRecoveryEntries(
  streamingTurns: Readonly<Record<string, PersistedStreamingTurnState>>,
  activeTexts: ReadonlyMap<string, ActiveStreamingTextSnapshot>,
): StreamingRecoveryEntry[] {
  return Object.entries(streamingTurns)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([streamingKey, state]) => {
      const snapshotText = activeTexts.get(state.snapshotJid);
      const keyedText = activeTexts.get(streamingKey);
      const activeText = snapshotText ?? keyedText;
      return {
        streamingKey,
        commitJid: state.commitJid,
        replyJid: state.replyJid,
        snapshotJid: state.snapshotJid,
        cursor: state.cursor,
        partialText:
          snapshotText?.partialText.trim() ??
          keyedText?.partialText.trim() ??
          '',
        commentaryText:
          snapshotText?.commentaryText.trim() ??
          keyedText?.commentaryText.trim() ??
          '',
        ...(state.turnId || activeText?.turnId
          ? { turnId: state.turnId ?? activeText?.turnId }
          : {}),
        ...(state.messageCursorId || activeText?.messageCursorId
          ? {
              messageCursorId:
                state.messageCursorId ?? activeText?.messageCursorId,
            }
          : {}),
      };
    });
}

export function ensureLateBoundStreamingSession<T>(
  currentSession: T | undefined,
  options: {
    createJid: string | null | undefined;
    registerJid: string;
    isChannelAvailable: (jid: string) => boolean;
    createSession: (jid: string) => T | undefined;
    registerSession: (jid: string, session: T) => void;
  },
): T | undefined {
  if (currentSession) return currentSession;
  const {
    createJid,
    registerJid,
    isChannelAvailable,
    createSession,
    registerSession,
  } = options;
  if (!createJid || !isChannelAvailable(createJid)) {
    return undefined;
  }
  const nextSession = createSession(createJid);
  if (!nextSession) {
    return undefined;
  }
  registerSession(registerJid, nextSession);
  return nextSession;
}

function normalizeStreamingTurnState(
  streamingKey: string,
  value: unknown,
): PersistedStreamingTurnState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const maybeCommitJid = (value as { commitJid?: unknown }).commitJid;
  if (typeof maybeCommitJid !== 'string' || !maybeCommitJid) {
    return null;
  }
  const maybeReplyJid = (value as { replyJid?: unknown }).replyJid;
  const maybeSnapshotJid = (value as { snapshotJid?: unknown }).snapshotJid;
  const maybeTurnId = (value as { turnId?: unknown }).turnId;
  const maybeMessageCursorId = (value as { messageCursorId?: unknown })
    .messageCursorId;
  return {
    commitJid: maybeCommitJid,
    replyJid:
      typeof maybeReplyJid === 'string' && maybeReplyJid
        ? maybeReplyJid
        : maybeCommitJid,
    snapshotJid:
      typeof maybeSnapshotJid === 'string' && maybeSnapshotJid
        ? maybeSnapshotJid
        : streamingKey,
    cursor: normalizeCursor((value as { cursor?: unknown }).cursor),
    ...(typeof maybeTurnId === 'string' && maybeTurnId
      ? { turnId: maybeTurnId }
      : {}),
    ...(typeof maybeMessageCursorId === 'string' && maybeMessageCursorId
      ? { messageCursorId: maybeMessageCursorId }
      : {}),
  };
}

function resolveStreamingSnapshotKey(
  chatJid: string,
  agentId?: string,
): string {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  const relatedJids = group ? getJidsByFolder(group.folder) : [];
  return buildStreamingShutdownKey(chatJid, relatedJids, agentId);
}

function setActiveStreamingTurn(
  streamingKey: string,
  commitJid: string,
  cursor: MessageCursor,
  replyJid: string,
  snapshotJid: string,
  metadata: { turnId?: string; messageCursorId?: string } = {},
): void {
  const current = activeStreamingTurns[streamingKey];
  if (
    current &&
    current.commitJid === commitJid &&
    current.replyJid === replyJid &&
    current.snapshotJid === snapshotJid &&
    current.turnId === metadata.turnId &&
    current.messageCursorId === metadata.messageCursorId &&
    !isCursorAfter(cursor, current.cursor)
  ) {
    return;
  }
  activeStreamingTurns = {
    ...activeStreamingTurns,
    [streamingKey]: {
      commitJid,
      replyJid,
      snapshotJid,
      cursor,
      ...(metadata.turnId ? { turnId: metadata.turnId } : {}),
      ...(metadata.messageCursorId
        ? { messageCursorId: metadata.messageCursorId }
        : {}),
    },
  };
  saveState();
}

function updateActiveStreamingTurnReplyJid(
  streamingKey: string,
  replyJid: string,
): void {
  const current = activeStreamingTurns[streamingKey];
  if (!current || current.replyJid === replyJid) return;
  activeStreamingTurns = {
    ...activeStreamingTurns,
    [streamingKey]: {
      ...current,
      replyJid,
    },
  };
  saveState();
}

function clearActiveStreamingTurns(streamingKeys: Iterable<string>): boolean {
  const next = { ...activeStreamingTurns };
  let changed = false;
  for (const streamingKey of streamingKeys) {
    if (streamingKey in next) {
      delete next[streamingKey];
      changed = true;
    }
  }
  if (changed) {
    activeStreamingTurns = next;
  }
  return changed;
}

/** Set both cursors directly (no max-merge) and persist. */
function setCursors(jid: string, cursor: MessageCursor): void {
  lastAgentTimestamp[jid] = cursor;
  lastCommittedCursor[jid] = cursor;
  saveState();
}

/** Advance only the accepted-message cursor without changing committed recovery state. */
function setLastAgentCursor(jid: string, cursor: MessageCursor): void {
  lastAgentTimestamp[jid] = cursor;
  saveState();
}

/** Advance cursors to `candidate`, never regressing behind existing position. */
function advanceCursors(jid: string, candidate: MessageCursor): void {
  const current = lastAgentTimestamp[jid];
  const target =
    current && current.timestamp > candidate.timestamp ? current : candidate;
  lastAgentTimestamp[jid] = target;
  lastCommittedCursor[jid] = target;
  saveState();
}
let messageLoopRunning = false;
let ipcWatcherRunning = false;
let shuttingDown = false;

// ── IPC Watcher Manager (event-driven fs.watch + fallback polling) ──

class IpcWatcherManager {
  private watchers = new Map<
    string,
    { watchers: fs.FSWatcher[]; refCount: number }
  >();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private processingFolders = new Set<string>();
  private pendingReprocess = new Set<string>();
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private processGroupFn: ((folder: string) => Promise<void>) | null = null;
  private processFullFn: (() => Promise<void>) | null = null;

  /** Bind the per-group and full-scan processing functions (set once from startIpcWatcher). */
  bind(
    processGroup: (folder: string) => Promise<void>,
    processFull: () => Promise<void>,
  ): void {
    this.processGroupFn = processGroup;
    this.processFullFn = processFull;
  }

  /** Start watching a group's IPC directories. Called when a runner starts. */
  watchGroup(folder: string): void {
    const existing = this.watchers.get(folder);
    if (existing) {
      existing.refCount++;
      return;
    }

    const groupIpcRoot = path.join(DATA_DIR, 'ipc', folder);
    const dirsToWatch = [
      path.join(groupIpcRoot, 'messages'),
      path.join(groupIpcRoot, 'tasks'),
    ];

    const folderWatchers: fs.FSWatcher[] = [];
    for (const dir of dirsToWatch) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        // Listen to all event types — 'rename' covers atomic writes on Linux,
        // while some filesystems may emit 'change' instead.
        const w = fs.watch(dir, () => {
          this.debouncedProcess(folder);
        });
        w.on('error', () => {
          // Watcher error — fallback polling will handle it
        });
        folderWatchers.push(w);
      } catch {
        // Watch failed — fallback polling will handle it
      }
    }
    this.watchers.set(folder, { watchers: folderWatchers, refCount: 1 });
  }

  /** Stop watching a group's IPC directories. Called when a runner stops. */
  unwatchGroup(folder: string): void {
    const entry = this.watchers.get(folder);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount > 0) return;

    for (const w of entry.watchers) {
      try {
        w.close();
      } catch {}
    }
    this.watchers.delete(folder);
    const timer = this.debounceTimers.get(folder);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(folder);
    }
  }

  private debouncedProcess(folder: string): void {
    const existing = this.debounceTimers.get(folder);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      folder,
      setTimeout(() => {
        this.debounceTimers.delete(folder);
        // Skip if a previous processGroupIpc call for this folder is still running;
        // the pending flag ensures we re-process after the current run finishes.
        if (this.processingFolders.has(folder)) {
          this.pendingReprocess.add(folder);
          return;
        }
        this.processingFolders.add(folder);
        this.processGroupFn?.(folder)
          .catch((err) => {
            logger.error({ err, folder }, 'Error processing IPC for group');
          })
          .finally(() => {
            this.processingFolders.delete(folder);
            // Files may have arrived during processing — run once more
            if (
              this.pendingReprocess.delete(folder) &&
              this.watchers.has(folder)
            ) {
              this.debouncedProcess(folder);
            }
          });
      }, 100),
    );
  }

  /** Trigger processing for a folder through the concurrency guard. */
  triggerProcess(folder: string): void {
    this.debouncedProcess(folder);
  }

  /** Start fallback polling (every 5s) as safety net for inotify failures. */
  startFallback(): void {
    this.fallbackTimer = setInterval(() => {
      if (shuttingDown) return;
      this.processFullFn?.().catch((err) => {
        logger.error({ err }, 'Error in IPC fallback scan');
      });
    }, 5000);
    this.fallbackTimer.unref(); // Don't prevent process from naturally exiting
  }

  /** Close all watchers and timers. */
  closeAll(): void {
    for (const [, entry] of this.watchers) {
      for (const w of entry.watchers) {
        try {
          w.close();
        } catch {}
      }
    }
    this.watchers.clear();
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }
}

let ipcWatcherManager: IpcWatcherManager | null = null;
/** JIDs already persisted by the shutdown handler — prevents finally blocks from duplicating. */
const shutdownSavedJids = new Set<string>();

const queue = new GroupQueue();
const EMPTY_CURSOR: MessageCursor = { timestamp: '', id: '' };
const STUCK_RUNNER_CHECK_INTERVAL_POLLS = 15;
const STUCK_RUNNER_IDLE_MS = 6 * 60 * 1000;
let stuckRunnerCheckCounter = 0;

// OOM auto-recovery: track consecutive OOM (exit code 137) exits per folder.
// After OOM_AUTO_RESET_THRESHOLD consecutive OOMs, auto-clear the session.
const consecutiveOomExits: Record<string, number> = {};
const OOM_AUTO_RESET_THRESHOLD = 2;

// Per-folder reply route updater: lets sendMessage callers update the
// reply routing of a running processGroupMessages without killing the process.
// Key is group folder (one active processGroupMessages per folder).
type ReplyRouteUpdater = (
  newSourceJid: string | null,
  lifecycleMessages?: NewMessage[],
) => void;
const activeRouteUpdaters = new Map<string, ReplyRouteUpdater>();

// Per-folder IM reply route: tracks the current replySourceImJid for each
// running processGroupMessages.  IPC watcher reads this to forward send_message
// outputs to the correct IM channel (the running session holds the truth).
const activeImReplyRoutes = new Map<string, string | null>();

// Per-folder Feishu-origin turn context for direct IPC tools such as send_image
// and send_file. The IPC watcher is decoupled from runner output callbacks, so it
// reads this to attach delivery evidence to the active inbound message ids.
const activeImLifecycleMessages = new Map<string, NewMessage[]>();

// Track consecutive IM send failures per JID for auto-unbind
const imSendFailCounts = new Map<string, number>();
const IM_SEND_FAIL_THRESHOLD = 3;

// Groups whose pending messages were recovered after a restart.
const recoveryGroups = new Set<string>();
const agentRecoveryVirtualJids = new Set<string>();

type InterruptedResumeDecisionAction = 'none' | 'use_current';

interface InterruptedResumeDecision {
  action: InterruptedResumeDecisionAction;
  messagesForAgent: NewMessage[];
}

// Track consecutive IM health check failures per JID for safe auto-unbind
const imHealthCheckFailCounts = new Map<string, number>();
const IM_HEALTH_CHECK_FAIL_THRESHOLD = 3;
const RELATIVE_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
]);

/** Unbind an IM group from its conversation agent or main conversation, syncing DB + in-memory cache + failure counters. */
function unbindImGroup(jid: string, reason: string): void {
  const group = registeredGroups[jid] ?? getRegisteredGroup(jid);
  if (!group?.target_agent_id && !group?.target_main_jid) return;
  const agentId = group.target_agent_id;
  const targetMainJid = group.target_main_jid;
  const updated = {
    ...group,
    target_agent_id: undefined,
    target_main_jid: undefined,
    reply_policy: 'source_only' as const,
  };
  setRegisteredGroup(jid, updated);
  registeredGroups[jid] = updated;
  imSendFailCounts.delete(jid);
  imHealthCheckFailCounts.delete(jid);
  logger.info({ jid, agentId, targetMainJid }, reason);
}

/**
 * Resolve the workspace folder an IM chat should use for file downloads and
 * execution context. Bound targets take precedence over the source IM folder.
 */
function resolveEffectiveFolder(chatJid: string): string | undefined {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group) return undefined;

  if (group.target_agent_id) {
    const agent = getAgent(group.target_agent_id);
    const agentParent = agent
      ? (registeredGroups[agent.chat_jid] ?? getRegisteredGroup(agent.chat_jid))
      : null;
    return agentParent?.folder || group.folder;
  }

  if (group.target_main_jid) {
    const targetGroup =
      registeredGroups[group.target_main_jid] ??
      getRegisteredGroup(group.target_main_jid);
    return targetGroup?.folder || group.target_main_jid.replace(/^web:/, '');
  }

  return group.folder;
}

/**
 * Resolve the effective group for a non-home group by finding its sibling home group.
 * Non-home groups use their own workspace cwd unless a sibling home group
 * provides inherited runtime defaults.
 * Populates registeredGroups cache as a side-effect.
 */
function resolveEffectiveGroup(group: RegisteredGroup): {
  effectiveGroup: RegisteredGroup;
  isHome: boolean;
} {
  if (group.is_home) return { effectiveGroup: group, isHome: true };

  const siblingJids = getJidsByFolder(group.folder);
  for (const jid of siblingJids) {
    const sibling = registeredGroups[jid] ?? getRegisteredGroup(jid);
    if (sibling && !registeredGroups[jid]) registeredGroups[jid] = sibling;
    if (sibling?.is_home) {
      return {
        effectiveGroup: buildEffectiveGroupFromHomeSibling(group, sibling),
        isHome: true,
      };
    }
  }

  return { effectiveGroup: group, isHome: false };
}

/**
 * Materialize the CLI launch cwd into any persisted workspace missing customCwd.
 * Keeps the default cwd explicit in the database instead of relying on an in-memory fallback.
 */
function reconcileWorkspaceDefaults(launchCwd: string): void {
  for (const [jid, group] of Object.entries(registeredGroups)) {
    const materialized = materializeWorkspaceDefaultCwd(group, {
      launchCwd,
      fieldLabel: group.customCwd ? 'custom_cwd' : 'CLI launch cwd',
    });
    if ('error' in materialized) {
      if (group.customCwd) {
        logger.warn(
          {
            jid,
            folder: group.folder,
            customCwd: group.customCwd,
            error: materialized.error,
          },
          'Skipping workspace with invalid persisted custom cwd during startup',
        );
        continue;
      }
      throw new Error(materialized.error);
    }
    if (materialized.materialized) {
      setRegisteredGroup(jid, materialized.group);
      registeredGroups[jid] = materialized.group;
      logger.info(
        {
          jid,
          folder: materialized.group.folder,
          customCwd: materialized.group.customCwd,
        },
        'Materialized workspace custom cwd from CLI launch cwd',
      );
    }
  }
}

/** Recursively search for a file by name in subdirectories (max 3 levels). */
function findFileInSubdirs(
  dir: string,
  fileName: string,
  depth = 0,
): string | null {
  if (depth > 3) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) return fullPath;
      if (entry.isDirectory()) {
        const found = findFileInSubdirs(fullPath, fileName, depth + 1);
        if (found) return found;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Resolve the owner's home folder for user-scoped runtime resources. */
function resolveOwnerHomeFolder(group: RegisteredGroup): string {
  if (group.created_by) {
    return getUserHomeGroup(group.created_by)?.folder || group.folder;
  }
  return group.folder;
}

export function selectFeishuStartupBackfillChatIds(
  userId: string,
  groups: Record<string, RegisteredGroup>,
): string[] {
  const userFolders = new Set<string>();
  for (const group of Object.values(groups)) {
    if (group.created_by === userId) {
      userFolders.add(group.folder);
    }
  }

  const chatIds: string[] = [];
  const seen = new Set<string>();
  for (const [jid, group] of Object.entries(groups)) {
    if (!jid.startsWith('feishu:')) continue;
    if (group.created_by !== userId && !userFolders.has(group.folder)) {
      continue;
    }
    const chatId = extractChatId(jid);
    if (seen.has(chatId)) continue;
    seen.add(chatId);
    chatIds.push(chatId);
  }
  return chatIds;
}

export function shouldStartStartupMessageRecovery({
  selfCheckMode,
  imConnectionPhaseComplete,
}: {
  selfCheckMode: boolean;
  imConnectionPhaseComplete: boolean;
}): boolean {
  return !selfCheckMode && imConnectionPhaseComplete;
}

/**
 * Write usage records from a usage event to the database.
 * Handles both modelUsage (per-model breakdown) and legacy flat format.
 * When modelUsage is present, root-level cache tokens are assigned to the first model entry.
 */
function writeUsageRecords(opts: {
  userId: string;
  groupFolder: string;
  messageId?: string;
  agentId?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
    durationMs: number;
    numTurns: number;
    modelUsage?: Record<
      string,
      { inputTokens: number; outputTokens: number; costUSD: number }
    >;
  };
}): void {
  const { userId, groupFolder, messageId, agentId, usage } = opts;
  if (usage.modelUsage) {
    const models = Object.entries(usage.modelUsage);
    let cacheReadAssigned = false;
    for (const [model, mu] of models) {
      insertUsageRecord({
        userId,
        groupFolder,
        agentId,
        messageId,
        model,
        inputTokens: mu.inputTokens,
        outputTokens: mu.outputTokens,
        // Assign root-level cache tokens to the first model entry
        cacheReadInputTokens: cacheReadAssigned
          ? 0
          : usage.cacheReadInputTokens,
        cacheCreationInputTokens: cacheReadAssigned
          ? 0
          : usage.cacheCreationInputTokens,
        costUSD: mu.costUSD,
        durationMs: usage.durationMs,
        numTurns: usage.numTurns,
        source: 'agent',
      });
      cacheReadAssigned = true;
    }
  } else {
    insertUsageRecord({
      userId,
      groupFolder,
      agentId,
      messageId,
      model: 'unknown',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      costUSD: usage.costUSD,
      durationMs: usage.durationMs,
      numTurns: usage.numTurns,
      source: 'agent',
    });
  }
}

/**
 * Detect Feishu interactive card JSON and extract readable text for web display.
 * Returns null if the text is not a Feishu card.
 */
function extractFeishuCardText(text: string): string | null {
  if (!text.startsWith('{"type":"interactive"')) return null;
  try {
    const card = JSON.parse(text);
    if (card.type !== 'interactive' || !card.card) return null;
    const parts: string[] = [];
    // Extract header title
    const title = card.card.header?.title?.content;
    if (title) parts.push(`**${title}**\n`);
    // Extract markdown content from elements
    for (const el of card.card.elements || []) {
      if (el.tag === 'markdown' && el.content) {
        parts.push(el.content);
      } else if (el.tag === 'column_set') {
        for (const col of el.columns || []) {
          for (const colEl of col.elements || []) {
            if (colEl.tag === 'markdown' && colEl.content) {
              parts.push(colEl.content);
            }
          }
        }
      } else if (el.tag === 'note') {
        for (const noteEl of el.elements || []) {
          if (noteEl.content) parts.push(`_${noteEl.content}_`);
        }
      }
    }
    return parts.length > 0 ? parts.join('\n\n') : null;
  } catch {
    return null;
  }
}

/** Send a message to an IM channel with automatic fail-count tracking and auto-unbind. */
function extractLocalImImagePaths(
  text: string,
  groupFolder?: string,
): string[] {
  if (!groupFolder || !text) return [];

  const workspaceRoot = path.resolve(GROUPS_DIR, groupFolder);
  const seen = new Set<string>();
  const imagePaths: string[] = [];
  const candidates: string[] = [];
  const markdownImageRe = /!\[[^\]]*]\(([^)]+)\)/g;
  const taggedImageRe = /\[图片:\s*([^\]\n]+)\]/g;

  const pushCandidate = (raw: string): void => {
    const trimmed = raw.trim().replace(/^<|>$/g, '');
    const pathToken = trimmed
      .split(/\s+/)[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, '');
    if (
      !pathToken ||
      pathToken.startsWith('/') ||
      pathToken.startsWith('data:') ||
      /^[a-z]+:\/\//i.test(pathToken)
    ) {
      return;
    }
    candidates.push(pathToken);
  };

  for (const match of text.matchAll(markdownImageRe)) {
    pushCandidate(match[1] || '');
  }
  for (const match of text.matchAll(taggedImageRe)) {
    pushCandidate(match[1] || '');
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(workspaceRoot, candidate);
    const ext = path.extname(resolved).toLowerCase();
    if (!RELATIVE_IMAGE_EXTENSIONS.has(ext)) continue;
    if (
      resolved !== workspaceRoot &&
      !resolved.startsWith(workspaceRoot + path.sep)
    )
      continue;
    if (seen.has(resolved)) continue;
    try {
      if (!fs.statSync(resolved).isFile()) continue;
      seen.add(resolved);
      imagePaths.push(resolved);
    } catch {
      continue;
    }
  }

  return imagePaths;
}

/**
 * Generic IM operation retry with linear backoff (2s, 4s, 6s).
 * Returns true on success, false when all retries are exhausted.
 */
const IM_SEND_MAX_RETRIES = 3;
const IM_SEND_RETRY_DELAY_MS = 2_000;

async function retryImOperation(
  label: string,
  imJid: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < IM_SEND_MAX_RETRIES; attempt++) {
    try {
      await fn();
      return true;
    } catch (err) {
      logger.warn(
        { imJid, attempt, label, err },
        'IM operation attempt failed',
      );
      if (attempt < IM_SEND_MAX_RETRIES - 1) {
        await new Promise((r) =>
          setTimeout(r, IM_SEND_RETRY_DELAY_MS * (attempt + 1)),
        );
      }
    }
  }
  logger.error({ imJid, label }, 'IM operation failed after all retries');
  return false;
}

/**
 * Send an IM message with retry.
 * On final failure, increments imSendFailCounts and may auto-unbind the IM group.
 */
async function sendImWithRetry(
  imJid: string,
  text: string,
  localImagePaths: string[],
): Promise<boolean> {
  const ok = await retryImOperation('send_message', imJid, () =>
    imManager.sendMessage(imJid, text, localImagePaths),
  );
  if (ok) {
    imSendFailCounts.delete(imJid);
    return true;
  }
  // All retries exhausted — track cumulative failures
  const count = (imSendFailCounts.get(imJid) ?? 0) + 1;
  imSendFailCounts.set(imJid, count);
  if (count >= IM_SEND_FAIL_THRESHOLD) {
    try {
      unbindImGroup(
        imJid,
        'Auto-unbound IM group after consecutive send failures',
      );
    } catch (unbindErr) {
      logger.error({ imJid, unbindErr }, 'Failed to auto-unbind IM group');
    }
  }
  return false;
}

export interface SendImWithFailTrackingOptions {
  lifecycleMessages?: NewMessage[];
  lifecycleDetails?: Record<string, unknown>;
  sendWithRetry?: (
    imJid: string,
    text: string,
    localImagePaths: string[],
  ) => Promise<boolean>;
  recordLifecycle?: typeof recordLifecycleForMessages;
}

/** Fire-and-forget wrapper for sendImWithRetry (used in non-await contexts). */
export function sendImWithFailTracking(
  imJid: string,
  text: string,
  localImagePaths: string[],
  options: SendImWithFailTrackingOptions = {},
): Promise<void> {
  const sendWithRetry = options.sendWithRetry ?? sendImWithRetry;
  const recordLifecycle = options.recordLifecycle ?? recordLifecycleForMessages;
  return sendWithRetry(imJid, text, localImagePaths)
    .then((sent) => {
      if (options.lifecycleMessages) {
        recordLifecycle({
          messages: options.lifecycleMessages,
          stage: 'im_delivered',
          status: sent ? 'ok' : 'error',
          reason: sent ? null : 'send_failed_after_retries',
          details: {
            ...(options.lifecycleDetails ?? {}),
            targetJid: imJid,
          },
        });
      }
    })
    .catch(() => {});
}

export function isCursorAfter(
  candidate: MessageCursor,
  base: MessageCursor,
): boolean {
  if (candidate.timestamp > base.timestamp) return true;
  if (candidate.timestamp < base.timestamp) return false;
  return candidate.id > base.id;
}

export function normalizeCursor(value: unknown): MessageCursor {
  if (typeof value === 'string') {
    return { timestamp: value, id: '' };
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { timestamp?: unknown }).timestamp === 'string'
  ) {
    const maybeId = (value as { id?: unknown }).id;
    return {
      timestamp: (value as { timestamp: string }).timestamp,
      id: typeof maybeId === 'string' ? maybeId : '',
    };
  }
  return { ...EMPTY_CURSOR };
}

export function resolveMessageProcessingCursor(
  chatJid: string,
  lastAgentTimestampMap: Record<string, MessageCursor>,
  lastCommittedCursorMap: Record<string, MessageCursor>,
  isRecovery: boolean,
): MessageCursor {
  if (isRecovery) {
    const committed = lastCommittedCursorMap[chatJid];
    return committed || EMPTY_CURSOR;
  }
  return lastAgentTimestampMap[chatJid] || EMPTY_CURSOR;
}

export function normalizeCommittedCursorsOnLoad(
  _accepted: Record<string, MessageCursor>,
  committed: Record<string, MessageCursor>,
): Record<string, MessageCursor> {
  return { ...committed };
}

export function resolveStartupRecoveryCursor(
  chatJid: string,
  cursors: {
    accepted: Record<string, MessageCursor>;
    committed: Record<string, MessageCursor>;
  },
): MessageCursor {
  return cursors.committed[chatJid] || EMPTY_CURSOR;
}

export function dropMessagesAtOrBeforeLatestInterruptedPartial<
  T extends NewMessage,
>(chatJid: string, sinceCursor: MessageCursor, messages: T[]): T[] {
  if (messages.length === 0) return messages;
  const interrupted = getLatestInterruptedPartialMessageSince(
    chatJid,
    sinceCursor,
  );
  if (!interrupted) return messages;
  const interruptedCursor = {
    timestamp: interrupted.timestamp,
    id: interrupted.id,
  };
  return messages.filter((message) =>
    isCursorAfter(
      {
        timestamp: message.timestamp,
        id: message.id,
      },
      interruptedCursor,
    ),
  );
}

export function shouldCommitCursorAfterRoutedImDelivery({
  requiresRoutedImDelivery,
  routedImDeliverySucceeded,
}: {
  requiresRoutedImDelivery: boolean;
  routedImDeliverySucceeded: boolean | null;
}): boolean {
  return !requiresRoutedImDelivery || routedImDeliverySucceeded === true;
}

export function shouldCommitAgentConversationCursorAfterImDelivery({
  replySourceImJid,
  streamingCardHandledIm,
  staticImDeliverySucceeded,
}: {
  replySourceImJid: string | null;
  streamingCardHandledIm: boolean;
  staticImDeliverySucceeded: boolean | null;
}): boolean {
  if (!replySourceImJid || streamingCardHandledIm) return true;
  return staticImDeliverySucceeded === true;
}

export function shouldCommitCursorAfterInterruptedPartialDelivery({
  replyImJid,
  streamingCardHandledIm,
  staticImDeliverySucceeded,
}: {
  replyImJid: string | null;
  streamingCardHandledIm: boolean;
  staticImDeliverySucceeded: boolean | null;
}): boolean {
  if (!replyImJid || streamingCardHandledIm) return true;
  return staticImDeliverySucceeded === true;
}

export function shouldSaveAgentConversationPartialReply({
  currentTurnCommitted,
  hasFinalReply,
  hasAccumulatedText,
}: {
  currentTurnCommitted: boolean;
  hasFinalReply: boolean;
  hasAccumulatedText: boolean;
}): boolean {
  return !currentTurnCommitted && !hasFinalReply && hasAccumulatedText;
}

function resolveInterruptedPartialImJid(
  replyJid: string | null | undefined,
): string | null {
  if (!replyJid || getChannelType(replyJid) === null) return null;
  return replyJid;
}

async function sendInterruptedPartialToImIfNeeded({
  replyImJid,
  streamingCardHandledIm,
  lifecycleMessages,
  lifecycleDetails,
}: {
  replyImJid: string | null;
  streamingCardHandledIm: boolean;
  text: string;
  groupFolder: string;
  lifecycleMessages: NewMessage[];
  lifecycleDetails: Record<string, unknown>;
}): Promise<boolean | null> {
  if (!replyImJid || streamingCardHandledIm) return null;
  recordLifecycleForMessages({
    messages: lifecycleMessages,
    stage: 'im_delivered',
    status: 'ok',
    reason: 'partial_body_suppressed',
    details: {
      ...lifecycleDetails,
      delivery: 'interrupt_partial_suppressed',
    },
  });
  return true;
}

const NON_RECOVERABLE_RESTART_SOURCE_KINDS: ReadonlySet<MessageSourceKind> =
  new Set(['scheduled_task_prompt', 'user_command']);

type RestartPendingMessage = Pick<NewMessage, 'sender' | 'source_kind'> & {
  is_from_me?: boolean | number | null;
};

function hasNonRecoverableRestartSourceKind(
  message: Pick<NewMessage, 'source_kind'>,
): boolean {
  const sourceKind = message.source_kind ?? null;
  return !!(sourceKind && NON_RECOVERABLE_RESTART_SOURCE_KINDS.has(sourceKind));
}

export function isRecoverableRestartPendingMessage(
  message: RestartPendingMessage,
): boolean {
  if (message.is_from_me === true || message.is_from_me === 1) return false;
  if (
    message.sender === 'cli-claw-agent' ||
    message.sender === '__system__' ||
    message.sender === 'system'
  ) {
    return false;
  }
  return !hasNonRecoverableRestartSourceKind(message);
}

export function selectRecoverableRestartPendingMessages<
  T extends RestartPendingMessage,
>(messages: readonly T[]): T[] {
  let latestBoundaryIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isRecoverableRestartPendingMessage(messages[i])) {
      latestBoundaryIndex = i;
      break;
    }
  }
  return messages
    .slice(latestBoundaryIndex + 1)
    .filter(isRecoverableRestartPendingMessage);
}

type InterruptedResumeMessage = NewMessage & {
  is_from_me?: boolean | number | null;
};

function isHumanUserMessage(message: InterruptedResumeMessage): boolean {
  return isRecoverableRestartPendingMessage(message);
}

function isInterruptedPartialMessage(
  message: InterruptedResumeMessage,
): boolean {
  return (
    (message.source_kind === 'interrupt_partial' ||
      message.finalization_reason === 'interrupted') &&
    (message.is_from_me === true ||
      message.is_from_me === 1 ||
      message.sender === 'cli-claw-agent')
  );
}

function findLastHumanUserIndex(messages: InterruptedResumeMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isHumanUserMessage(messages[i])) return i;
  }
  return -1;
}

export function resolveInterruptedResumeDecision({
  chatJid,
  missedMessages,
}: {
  chatJid: string;
  missedMessages: NewMessage[];
}): InterruptedResumeDecision {
  const messages = missedMessages as InterruptedResumeMessage[];
  const latestUserIndex = findLastHumanUserIndex(messages);
  if (latestUserIndex < 0) {
    return { action: 'none', messagesForAgent: [] };
  }

  let interruptIndex = -1;
  for (let i = latestUserIndex - 1; i >= 0; i -= 1) {
    if (isInterruptedPartialMessage(messages[i])) {
      interruptIndex = i;
      break;
    }
  }
  if (interruptIndex < 0) {
    return { action: 'none', messagesForAgent: [] };
  }

  const currentMessages = messages
    .slice(interruptIndex + 1)
    .filter(isHumanUserMessage);

  if (currentMessages.length === 0) {
    return { action: 'none', messagesForAgent: [] };
  }

  return {
    action: 'use_current',
    messagesForAgent: selectLeadingSourceTurnMessages(currentMessages, chatJid),
  };
}

function sendSystemMessage(jid: string, type: string, detail: string): void {
  const msgId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  ensureChatExists(jid);
  storeMessageDirect(
    msgId,
    jid,
    '__system__',
    'system',
    `${type}:${detail}`,
    timestamp,
    true,
  );
  broadcastNewMessage(jid, {
    id: msgId,
    chat_jid: jid,
    sender: '__system__',
    sender_name: 'system',
    content: `${type}:${detail}`,
    timestamp,
    is_from_me: true,
  });
}

function sendBillingDeniedMessage(jid: string, content: string): string {
  const msgId = `sys_quota_${Date.now()}`;
  const timestamp = new Date().toISOString();
  ensureChatExists(jid);
  storeMessageDirect(
    msgId,
    jid,
    '__billing__',
    ASSISTANT_NAME,
    content,
    timestamp,
    true,
  );
  broadcastNewMessage(jid, {
    id: msgId,
    chat_jid: jid,
    sender: '__billing__',
    sender_name: ASSISTANT_NAME,
    content,
    timestamp,
    is_from_me: true,
  });
  return msgId;
}

function getSessionRuntimeArtifactDir(
  folder: string,
  agentId?: string,
): string {
  return agentId
    ? path.join(DATA_DIR, 'sessions', folder, 'agents', agentId, '.openai')
    : path.join(DATA_DIR, 'sessions', folder, '.openai');
}

async function clearSessionRuntimeFiles(
  folder: string,
  agentId?: string,
): Promise<void> {
  const artifactDir = getSessionRuntimeArtifactDir(folder, agentId);
  if (!fs.existsSync(artifactDir)) return;

  try {
    for (const entry of fs.readdirSync(artifactDir)) {
      if (entry === 'settings.json') continue;
      fs.rmSync(path.join(artifactDir, entry), {
        recursive: true,
        force: true,
      });
    }
  } catch {
    logger.info({ folder, agentId }, 'Direct session cleanup failed');
  }
}

/**
 * Slash command handler for IM channels (Feishu/Telegram).
 * Returns a reply string on success, or null if command not recognized.
 */
async function handleCommand(
  chatJid: string,
  command: string,
): Promise<string | null> {
  const normalizedCommand = command.trim().startsWith('/')
    ? command.trim()
    : `/${command.trim()}`;
  const slashCandidate = parseSlashCommandCandidate(command, {
    allowBare: true,
  });
  if (!slashCandidate) return null;

  const target = resolveRuntimeWorkspaceTarget(chatJid, {
    getGroup: (jid) => registeredGroups[jid] ?? getRegisteredGroup(jid),
    getSiblingJids: getJidsByFolder,
    getAgent,
  });
  const parsed = parseRuntimeCommand(normalizedCommand);
  if (!parsed) {
    const skillReply = await maybeHandleImSkillCommand({
      chatJid,
      slashCandidate,
      target,
    });
    if (skillReply) {
      return skillReply;
    }
    return formatUnknownRuntimeCommandReply(slashCandidate.rawName);
  }

  const cmd = parsed.name;
  const rawArgs = parsed.argsText;

  logger.info(
    {
      chatJid,
      command: normalizedCommand,
      cmd,
      hasArgs: rawArgs.length > 0,
    },
    'IM command invoked',
  );

  if (cmd === 'help' || cmd === 'openai') {
    if (cmd === 'openai' && !rawArgs && chatJid.startsWith('feishu:')) {
      const target = resolveRuntimeWorkspaceTarget(chatJid, {
        getGroup: (jid) => registeredGroups[jid] ?? getRegisteredGroup(jid),
        getSiblingJids: getJidsByFolder,
        getAgent,
      });
      if (!target) {
        return '未找到当前工作区';
      }
      if (cmd !== target.effectiveRuntimeIdentity.agentType) {
        return `当前工作区是 ${target.effectiveRuntimeIdentity.agentType}，请使用 /${target.effectiveRuntimeIdentity.agentType} 配置该 Agent`;
      }
      return JSON.stringify({
        type: 'interactive',
        card: buildRuntimeSelectionCard({
          agentType: cmd,
          runtimeIdentity: target.effectiveRuntimeIdentity,
          modelChoices: getAvailableRuntimeModelOptions(
            target.effectiveRuntimeIdentity.agentType,
            { currentModel: target.effectiveRuntimeIdentity.model },
          ),
        }),
      });
    }

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'im',
      chatJid,
      commandText: normalizedCommand,
      deps: {
        getGroup: (jid) => registeredGroups[jid] ?? getRegisteredGroup(jid),
        setGroup: (jid, group) => {
          setRegisteredGroup(jid, group);
          registeredGroups[jid] = group;
        },
        getSiblingJids: getJidsByFolder,
        getAgent,
        queue,
        getSessions: () => sessions,
      },
    });

    if (cmd !== 'help' || !result.reply || !target) {
      return result.reply;
    }

    const discovered = await discoverSkillCommandsForTarget('im', target);
    return appendSkillCommandHelp(result.reply, discovered);
  }

  switch (cmd) {
    case 'clear':
      return handleClearCommand(chatJid);
    case 'list':
    case 'ls':
      return handleListCommand(chatJid);
    case 'status':
      return handleStatusCommand(chatJid);
    case 'self-status':
      return handleSelfStatusCommand(chatJid);
    case 'self-check':
      return handleSelfCheckCommand(chatJid);
    case 'self-restart':
      return handleSelfRestartCommand(chatJid);
    case 'unbind':
      return handleUnbindCommand(chatJid);
    case 'bind':
      return handleBindCommand(chatJid, rawArgs);
    case 'new':
      return handleNewCommand(chatJid, rawArgs);
    case 'require_mention':
      return handleRequireMentionCommand(chatJid, rawArgs);
    case 'sw':
    case 'spawn':
      return handleSpawnCommand(chatJid, rawArgs, chatJid);
    case 'workflow':
      return handleWorkflowSlashCommand(
        chatJid,
        rawArgs,
        undefined,
        undefined,
        { background: true },
      );
    default:
      return null;
  }
}

interface WorkflowCommandLifecycle {
  background?: boolean;
  onBackgroundResult?: (message: string) => Promise<void> | void;
}

function resolveWorkflowCommandLifecycle(
  chatJid: string,
  lifecycle?: WorkflowCommandLifecycle,
): WorkflowCommandLifecycle | undefined {
  if (!lifecycle?.background || lifecycle.onBackgroundResult) {
    return lifecycle;
  }
  if (getChannelType(chatJid) === null) return lifecycle;
  return {
    ...lifecycle,
    onBackgroundResult: async (message: string) => {
      await sendMessage(chatJid, message);
    },
  };
}

async function handleWorkflowSlashCommand(
  chatJid: string,
  rawArgs: string,
  triggerUserId?: string | null,
  initialInput?: Record<string, unknown>,
  lifecycle?: WorkflowCommandLifecycle,
): Promise<string> {
  const target = resolveRuntimeWorkspaceTarget(chatJid, {
    getGroup: (jid) => registeredGroups[jid] ?? getRegisteredGroup(jid),
    getSiblingJids: getJidsByFolder,
    getAgent,
  });
  if (!target) return '未找到当前工作区';
  const resolvedLifecycle = resolveWorkflowCommandLifecycle(chatJid, lifecycle);
  return executeWorkflowCommand({
    group: target.effectiveGroup,
    chatJid,
    argsText: rawArgs,
    triggerUserId: triggerUserId ?? target.sourceGroup.created_by ?? null,
    initialInput,
    background: resolvedLifecycle?.background,
    onBackgroundResult: resolvedLifecycle?.onBackgroundResult,
  });
}

function resolveSkillCommandUserId(
  target: ResolvedRuntimeWorkspaceTarget,
): string | null {
  return (
    target.workspaceGroup.created_by ??
    target.sourceGroup.created_by ??
    target.runtimeOwnerGroup.created_by ??
    null
  );
}

async function discoverSkillCommandsForTarget(
  entrypoint: 'im' | 'web',
  target: ResolvedRuntimeWorkspaceTarget,
): Promise<SkillCommandDiscoveryResult> {
  return discoverSkillCommands({
    entrypoint,
    roots: resolveSkillCommandRoots({
      workspaceGroup: target.workspaceGroup,
      homeGroup: target.runtimeOwnerGroup.is_home
        ? target.runtimeOwnerGroup
        : null,
      userId: resolveSkillCommandUserId(target),
    }),
  });
}

function appendSkillCommandHelp(
  baseReply: string,
  discovered: SkillCommandDiscoveryResult,
): string {
  const skillLines = formatSkillCommandHelpLines(discovered.commands);
  const sections: string[] = [baseReply];

  if (skillLines.length > 0) {
    sections.push(['技能命令：', ...skillLines].join('\n'));
  }

  if (discovered.errors.length > 0) {
    sections.push(
      ['技能命令冲突：', ...discovered.errors.map((line) => `- ${line}`)].join(
        '\n',
      ),
    );
  }

  return sections.join('\n\n');
}

async function maybeHandleImSkillCommand(options: {
  chatJid: string;
  slashCandidate: NonNullable<ReturnType<typeof parseSlashCommandCandidate>>;
  target: ResolvedRuntimeWorkspaceTarget | null;
}): Promise<string | null> {
  if (!options.target) return null;

  const discovered = await discoverSkillCommandsForTarget('im', options.target);
  const normalizedName = options.slashCandidate.rawName.trim().toLowerCase();
  const conflictMessage =
    discovered.errors.find((message) =>
      message.includes(`/${normalizedName}`),
    ) ?? null;
  if (conflictMessage) {
    return conflictMessage;
  }

  const matched = discovered.commands.find(
    (command) => command.name === normalizedName,
  );
  if (!matched) return null;

  const result = await executeDiscoveredSkillCommandResult({
    commandName: normalizedName,
    discovered,
    entrypoint: 'im',
    chatJid: options.chatJid,
    argsText: options.slashCandidate.argsText,
    args: options.slashCandidate.args,
    workspace: {
      jid: options.target.workspaceJid,
      folder: options.target.workspaceGroup.folder,
      name: options.target.workspaceGroup.name,
    },
  });

  if (result.kind === 'assistant_prompt') {
    return encodeImSlashRewriteMessage(result.prompt);
  }

  if (result.kind === 'workflow') {
    const workflowArgs = [result.workflowId, result.prompt]
      .filter((part) => part.trim().length > 0)
      .join(' ');
    return handleWorkflowSlashCommand(
      options.chatJid,
      workflowArgs,
      options.target.sourceGroup.created_by ??
        options.target.runtimeOwnerGroup.created_by ??
        null,
      {
        command: normalizedName,
        argsText: options.slashCandidate.argsText,
        input: result.input,
      },
      { background: true },
    );
  }

  return result.content;
}

async function handleClearCommand(chatJid: string): Promise<string> {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group) return '未找到当前工作区';

  const target = resolveBoundChatTarget(
    chatJid,
    group,
    (jid) => registeredGroups[jid] ?? getRegisteredGroup(jid),
    getAgent,
    findGroupNameByFolder,
  );

  try {
    await executeSessionReset(
      target.baseChatJid,
      target.folder,
      {
        queue,
        sessions,
        broadcast: broadcastNewMessage,
        setLastAgentTimestamp: setCursors,
      },
      target.agentId ?? undefined,
    );
    return '已清除对话上下文 ✓';
  } catch (err) {
    logger.error(
      {
        chatJid,
        targetChatJid: target.targetChatJid,
        targetFolder: target.folder,
        agentId: target.agentId,
        err,
      },
      'handleCommand /clear failed',
    );
    return '清除上下文失败，请稍后重试';
  }
}

/**
 * Collect all accessible workspaces for a user as pure WorkspaceInfo[].
 */
function collectWorkspaces(userId: string): WorkspaceInfo[] {
  const ownedGroups = getGroupsByOwner(userId);
  const user = getUserById(userId);
  const isAdmin = user?.role === 'admin';

  const seen = new Set<string>();
  const workspaces: WorkspaceInfo[] = [];

  for (const g of ownedGroups) {
    if (!g.jid.startsWith('web:')) continue;
    if (seen.has(g.folder)) continue;
    seen.add(g.folder);

    const agents = listAgentsByJid(g.jid)
      .filter((a) => a.kind === 'conversation')
      .map((a) => ({ id: a.id, name: a.name, status: a.status }));

    workspaces.push({ folder: g.folder, name: g.name, agents });
  }

  if (isAdmin && !seen.has(MAIN_GROUP_FOLDER)) {
    const agents = listAgentsByJid(DEFAULT_MAIN_JID)
      .filter((a) => a.kind === 'conversation')
      .map((a) => ({ id: a.id, name: a.name, status: a.status }));
    workspaces.push({
      folder: MAIN_GROUP_FOLDER,
      name: DEFAULT_MAIN_NAME,
      agents,
    });
  }

  return workspaces;
}

function resolveBindingTarget(
  userId: string,
  rawSpec: string,
): {
  target_agent_id?: string;
  target_main_jid?: string;
  display: string;
} | null {
  const spec = rawSpec.trim();
  if (!spec) return null;

  const [workspaceSpecRaw, agentSpecRaw] = spec.split('/', 2);
  const workspaceSpec = workspaceSpecRaw.trim().toLowerCase();
  const agentSpec = agentSpecRaw?.trim().toLowerCase();
  const workspaces = collectWorkspaces(userId);
  const workspace = workspaces.find(
    (ws) =>
      ws.folder.toLowerCase() === workspaceSpec ||
      ws.name.trim().toLowerCase() === workspaceSpec,
  );
  if (!workspace) return null;

  if (!agentSpec || agentSpec === 'main' || agentSpec === '主对话') {
    const mainJid = findWebJidForFolder(workspace.folder);
    if (!mainJid) return null;
    return {
      target_main_jid: mainJid,
      display: `${workspace.name} / 主对话`,
    };
  }

  const agent = workspace.agents.find(
    (item) =>
      item.id.toLowerCase().startsWith(agentSpec) ||
      item.name.trim().toLowerCase() === agentSpec,
  );
  if (!agent) return null;

  return {
    target_agent_id: agent.id,
    display: `${workspace.name} / ${agent.name}`,
  };
}

/**
 * Find the primary web JID for a folder (the one used for web:xxx groups).
 */
function findWebJidForFolder(folder: string): string | null {
  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (group.folder === folder && jid.startsWith('web:')) return jid;
  }
  const jids = getJidsByFolder(folder);
  for (const jid of jids) {
    if (jid.startsWith('web:')) return jid;
  }
  return null;
}

/**
 * Find the display name for a folder by looking up its web group.
 */
function findGroupNameByFolder(folder: string): string {
  const webJid = findWebJidForFolder(folder);
  if (webJid) {
    const group = registeredGroups[webJid] ?? getRegisteredGroup(webJid);
    if (group) return group.name;
  }
  return folder;
}

function resolveStatusWorkspaceInfo(
  group: RegisteredGroup,
  location: { folder: string },
): WorkspaceInfo {
  let workspaceJid: string | null = null;

  if (group.target_agent_id) {
    workspaceJid = getAgent(group.target_agent_id)?.chat_jid ?? null;
  } else if (group.target_main_jid) {
    workspaceJid = group.target_main_jid;
  } else {
    workspaceJid = findWebJidForFolder(location.folder);
  }

  const workspaceGroup = workspaceJid
    ? (registeredGroups[workspaceJid] ?? getRegisteredGroup(workspaceJid))
    : undefined;
  const agents = workspaceJid
    ? listAgentsByJid(workspaceJid)
        .filter((a) => a.kind === 'conversation')
        .map((a) => ({ id: a.id, name: a.name, status: a.status }))
    : [];

  return {
    folder: workspaceGroup?.folder ?? location.folder,
    name: workspaceGroup?.name ?? findGroupNameByFolder(location.folder),
    agents,
  };
}

function handleListCommand(chatJid: string): string {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group) return '当前 IM 未绑定工作区';

  const userId = group.created_by;
  if (!userId) return '无法确定用户身份';

  const workspaces = collectWorkspaces(userId);
  if (workspaces.length === 0) return '没有可用的工作区';

  const lookupGroup = (jid: string) =>
    registeredGroups[jid] ?? getRegisteredGroup(jid);
  const location = resolveLocationInfo(
    group,
    lookupGroup,
    getAgent,
    findGroupNameByFolder,
  );

  const currentAgentId = group.target_agent_id ?? null;
  const currentOnMain = !currentAgentId;

  return (
    formatWorkspaceList(
      workspaces,
      location.folder,
      currentAgentId,
      currentOnMain,
    ) + '\n💡 使用 /bind <workspace> 或 /bind <workspace>/<agent短ID>'
  );
}

function formatStatusUsageRemaining(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'unavailable';
  }
  return `${value}%`;
}

function formatStatusUsageReset(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return 'unknown';
}

async function handleStatusCommand(chatJid: string): Promise<string> {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group) return '当前 IM 未绑定工作区';

  const lookupGroup = (jid: string) =>
    registeredGroups[jid] ?? getRegisteredGroup(jid);
  const location = resolveLocationInfo(
    group,
    lookupGroup,
    getAgent,
    findGroupNameByFolder,
  );

  const queueStatus = queue.getStatus();
  const settings = getSystemSettings();

  // Check if the current group's folder is active or queued
  const groupState = queueStatus.groups.find((g) => {
    const rg = lookupGroup(g.jid);
    return rg?.folder === location.folder;
  });
  const isActive = !!groupState?.active;
  const queuePosition =
    !isActive && queueStatus.waitingGroupJids.includes(chatJid)
      ? queueStatus.waitingGroupJids.indexOf(chatJid) + 1
      : null;

  const workspace = resolveStatusWorkspaceInfo(group, location);
  const currentAgentId = group.target_agent_id ?? null;
  const currentSessionName = currentAgentId
    ? (workspace.agents.find((agent) => agent.id === currentAgentId)?.name ??
      'conversation agent')
    : '主对话';

  const runtimeTarget = resolveRuntimeWorkspaceTarget(chatJid, {
    getGroup: lookupGroup,
    getSiblingJids: getJidsByFolder,
    getAgent,
  });

  const runtimeIdentity = runtimeTarget?.effectiveRuntimeIdentity ?? null;
  let runtimeUsage: Awaited<ReturnType<typeof getRuntimeUsageSnapshot>> = null;
  try {
    runtimeUsage = await getRuntimeUsageSnapshot(runtimeIdentity);
  } catch (err) {
    logger.warn(
      { chatJid, err },
      'Failed to fetch runtime usage snapshot for status command',
    );
  }

  logger.info(
    {
      chatJid,
      folder: location.folder,
      targetAgentId: group.target_agent_id ?? null,
      active: isActive,
      queuePosition,
      runtimeAgentType: runtimeIdentity?.agentType ?? null,
      runtimeModel: runtimeIdentity?.model ?? null,
      runtimeReasoningEffort: runtimeIdentity?.reasoningEffort ?? null,
      runtimeSpeedTier: runtimeIdentity?.speedTier ?? null,
      runtimeUsageAvailable: runtimeUsage?.available ?? false,
    },
    'Status command rendered',
  );
  const systemStatus = formatSystemStatus(
    {
      activeProcessCount: queueStatus.activeProcessCount,
      maxProcesses: settings.maxConcurrentProcesses,
      waitingCount: queueStatus.waitingCount,
      waitingGroupJids: queueStatus.waitingGroupJids,
    },
    isActive,
    queuePosition,
    {
      agentType: runtimeIdentity?.agentType ?? 'openai',
      model: runtimeIdentity?.model ?? 'unknown',
      reasoningEffort: runtimeIdentity?.reasoningEffort ?? null,
      speedTier: runtimeIdentity?.speedTier ?? null,
      primaryRemaining: formatStatusUsageRemaining(
        runtimeUsage?.primaryRemainingPct,
      ),
      primaryReset: formatStatusUsageReset(runtimeUsage?.primaryResetAt),
      secondaryRemaining: formatStatusUsageRemaining(
        runtimeUsage?.secondaryRemainingPct,
      ),
      secondaryReset: formatStatusUsageReset(runtimeUsage?.secondaryResetAt),
      currentBinding: location.locationLine,
      replyPolicy: location.replyPolicy ?? null,
      workspaceName: workspace.name,
      currentSessionName,
      sessionCount: workspace.agents.length + 1,
      cwd: process.cwd(),
    },
  );
  const loopStatus = formatLoopStatusSection({
    taskReader: { getTaskById, getTaskRunLogs },
    runtimeUsage,
  });

  const lifecycleStatus = chatJid.startsWith('feishu:')
    ? `\n${formatImLifecycleStatus(
        getRecentImMessageLifecycleEvents({
          provider: 'feishu',
          chatJid,
          limit: 3,
        }),
        getRecentImMessageLifecycleIssueEvents({
          provider: 'feishu',
          chatJid,
          limit: 3,
        }),
      )}`
    : '';

  const recentWorkflowRuns = listWorkflowRuns({
    folder: location.folder,
    limit: 3,
  });
  const workflowStatus =
    recentWorkflowRuns.length > 0
      ? `\n\n工作流运行：\n${recentWorkflowRuns
          .map(
            (run) =>
              `- ${run.workflow_id} ${run.status} (${run.created_at})` +
              (run.error ? `：${run.error}` : ''),
          )
          .join('\n')}`
      : '';

  return `${systemStatus}${loopStatus}${lifecycleStatus}${workflowStatus}`;
}

function isSelfIterationAdmin(chatJid: string): boolean {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group?.created_by) return false;
  return getUserById(group.created_by)?.role === 'admin';
}

function resolveManagedFeishuCommandText(
  chatJid: string,
  text: string,
): string | null {
  if (!isSelfIterationAdmin(chatJid)) return null;
  return resolveManagedSelfRestartCommand(text);
}

function handleSelfStatusCommand(chatJid: string): string {
  if (!isSelfIterationAdmin(chatJid)) {
    return '需要管理员权限才能查看服务自迭代状态';
  }
  return buildCurrentSelfStatusText();
}

async function handleSelfCheckCommand(chatJid: string): Promise<string> {
  if (!isSelfIterationAdmin(chatJid)) {
    return '需要管理员权限才能执行服务自检';
  }
  if (selfCheckRunning) {
    return '已有 /self-check 正在运行，请稍后再试';
  }

  selfCheckRunning = true;
  try {
    lastSelfCheckResult = await runSelfCheck({
      launchSpec: startupLaunchSpec,
    });
    return formatSelfCheckResult(lastSelfCheckResult);
  } finally {
    selfCheckRunning = false;
  }
}

function buildCurrentSelfStatusText(): string {
  const buildStatus = getRuntimeBuildStatus();
  return formatSelfStatus({
    pid: buildStatus.pid,
    startedAt: buildStatus.startedAt,
    cwd: process.cwd(),
    restart: {
      restartable: startupLaunchSpec.restartable,
      source: startupLaunchSpec.source,
      artifactMode: startupLaunchSpec.artifactMode,
      displayCommand: startupLaunchSpec.displayCommand,
      validationError: startupLaunchSpec.validationError,
    },
    stale: buildStatus.stale,
    backend: {
      stale: buildStatus.backend.stale,
      loadedMtimeIso: buildStatus.backend.loaded.mtimeIso,
      currentMtimeIso: buildStatus.backend.current.mtimeIso,
    },
    agentRunner: {
      stale: buildStatus.agentRunner.stale,
      loadedMtimeIso: buildStatus.agentRunner.loaded.mtimeIso,
      currentMtimeIso: buildStatus.agentRunner.current.mtimeIso,
    },
    lastCheck: lastSelfCheckResult,
    feishuIssueEvents: getRecentImMessageLifecycleIssueEvents({
      provider: 'feishu',
      limit: 3,
    }),
  });
}

async function buildSelfRestartResidualSummary(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'pid,ppid,pgid,command', '-ax'],
      {
        timeout: 5000,
      },
    );
    const { summary, cleanupResult } = inspectAndCleanupResidualProcesses(
      typeof stdout === 'string' ? stdout : String(stdout),
      process.pid,
    );
    const parts = [
      `🧹 残留检查: backend ${summary.backendProcessCount} 个（额外 ${summary.extraBackendPids.length}），runner ${summary.runnerProcessCount} 个（孤儿 ${summary.orphanRunnerPids.length}）`,
    ];
    if (summary.extraBackendPids.length > 0) {
      parts.push(`额外 backend PID: ${summary.extraBackendPids.join(', ')}`);
    }
    if (summary.orphanRunnerPids.length > 0) {
      parts.push(`孤儿 runner PID: ${summary.orphanRunnerPids.join(', ')}`);
      if (summary.orphanRunnerGroupIds.length > 0) {
        parts.push(
          `孤儿 runner PGID: ${summary.orphanRunnerGroupIds.join(', ')}`,
        );
      }
      if (cleanupResult.attemptedRunnerGroupIds.length > 0) {
        parts.push(
          `已尝试清理孤儿 runner PGID: ${cleanupResult.attemptedRunnerGroupIds.join(', ')}`,
        );
      }
      if (cleanupResult.failedRunnerGroupIds.length > 0) {
        parts.push(
          `孤儿 runner PGID 清理失败: ${cleanupResult.failedRunnerGroupIds.join(', ')}`,
        );
      }
      if (cleanupResult.attemptedRunnerPids.length > 0) {
        parts.push(
          `已尝试清理孤儿 runner PID: ${cleanupResult.attemptedRunnerPids.join(', ')}`,
        );
      }
      if (cleanupResult.failedRunnerPids.length > 0) {
        parts.push(
          `孤儿 runner 清理失败 PID: ${cleanupResult.failedRunnerPids.join(', ')}`,
        );
      }
    }
    return parts.join('\n');
  } catch (err) {
    logger.warn(
      { err },
      'Failed to inspect residual processes after self-restart',
    );
    return '🧹 残留检查: unavailable';
  }
}

async function cleanupStartupResidualRunners(): Promise<void> {
  if (SELF_CHECK_MODE) return;
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'pid,ppid,pgid,command', '-ax'],
      {
        timeout: 5000,
      },
    );
    const { summary, cleanupResult } = inspectAndCleanupResidualProcesses(
      typeof stdout === 'string' ? stdout : String(stdout),
      process.pid,
    );
    if (
      summary.orphanRunnerPids.length === 0 &&
      cleanupResult.attemptedRunnerGroupIds.length === 0 &&
      cleanupResult.attemptedRunnerPids.length === 0
    ) {
      return;
    }
    logger.warn(
      { summary, cleanupResult },
      'Cleaned startup residual runner processes',
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to clean startup residual runner processes');
  }
}

async function notifyCompletedSelfRestartIntents(): Promise<void> {
  const currentRestartState = readCurrentBackendRestartState();
  const pending = findPendingSelfRestartNotifications({
    pid: process.pid,
    startedAt: currentRestartState?.startedAt || null,
    launchdServiceName: currentRestartState?.launchdServiceName || null,
  });
  if (pending.length === 0) return;

  const selfStatus = buildCurrentSelfStatusText();
  const residualSummary = await buildSelfRestartResidualSummary();

  for (const item of pending) {
    try {
      await imManager.sendMessage(
        item.intent.requestChatJid!,
        formatSelfRestartSuccess({
          intentPath: item.intentPath,
          selfStatus,
          residualSummary,
        }),
      );
      markSelfRestartNotificationSent(item.intentPath);
      logger.info(
        {
          intentId: item.intent.id,
          chatJid: item.intent.requestChatJid,
        },
        'Sent self-restart success notification',
      );
    } catch (err) {
      logger.warn(
        {
          err,
          intentId: item.intent.id,
          chatJid: item.intent.requestChatJid,
        },
        'Failed to send self-restart success notification',
      );
    }
  }
}

function handleSelfRestartCommand(chatJid: string): string {
  if (!isSelfIterationAdmin(chatJid)) {
    return '需要管理员权限才能执行服务自重启';
  }

  if (!startupLaunchSpec.restartable) {
    return `自重启受理失败: unsafe restart launch spec: ${startupLaunchSpec.validationError || 'unknown error'}`;
  }

  const result = requestSelfRestart({
    appRoot: resolveAppPath(),
    pid: process.pid,
    port: WEB_PORT,
    launchSpec: startupLaunchSpec,
    launchdServiceName: resolveLaunchdServiceNameFromEnv(),
    requestChatJid: chatJid,
  });

  if (result.status === 'failed') {
    return `自重启受理失败: ${result.error}`;
  }

  logger.info(
    {
      chatJid,
      intentPath: result.intentPath,
      launchSource: startupLaunchSpec.source,
      launchCommand: startupLaunchSpec.displayCommand,
    },
    'Accepted self-restart request',
  );

  return formatSelfRestartAccepted(result);
}

function handleUnbindCommand(chatJid: string): string {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group) return '当前 IM 未绑定工作区';
  if (!group.target_agent_id && !group.target_main_jid)
    return '当前聊天没有额外绑定，已在默认工作区。';
  unbindImGroup(chatJid, 'IM slash command unbind');
  return '已解绑，后续消息将回到该聊天自己的默认工作区。';
}

function handleBindCommand(chatJid: string, rawSpec: string): string {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group) return '当前 IM 未绑定工作区';
  const userId = group.created_by;
  if (!userId) return '无法确定当前聊天所属用户';
  if (!rawSpec)
    return '用法: /bind <workspace> 或 /bind <workspace>/<agent短ID>';

  const resolved = resolveBindingTarget(userId, rawSpec);
  if (!resolved) {
    return '未找到目标。先用 /list 查看工作区和 agent 短 ID，再执行 /bind <workspace>/<agent短ID>';
  }

  const updated: RegisteredGroup = {
    ...group,
    target_agent_id: resolved.target_agent_id,
    target_main_jid: resolved.target_main_jid,
    reply_policy: 'source_only',
  };
  setRegisteredGroup(chatJid, updated);
  registeredGroups[chatJid] = updated;
  imSendFailCounts.delete(chatJid);
  imHealthCheckFailCounts.delete(chatJid);
  return `已切换到 ${resolved.display}\n🔁 回复策略: source_only`;
}

async function handleNewCommand(
  chatJid: string,
  rawName: string,
): Promise<string> {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group) return '当前 IM 未绑定工作区';
  const userId = group.created_by;
  if (!userId) return '无法确定当前聊天所属用户';

  const name = rawName.trim();
  if (!name) return '用法: /new <工作区名称>';
  if (name.length > 50) return '名称过长（最多 50 字符）';

  const created = createImNewWorkspaceGroup({
    name,
    userId,
  });
  if ('error' in created) {
    logger.error(
      { chatJid, userId, err: created.error },
      'IM /new workspace creation failed',
    );
    return `创建工作区失败：${created.error}`;
  }

  const { jid: newJid, folder, group: newGroup } = created;

  // Register the workspace
  registerGroup(newJid, newGroup);
  ensureChatExists(newJid);
  updateChatName(newJid, name);
  addGroupMember(folder, userId, 'owner', userId);

  // Bind the current IM group to the new workspace's main conversation
  const updated: RegisteredGroup = {
    ...group,
    target_main_jid: newJid,
    target_agent_id: undefined,
    reply_policy: 'source_only',
  };
  setRegisteredGroup(chatJid, updated);
  registeredGroups[chatJid] = updated;
  imSendFailCounts.delete(chatJid);
  imHealthCheckFailCounts.delete(chatJid);

  return `工作区「${name}」已创建并绑定\n📁 ${folder}\n🔁 回复策略: source_only\n\n发送 /unbind 可解绑回默认工作区`;
}

function handleRequireMentionCommand(chatJid: string, rawArgs: string): string {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group) return '未找到当前会话';

  const action = rawArgs.trim().toLowerCase();
  if (action === 'true') {
    const updated: RegisteredGroup = { ...group, require_mention: true };
    setRegisteredGroup(chatJid, updated);
    registeredGroups[chatJid] = updated;
    return '已开启：群聊中需要 @机器人 才会响应';
  } else if (action === 'false') {
    const updated: RegisteredGroup = { ...group, require_mention: false };
    setRegisteredGroup(chatJid, updated);
    registeredGroups[chatJid] = updated;
    return '已关闭：群聊中所有消息都会响应，无需 @机器人';
  } else if (!action) {
    const current = group.require_mention === true;
    return `当前 require_mention: ${current}\n\n用法:\n/require_mention true — 需要 @机器人\n/require_mention false — 全量响应`;
  }
  return '用法: /require_mention true|false';
}

// ─── /sw & /spawn: parallel task spawning ────────────────────────

interface SpawnWorkspace {
  homeChatJid: string;
  homeGroup: RegisteredGroup;
  effectiveGroup: RegisteredGroup;
}

/**
 * Resolve the workspace for a /spawn command.
 * Returns a SpawnWorkspace on success, or an error message string on failure.
 */
function resolveSpawnWorkspace(
  baseJid: string,
  group: RegisteredGroup,
  userId: string,
): SpawnWorkspace | string {
  let homeChatJid: string;
  let homeGroup: RegisteredGroup;

  if (group.target_main_jid || group.target_agent_id) {
    const target = resolveBoundChatTarget(
      baseJid,
      group,
      (jid) => registeredGroups[jid] ?? getRegisteredGroup(jid),
      getAgent,
      findGroupNameByFolder,
    );
    const targetGroup =
      registeredGroups[target.baseChatJid] ??
      getRegisteredGroup(target.baseChatJid);
    if (!targetGroup) {
      return group.target_agent_id
        ? '绑定 Agent 所属的工作区不存在'
        : '绑定的工作区不存在';
    }
    homeChatJid = target.baseChatJid;
    homeGroup = targetGroup;
  } else if (baseJid.startsWith('web:')) {
    homeChatJid = baseJid;
    homeGroup = group;
  } else {
    // IM group not bound — use the user's home workspace
    const userHome = getUserHomeGroup(userId);
    if (!userHome) return '未找到用户主工作区';
    homeChatJid = `web:${userHome.folder}`;
    // Lookup the RegisteredGroup object — prefer the web: JID, fall back to any JID for this folder
    const homeJids = getJidsByFolder(userHome.folder);
    const webJid = homeJids.find((j) => j.startsWith('web:')) ?? homeJids[0];
    const resolvedHome = webJid
      ? (registeredGroups[webJid] ?? getRegisteredGroup(webJid))
      : undefined;
    if (!resolvedHome) return '未找到用户主工作区';
    homeGroup = resolvedHome;
  }

  const { effectiveGroup } = resolveEffectiveGroup(homeGroup);
  return { homeChatJid, homeGroup, effectiveGroup };
}

async function handleSpawnCommand(
  chatJid: string,
  rawMessage: string,
  sourceImJid?: string,
): Promise<string> {
  const message = rawMessage.trim();
  if (!message) return '用法: /sw <任务描述>\n在当前工作区创建并行任务';

  const baseJid = stripVirtualJidSuffix(chatJid);
  const group = registeredGroups[baseJid] ?? getRegisteredGroup(baseJid);
  if (!group) return '未找到当前工作区';
  const userId = group.created_by;
  if (!userId) return '无法确定当前聊天所属用户';

  const resolved = resolveSpawnWorkspace(baseJid, group, userId);
  if (typeof resolved === 'string') return resolved;
  const { homeChatJid, effectiveGroup } = resolved;

  // 3. Determine the spawned_from_jid (where to inject results back)
  //    For IM: resolve to the effective web JID so results enter the web message stream
  //    For Web: use the chatJid directly (may include #agent: for agent-scoped spawn)
  const spawnedFromJid = sourceImJid ? homeChatJid : chatJid;

  const now = new Date().toISOString();
  const agentId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const user = getUserById(userId);
  const senderName = user?.display_name || user?.username || userId;
  const truncatedName =
    message.length > 30 ? message.slice(0, 30) + '…' : message;
  const agentName = `⚡ ${truncatedName}`;

  // Create agent record
  const newAgent: SubAgent = {
    id: agentId,
    group_folder: effectiveGroup.folder,
    chat_jid: homeChatJid,
    name: agentName,
    prompt: '',
    status: 'idle',
    kind: 'spawn',
    created_by: userId,
    created_at: now,
    completed_at: null,
    result_summary: null,
    last_im_jid: sourceImJid ?? null,
    spawned_from_jid: spawnedFromJid,
  };
  createAgent(newAgent);

  // Create IPC + session directories
  ensureAgentDirectories(effectiveGroup.folder, agentId);

  // Create virtual chat + store user's message in it
  const virtualChatJid = `${homeChatJid}#agent:${agentId}`;
  ensureChatExists(virtualChatJid);
  updateChatName(virtualChatJid, agentName);
  storeMessageDirect(
    messageId,
    virtualChatJid,
    userId,
    senderName,
    message,
    now,
    false,
    sourceImJid ? { sourceJid: sourceImJid } : undefined,
  );
  broadcastNewMessage(virtualChatJid, {
    id: messageId,
    chat_jid: virtualChatJid,
    sender: userId,
    sender_name: senderName,
    content: message,
    timestamp: now,
    is_from_me: false,
  });

  broadcastAgentStatus(
    homeChatJid,
    agentId,
    'idle',
    agentName,
    '',
    undefined,
    'spawn',
  );

  // For IM-originated /sw, mirror the command into homeChatJid so Web chat
  // shows what was requested. Web path handles this in web.ts instead.
  if (sourceImJid) {
    ensureChatExists(homeChatJid);
    // source_kind='user_command' prevents the polling loop from picking it up.
    const cmdId = crypto.randomUUID();
    storeMessageDirect(
      cmdId,
      homeChatJid,
      userId,
      senderName,
      `/sw ${message}`,
      now,
      false,
      {
        meta: { sourceKind: 'user_command' },
      },
    );
    broadcastNewMessage(homeChatJid, {
      id: cmdId,
      chat_jid: homeChatJid,
      sender: userId,
      sender_name: senderName,
      content: `/sw ${message}`,
      timestamp: now,
      is_from_me: false,
    });
  }

  // Enqueue task to start the agent
  const taskId = `spawn:${agentId}:${Date.now()}`;
  queue.enqueueTask(virtualChatJid, taskId, async () => {
    await processAgentConversation(homeChatJid, agentId);
  });

  logger.info(
    {
      chatJid,
      homeChatJid,
      agentId,
      userId,
      sourceImJid,
      folder: effectiveGroup.folder,
    },
    '/spawn command: agent created and enqueued',
  );

  const shortId = agentId.slice(0, 4);
  return `⚡ 并行任务已启动 [${shortId}]: ${truncatedName}`;
}

async function setTyping(jid: string, isTyping: boolean): Promise<void> {
  // Skip Feishu Reaction when a streaming card is active — the card itself
  // serves as a live typing indicator.
  if (isTyping && hasActiveStreamingSession(jid)) {
    broadcastTyping(jid, isTyping);
    return;
  }
  await imManager.setTyping(jid, isTyping);
  broadcastTyping(jid, isTyping);
}

interface SendMessageOptions {
  /** Whether to forward the reply to the IM channel (Feishu/Telegram). Defaults to true for IM JIDs. */
  sendToIM?: boolean;
  /** Pre-computed local image paths to attach to IM messages. Avoids redundant filesystem scans. */
  localImagePaths?: string[];
  /** Message source identifier (e.g. 'scheduled_task') for frontend routing. */
  source?: string;
  /** Metadata used to preserve runtime turn semantics for persisted messages. */
  messageMeta?: OutboundMessageMeta;
}

function loadState(): void {
  // Load from SQLite
  const persistedTimestamp = getRouterState('last_timestamp') || '';
  const lastTimestampId = getRouterState('last_timestamp_id') || '';
  globalMessageCursor = {
    timestamp: persistedTimestamp,
    id: lastTimestampId,
  };
  const loadCursorMap = (key: string): Record<string, MessageCursor> => {
    const raw = getRouterState(key);
    try {
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const normalized: Record<string, MessageCursor> = {};
      for (const [jid, v] of Object.entries(parsed)) {
        normalized[jid] = normalizeCursor(v);
      }
      return normalized;
    } catch {
      logger.warn(`Corrupted ${key} in DB, resetting`);
      return {};
    }
  };
  const loadStreamingTurnMap = (
    key: string,
  ): Record<string, PersistedStreamingTurnState> => {
    const raw = getRouterState(key);
    try {
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const normalized: Record<string, PersistedStreamingTurnState> = {};
      for (const [streamingKey, value] of Object.entries(parsed)) {
        const normalizedState = normalizeStreamingTurnState(
          streamingKey,
          value,
        );
        if (normalizedState) {
          const targetKey = normalizedState.commitJid || streamingKey;
          const current = normalized[targetKey];
          if (
            !current ||
            isCursorAfter(normalizedState.cursor, current.cursor)
          ) {
            normalized[targetKey] = normalizedState;
          }
        }
      }
      return normalized;
    } catch {
      logger.warn(`Corrupted ${key} in DB, resetting`);
      return {};
    }
  };
  lastAgentTimestamp = loadCursorMap('last_agent_timestamp');
  lastCommittedCursor = normalizeCommittedCursorsOnLoad(
    lastAgentTimestamp,
    loadCursorMap('last_committed_cursor'),
  );
  activeStreamingTurns = loadStreamingTurnMap('active_streaming_turns');

  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();

  // Restore persisted OOM counters
  for (const { key, value } of getRouterStateByPrefix('oom_exits:')) {
    const folder = key.slice('oom_exits:'.length);
    const count = parseInt(value, 10);
    if (count > 0) {
      consecutiveOomExits[folder] = count;
      logger.info({ folder, count }, 'Restored OOM counter from DB');
    }
  }

  // Auto-register default groups from config/default-groups.json
  const defaultGroupsPath = path.resolve(
    resolveAppPath('config', 'default-groups.json'),
  );
  if (fs.existsSync(defaultGroupsPath)) {
    try {
      const defaults = JSON.parse(
        fs.readFileSync(defaultGroupsPath, 'utf-8'),
      ) as Array<{
        jid: string;
        name: string;
        folder: string;
      }>;
      for (const g of defaults) {
        if (!registeredGroups[g.jid]) {
          registerGroup(g.jid, {
            name: g.name,
            folder: g.folder,
            added_at: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load default groups config');
    }
  }

  // Ensure every active user has a home group (is_home=true).
  try {
    // Paginate through all active users
    const activeUsers: Array<{ id: string; role: string; username: string }> =
      [];
    {
      let page = 1;
      while (true) {
        const result = listUsers({ status: 'active', page, pageSize: 200 });
        activeUsers.push(...result.users);
        if (activeUsers.length >= result.total) break;
        page++;
      }
    }
    for (const user of activeUsers) {
      const homeJid = ensureUserHomeGroup(
        user.id,
        user.role as 'admin' | 'member',
        user.username,
      );
      // Always refresh this entry from DB to pick up any patches.
      const freshGroup = getRegisteredGroup(homeJid);
      if (freshGroup) {
        registeredGroups[homeJid] = freshGroup;
      } else if (!registeredGroups[homeJid]) {
        registeredGroups = getAllRegisteredGroups();
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to ensure user home groups');
  }

  if (SELF_CHECK_MODE) {
    logger.info('CLI_CLAW_SELF_CHECK=1, skipping workspace cwd defaults');
  } else {
    try {
      reconcileWorkspaceDefaults(LAUNCH_CWD);
    } catch (err) {
      logger.error(
        { err, launchCwd: LAUNCH_CWD },
        'Failed to materialize workspace cwd defaults',
      );
      throw err instanceof Error
        ? err
        : new Error(serializeErrorForOutput(err));
    }
  }

  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

export function loadRouterStateForTests(): void {
  loadState();
}

function saveState(): void {
  setRouterState('last_timestamp', globalMessageCursor.timestamp);
  setRouterState('last_timestamp_id', globalMessageCursor.id);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
  setRouterState('last_committed_cursor', JSON.stringify(lastCommittedCursor));
  setRouterState(
    'active_streaming_turns',
    JSON.stringify(activeStreamingTurns),
  );
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Sync group metadata from Feishu.
 * Fetches all bot groups and stores their names in the database.
 * Called on startup, daily, and on-demand via IPC.
 */
async function syncGroupMetadata(force = false): Promise<void> {
  // Check if we need to sync (skip if synced recently, unless forced)
  if (!force) {
    const lastSync = getLastGroupSync();
    if (lastSync) {
      const lastSyncTime = new Date(lastSync).getTime();
      const now = Date.now();
      if (now - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
        logger.debug({ lastSync }, 'Skipping group sync - synced recently');
        return;
      }
    }
  }

  // Sync groups via any connected user's Feishu instance
  const connectedUserIds = imManager.getConnectedUserIds();
  for (const uid of connectedUserIds) {
    if (imManager.isFeishuConnected(uid)) {
      await imManager.syncFeishuGroups(uid);
      break; // Only need one sync
    }
  }
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.jid.startsWith('feishu:'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  isShared = false,
): string {
  const lines = messages.map((m) => {
    const content = isShared ? `[${m.sender_name}] ${m.content}` : m.content;
    const sourceJid = m.source_jid || m.chat_jid;
    const channelType = getChannelType(sourceJid);
    let sourceAttr = '';
    if (channelType) {
      const chatId = extractChatId(sourceJid);
      sourceAttr = ` source="${escapeXml(channelType)}:${escapeXml(chatId)}"`;
    }
    return `<message sender="${escapeXml(m.sender_name)}"${sourceAttr} time="${m.timestamp}">${escapeXml(content)}</message>`;
  });
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function collectMessageImages(
  chatJid: string,
  messages: NewMessage[],
): Array<{ data: string; mimeType: string }> {
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const msg of messages) {
    if (!msg.attachments) continue;
    try {
      const parsed = JSON.parse(msg.attachments);
      const normalized = normalizeImageAttachments(parsed, {
        onMimeMismatch: ({ declaredMime, detectedMime }) => {
          logger.warn(
            { chatJid, messageId: msg.id, declaredMime, detectedMime },
            'Attachment MIME mismatch detected, using detected MIME',
          );
        },
      });
      for (const item of normalized) {
        images.push({ data: item.data, mimeType: item.mimeType });
      }
    } catch (err) {
      logger.warn(
        { chatJid, messageId: msg.id },
        'Failed to parse message attachments',
      );
    }
  }
  return images;
}

export function resolvePrimaryRuntimeSessionId({
  folder,
  sessions: sessionCache,
  loadSession,
}: {
  folder: string;
  sessions: Record<string, string | undefined>;
  loadSession: (folder: string) => string | undefined;
}): string | undefined {
  return sessionCache[folder] || loadSession(folder);
}

export function shouldIsolatePrimaryRuntimeForTurn(
  messages: Pick<NewMessage, 'source_kind'>[],
): boolean {
  return messages.some((message) => message.source_kind === 'assistant_prompt');
}

export function shouldIgnoreAssistantPromptPrimarySession({
  previousMessages,
  primarySessionId,
}: {
  previousMessages: Array<
    Pick<NewMessage, 'source_kind' | 'session_id'> & {
      is_from_me?: boolean | number | null;
    }
  >;
  primarySessionId?: string;
}): boolean {
  if (!primarySessionId) return false;

  for (let i = 0; i < previousMessages.length; i++) {
    const message = previousMessages[i];
    if (!message?.is_from_me || message.session_id !== primarySessionId) {
      continue;
    }

    const triggeringUser = previousMessages
      .slice(i + 1)
      .find((candidate) => !candidate.is_from_me);
    if (triggeringUser?.source_kind === 'assistant_prompt') {
      return true;
    }
  }
  return false;
}

export function shouldIgnorePreviousAssistantPromptSession(
  chatJid: string,
  firstCurrentMessage: Pick<NewMessage, 'timestamp' | 'id'>,
  primarySessionId?: string,
): boolean {
  const previousMessages = getMessagesPage(
    chatJid,
    {
      timestamp: firstCurrentMessage.timestamp,
      id: firstCurrentMessage.id,
    },
    500,
  );
  return shouldIgnoreAssistantPromptPrimarySession({
    previousMessages,
    primarySessionId,
  });
}

export interface PrimaryRuntimeSessionPolicy {
  currentPrimarySessionId?: string;
  isolatePrimaryRuntimeForTurn: boolean;
  ignorePreviousAssistantPromptSession: boolean;
  usePrimarySession: boolean;
  persistPrimarySession: boolean;
  reason: 'assistant_prompt_turn' | 'assistant_prompt_polluted_session' | null;
}

export function resolvePrimaryRuntimeSessionPolicy({
  chatJid,
  folder,
  messagesForAgent,
  sessions: sessionCache,
  loadSession,
}: {
  chatJid: string;
  folder: string;
  messagesForAgent: Array<Pick<NewMessage, 'source_kind' | 'timestamp' | 'id'>>;
  sessions: Record<string, string | undefined>;
  loadSession: (folder: string) => string | undefined;
}): PrimaryRuntimeSessionPolicy {
  const isolatePrimaryRuntimeForTurn =
    shouldIsolatePrimaryRuntimeForTurn(messagesForAgent);
  const currentPrimarySessionId = resolvePrimaryRuntimeSessionId({
    folder,
    sessions: sessionCache,
    loadSession,
  });
  const ignorePreviousAssistantPromptSession =
    !isolatePrimaryRuntimeForTurn &&
    messagesForAgent.length > 0 &&
    shouldIgnorePreviousAssistantPromptSession(
      chatJid,
      messagesForAgent[0]!,
      currentPrimarySessionId,
    );
  return {
    currentPrimarySessionId,
    isolatePrimaryRuntimeForTurn,
    ignorePreviousAssistantPromptSession,
    usePrimarySession:
      !isolatePrimaryRuntimeForTurn && !ignorePreviousAssistantPromptSession,
    persistPrimarySession: !isolatePrimaryRuntimeForTurn,
    reason: isolatePrimaryRuntimeForTurn
      ? 'assistant_prompt_turn'
      : ignorePreviousAssistantPromptSession
        ? 'assistant_prompt_polluted_session'
        : null,
  };
}

function rememberPrimaryRuntimeSession(
  folder: string,
  sessionId: string,
): void {
  sessions[folder] = sessionId;
  setSession(folder, sessionId);
}

function clearPrimaryRuntimeSession(folder: string): void {
  delete sessions[folder];
  deleteSession(folder);
}

export function resolveMessageSourceJid(
  message: Pick<NewMessage, 'chat_jid' | 'source_jid'>,
  fallbackChatJid: string,
): string {
  return message.source_jid || message.chat_jid || fallbackChatJid;
}

export function selectLeadingSourceTurnMessages<T extends NewMessage>(
  messages: readonly T[],
  fallbackChatJid: string,
): T[] {
  if (messages.length <= 1) return messages.slice();
  const firstSource = resolveMessageSourceJid(messages[0], fallbackChatJid);
  const firstIsAssistantPrompt = messages[0].source_kind === 'assistant_prompt';
  const selected: T[] = [];
  for (const message of messages) {
    if (resolveMessageSourceJid(message, fallbackChatJid) !== firstSource) {
      break;
    }
    const messageIsAssistantPrompt = message.source_kind === 'assistant_prompt';
    if (
      selected.length > 0 &&
      (firstIsAssistantPrompt || messageIsAssistantPrompt)
    ) {
      break;
    }
    selected.push(message);
  }
  return selected;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 *
 * Uses streaming output: agent results are sent to Feishu as they arrive.
 * The runner process stays alive for idleTimeout after each result, allowing
 * rapid-fire messages to be piped in without spawning a new process.
 */
export async function processGroupMessages(chatJid: string): Promise<boolean> {
  let group = registeredGroups[chatJid];
  if (!group) {
    // Group may have been created after loadState (e.g., during setup/registration)
    registeredGroups = getAllRegisteredGroups();
    group = registeredGroups[chatJid];
  }
  if (!group) return true;

  // activation_mode === 'disabled' 时忽略所有消息（DM 和群聊）
  if (group.activation_mode === 'disabled') {
    logger.debug({ chatJid }, 'Group activation_mode is disabled, skipping');
    return true;
  }

  const resolved = resolveEffectiveGroup(group);
  let effectiveGroup = resolved.effectiveGroup;
  let isHome = resolved.isHome;

  const isRecovery = recoveryGroups.has(chatJid);

  // Recovery replays from the last committed cursor rather than the last
  // accepted IPC cursor, so restart can recover messages injected into a
  // shared runner that died before consuming them.
  const sinceCursor = resolveMessageProcessingCursor(
    chatJid,
    lastAgentTimestamp,
    lastCommittedCursor,
    isRecovery,
  );
  const missedMessagesBeforeInterruptedDrop = getMessagesSince(
    chatJid,
    sinceCursor,
  );
  const rawMissedMessages = dropMessagesAtOrBeforeLatestInterruptedPartial(
    chatJid,
    sinceCursor,
    missedMessagesBeforeInterruptedDrop,
  );
  const droppedInterruptedContextCount =
    missedMessagesBeforeInterruptedDrop.length - rawMissedMessages.length;
  const missedMessages = isRecovery
    ? selectRecoverableRestartPendingMessages(rawMissedMessages)
    : rawMissedMessages;

  if (missedMessages.length === 0) {
    if (isRecovery) recoveryGroups.delete(chatJid);
    return true;
  }
  if (isRecovery) recoveryGroups.delete(chatJid);
  const interruptedResumeDecision = resolveInterruptedResumeDecision({
    chatJid,
    missedMessages,
  });
  const messagesForAgent =
    interruptedResumeDecision.action === 'use_current'
      ? interruptedResumeDecision.messagesForAgent
      : selectLeadingSourceTurnMessages(missedMessages, chatJid);
  const hasDeferredSourceMessages =
    messagesForAgent.length < missedMessages.length;
  if (interruptedResumeDecision.action !== 'none') {
    logger.info(
      {
        chatJid,
        action: interruptedResumeDecision.action,
        forwardedMessageCount: messagesForAgent.length,
        deferredMessageCount: Math.max(
          missedMessages.length - messagesForAgent.length,
          0,
        ),
      },
      'Interrupted resume decision applied',
    );
  }

  // Admin home is shared as web:main, so select runtime owner from the latest
  // active admin sender before resolving runtime/session ownership.
  if (chatJid === 'web:main' && effectiveGroup.is_home) {
    for (let i = missedMessages.length - 1; i >= 0; i--) {
      const sender = missedMessages[i]?.sender;
      if (!sender || sender === 'cli-claw-agent' || sender === '__system__')
        continue;
      const senderUser = getUserById(sender);
      if (senderUser?.status === 'active' && senderUser.role === 'admin') {
        effectiveGroup = { ...effectiveGroup, created_by: senderUser.id };
        break;
      }
    }
  }

  // Direct IM chats reply to themselves. Routed IM messages keep their original
  // source_jid so workspace-bound conversations can reply back to the sender
  // without mirroring every Web reply into IM.
  //
  // Pending messages are cut at the first source boundary, so a turn has one
  // reply route even when the DB backlog contains later messages from another
  // channel.
  const directImReply = getChannelType(chatJid) !== null;
  let replySourceImJid: string | null = null;
  if (!directImReply) {
    // chatJid is a web channel. The current turn has already been cut at the
    // first source boundary, so reply routing can follow the leading source.
    const firstSourceJid = messagesForAgent[0]?.source_jid || chatJid;
    if (getChannelType(firstSourceJid) !== null) {
      replySourceImJid = firstSourceJid;
    }
  } else {
    // chatJid is an IM channel — reply directly
    replySourceImJid = chatJid;
  }
  // Publish the current IM reply route so the IPC watcher can forward
  // send_message outputs to the correct IM channel.
  activeImReplyRoutes.set(effectiveGroup.folder, replySourceImJid);
  activeImLifecycleMessages.set(effectiveGroup.folder, messagesForAgent);
  const currentTurnSourceJid = resolveMessageSourceJid(
    messagesForAgent[0]!,
    chatJid,
  );

  const runtimeSessionPolicy = resolvePrimaryRuntimeSessionPolicy({
    chatJid,
    folder: effectiveGroup.folder,
    messagesForAgent,
    sessions,
    loadSession: getSession,
  });
  if (runtimeSessionPolicy.isolatePrimaryRuntimeForTurn) {
    logger.info(
      {
        chatJid,
        folder: effectiveGroup.folder,
        reason: runtimeSessionPolicy.reason,
        currentPrimarySessionId:
          runtimeSessionPolicy.currentPrimarySessionId ?? null,
      },
      'Using isolated runtime session for assistant-prompt turn',
    );
  } else if (runtimeSessionPolicy.ignorePreviousAssistantPromptSession) {
    logger.warn(
      {
        chatJid,
        folder: effectiveGroup.folder,
        reason: runtimeSessionPolicy.reason,
        ignoredSessionId: runtimeSessionPolicy.currentPrimarySessionId ?? null,
      },
      'Clearing assistant-prompt polluted runtime session for ordinary turn',
    );
    clearPrimaryRuntimeSession(effectiveGroup.folder);
  }

  const shared = isGroupShared(group.folder);
  let prompt = formatMessages(messagesForAgent, shared);

  const images = collectMessageImages(chatJid, messagesForAgent);
  const imagesForAgent = images.length > 0 ? images : undefined;

  logger.info(
    {
      group: group.name,
      messageCount: missedMessages.length,
      ignoredRecoveryMessageCount: isRecovery
        ? rawMissedMessages.length - missedMessages.length
        : 0,
      droppedInterruptedContextCount,
      forwardedMessageCount: messagesForAgent.length,
      directImReply,
      imageCount: images.length,
      shared,
      isRecovery,
    },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing agent process stdin',
      );
      queue.closeStdin(chatJid);
    }, getSystemSettings().idleTimeout);
  };

  await setTyping(chatJid, true);
  let hadError = false;
  let sentReply = false;
  let lastError = '';
  let lastReplyMsgId: string | undefined;
  let lastSavedTurnId: string | undefined; // tracks last turnId saved to DB, prevents UPSERT overwrite
  const queryTaskIds = new Set<string>();
  const lastProcessed = messagesForAgent[messagesForAgent.length - 1];
  let activeTurnCursor: MessageCursor = {
    timestamp: lastProcessed.timestamp,
    id: lastProcessed.id,
  };
  const activeStreamingTurnKey = buildStreamingTurnStateKey(chatJid);
  const streamingSnapshotKey = resolveStreamingSnapshotKey(chatJid);

  // ── Feishu Streaming Card ──
  // Create a streaming session for Feishu channels (typing-machine effect).
  // Non-Feishu channels get undefined → all streaming logic is no-op.
  let streamingSessionJid = replySourceImJid ?? chatJid;
  const makeOnCardCreated = (jid: string) => (messageId: string) =>
    registerMessageIdMapping(messageId, jid);
  let streamingSession = imManager.createStreamingSession(
    streamingSessionJid,
    makeOnCardCreated(streamingSessionJid),
  );
  let streamingPresentationText = createEmptyStreamPresentationTextState();
  let streamingAccumulatedThinking = '';
  let streamInterrupted = false;
  let activeStreamingEventTurnId: string | undefined;
  let activeStreamingMessageCursorId: string | undefined;
  let streamStartedLifecycleRecorded = false;
  let lifecycleMessagesForActiveTurn = messagesForAgent;
  let activeLastProcessed = lastProcessed;
  if (streamingSession) {
    registerStreamingSession(streamingSessionJid, streamingSession);
    logger.debug({ chatJid }, 'Streaming card session created for Feishu');
  }
  const ensureStreamingSessionAvailable = () => {
    streamingSession = ensureLateBoundStreamingSession(streamingSession, {
      createJid: streamingSessionJid,
      registerJid: streamingSessionJid,
      isChannelAvailable: (jid) => imManager.isChannelAvailableForJid(jid),
      createSession: (jid) =>
        imManager.createStreamingSession(jid, makeOnCardCreated(jid)),
      registerSession: registerStreamingSession,
    });
    return streamingSession;
  };
  const resetStreamingSessionForNewInput = (nextStreamingJid: string) => {
    if (streamingSession) {
      if (streamingSession.isActive()) {
        void streamingSession.abort('新的回复已开始').catch(() => {});
      } else {
        streamingSession.dispose();
      }
      unregisterStreamingSession(streamingSessionJid);
    }
    streamingSessionJid = nextStreamingJid;
    streamingSession = undefined;
    const resetState = resetStreamingTurnBoundaryForNewInput();
    streamingPresentationText = resetState.presentationText;
    streamingAccumulatedThinking = resetState.thinkingText;
    streamInterrupted = resetState.interrupted;
    activeStreamingEventTurnId = resetState.turnId;
    activeStreamingMessageCursorId = resetState.messageCursorId;
    activeStreamingTurnStartedAt = Date.now();
    streamStartedLifecycleRecorded = false;
    ensureStreamingSessionAvailable();
  };

  // ── Dynamic reply route updater ──
  // Allows IPC-injected messages (from web.ts / IM polling) to update the
  // reply routing target without killing the agent process.  This replaces
  // the old "closeStdin + restart" approach for home groups (#99).
  activeRouteUpdaters.set(
    effectiveGroup.folder,
    (newSourceJid, lifecycleMessages) => {
      if (lifecycleMessages?.length) {
        activeImLifecycleMessages.set(effectiveGroup.folder, lifecycleMessages);
        lifecycleMessagesForActiveTurn = lifecycleMessages;
        activeLastProcessed = lifecycleMessages[lifecycleMessages.length - 1]!;
        activeTurnCursor = {
          timestamp: activeLastProcessed.timestamp,
          id: activeLastProcessed.id,
        };
      } else if (!newSourceJid || getChannelType(newSourceJid) === null) {
        activeImLifecycleMessages.delete(effectiveGroup.folder);
      }
      const newImJid =
        newSourceJid && getChannelType(newSourceJid) ? newSourceJid : null;
      // New IPC user message arrived — reset sentReply so the next result
      // can be delivered to IM. This is the correct place to reset, NOT
      // in the streaming session rebuild (which also fires on SDK Task
      // completion and would cause multi-result IM spam).
      sentReply = false;
      if (newImJid === replySourceImJid) {
        resetStreamingSessionForNewInput(streamingSessionJid);
        return;
      }
      logger.debug(
        { chatJid, oldRoute: replySourceImJid, newRoute: newImJid },
        'Reply route updated via IPC injection',
      );
      replySourceImJid = newImJid;
      activeImReplyRoutes.set(effectiveGroup.folder, replySourceImJid);
      updateActiveStreamingTurnReplyJid(
        activeStreamingTurnKey,
        replySourceImJid ?? chatJid,
      );

      // Rebuild streaming session if the target channel changed.
      // When the route is cleared to null (web message injected into IM-originated
      // session), fall back to the web JID — NOT the original IM chatJid — so the
      // Feishu streaming card is properly disposed.
      const newStreamingJid =
        replySourceImJid ??
        (directImReply ? `web:${effectiveGroup.folder}` : chatJid);
      resetStreamingSessionForNewInput(newStreamingJid);
    },
  );

  const pickRunningTaskForNotification = (): string | null => {
    const runningInQuery = Array.from(queryTaskIds)
      .map((id) => getAgent(id))
      .filter(
        (a): a is NonNullable<ReturnType<typeof getAgent>> =>
          !!a &&
          a.kind === 'task' &&
          a.chat_jid === chatJid &&
          a.status === 'running',
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (runningInQuery.length > 0) {
      return runningInQuery[0].id;
    }
    const runningInChat = listAgentsByJid(chatJid)
      .filter((a) => a.kind === 'task' && a.status === 'running')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return runningInChat[0]?.id || null;
  };

  let cursorCommitBlockedReason: string | null = null;
  let queuedDeferredSourceMessages = false;
  const blockCursorCommit = (reason: string): void => {
    cursorCommitBlockedReason ??= reason;
  };
  const commitCursor = (): boolean => {
    if (cursorCommitBlockedReason) {
      logger.warn(
        { chatJid, reason: cursorCommitBlockedReason },
        'Skipping cursor commit until IM delivery succeeds',
      );
      return false;
    }
    advanceCursors(chatJid, activeTurnCursor);
    if (clearActiveStreamingTurns([activeStreamingTurnKey])) {
      saveState();
    }
    if (hasDeferredSourceMessages && !queuedDeferredSourceMessages) {
      queuedDeferredSourceMessages = true;
      queue.enqueueMessageCheck(chatJid);
    }
    return true;
  };

  if (effectiveGroup.created_by) {
    const owner = getUserById(effectiveGroup.created_by);
    if (owner && owner.role !== 'admin') {
      const accessResult = checkBillingAccessFresh(
        effectiveGroup.created_by,
        owner.role,
      );
      if (!accessResult.allowed) {
        const sysMsg = formatBillingAccessDeniedMessage(accessResult);
        sendBillingDeniedMessage(chatJid, sysMsg);
        commitCursor();
        await setTyping(chatJid, false);
        logger.info(
          {
            chatJid,
            userId: effectiveGroup.created_by,
            reason: accessResult.reason,
            blockType: accessResult.blockType,
          },
          'Billing access denied inside processGroupMessages',
        );
        return true;
      }
    }
  }

  let output:
    | { status: 'success' | 'error' | 'closed'; error?: string }
    | undefined;
  let activeSessionId = runtimeSessionPolicy.usePrimarySession
    ? runtimeSessionPolicy.currentPrimarySessionId || undefined
    : undefined;
  let activeRuntimeIdentity: RuntimeIdentity | null =
    resolveEffectiveRuntimeIdentity(effectiveGroup, {
      ...getOpenAiRuntimeIdentityOptions(),
    });
  const agentRunStartedAt = Date.now();
  let activeStreamingTurnStartedAt = agentRunStartedAt;
  try {
    output = await runAgent(
      effectiveGroup,
      prompt,
      chatJid,
      lastProcessed.id,
      activeTurnCursor,
      async (result) => {
        try {
          if (result.newSessionId && result.status !== 'error') {
            activeSessionId = result.newSessionId;
          }
          activeRuntimeIdentity = mergeRuntimeIdentity(
            activeRuntimeIdentity,
            result.streamEvent?.runtimeIdentity || result.runtimeIdentity,
          );
          // 流式事件处理 - 广播 WebSocket + 持久化 SDK Task 生命周期到 DB
          if (result.status === 'stream' && result.streamEvent) {
            const streamEvent = activeRuntimeIdentity
              ? {
                  ...result.streamEvent,
                  runtimeIdentity: activeRuntimeIdentity,
                }
              : result.streamEvent;
            const eventCursorId = streamEvent.messageCursor?.id?.trim();
            if (
              eventCursorId &&
              activeTurnCursor.id &&
              eventCursorId !== activeTurnCursor.id
            ) {
              logger.warn(
                {
                  chatJid,
                  eventCursorId,
                  activeCursorId: activeTurnCursor.id,
                  eventType: streamEvent.eventType,
                  turnId: streamEvent.turnId,
                },
                'Suppressing stale stream event for previous message cursor',
              );
              return;
            }
            if (streamingSession) {
              const streamText =
                typeof streamEvent.text === 'string' ? streamEvent.text : '';
              logger.debug(
                {
                  chatJid,
                  eventType: streamEvent.eventType,
                  turnId: streamEvent.turnId,
                  sessionId: streamEvent.sessionId || activeSessionId || null,
                  eventCursorId: eventCursorId || null,
                  activeCursorId: activeTurnCursor.id || null,
                  streamingSessionJid,
                  sessionActive: streamingSession.isActive(),
                  textLength: streamText.length,
                  textPreview:
                    streamText.length > 0
                      ? streamText.slice(0, 160)
                      : undefined,
                  assistantMessagePhase:
                    streamEvent.assistantMessagePhase ?? null,
                  answerLength: streamingPresentationText.answerText.length,
                  commentaryLength:
                    streamingPresentationText.commentaryText.length,
                  thinkingLength: streamingAccumulatedThinking.length,
                },
                'Feishu stream event before card feed',
              );
            }
            const turnBoundary = applyStreamingTurnBoundary(
              {
                turnId: activeStreamingEventTurnId,
                messageCursorId: activeStreamingMessageCursorId,
                startedAtMs: activeStreamingTurnStartedAt,
                presentationText: streamingPresentationText,
                thinkingText: streamingAccumulatedThinking,
                interrupted: streamInterrupted,
              },
              streamEvent,
            );
            if (turnBoundary.turnChanged) {
              streamingPresentationText =
                turnBoundary.nextState.presentationText;
              streamingAccumulatedThinking =
                turnBoundary.nextState.thinkingText;
              streamInterrupted = turnBoundary.nextState.interrupted;
              activeStreamingTurnStartedAt =
                turnBoundary.nextState.startedAtMs ?? Date.now();
              streamStartedLifecycleRecorded = false;
              if (streamingSession) {
                if (streamingSession.isActive()) {
                  await streamingSession
                    .abort('新的回复已开始')
                    .catch(() => {});
                } else {
                  streamingSession.dispose();
                }
                unregisterStreamingSession(streamingSessionJid);
                streamingSession = undefined;
                ensureStreamingSessionAvailable();
              }
            }
            activeStreamingEventTurnId = turnBoundary.nextState.turnId;
            activeStreamingMessageCursorId =
              turnBoundary.nextState.messageCursorId;
            if (streamEvent.eventType === 'init' && streamEvent.messageCursor) {
              setActiveStreamingTurn(
                activeStreamingTurnKey,
                chatJid,
                normalizeCursor(streamEvent.messageCursor),
                replySourceImJid ?? chatJid,
                streamingSnapshotKey,
                {
                  turnId: streamEvent.turnId,
                  messageCursorId: streamEvent.messageCursor.id,
                },
              );
              activeTurnCursor = normalizeCursor(streamEvent.messageCursor);
              if (!streamStartedLifecycleRecorded) {
                recordStreamStartedLifecycleForMessages({
                  messages: lifecycleMessagesForActiveTurn,
                  streamEvent,
                  details: {
                    route: replySourceImJid
                      ? replySourceImJid === chatJid
                        ? 'direct_im'
                        : 'routed_im'
                      : 'web',
                    streamingJid: streamingSessionJid,
                  },
                });
                streamStartedLifecycleRecorded = true;
              }
            }
            const streamEventWithFooterUsage =
              await enrichUsageStreamEventForFooter(
                streamEvent,
                activeRuntimeIdentity,
                activeStreamingTurnStartedAt,
              );
            broadcastStreamEvent(chatJid, streamEventWithFooterUsage);

            // ── 累积 text_delta / thinking_delta 文本（中断时用于保存已输出内容）──
            if (streamEvent.eventType === 'text_delta' && streamEvent.text) {
              streamingPresentationText = appendStreamPresentationText(
                streamingPresentationText,
                streamEvent,
                activeRuntimeIdentity,
              );
            }
            if (
              streamEvent.eventType === 'thinking_delta' &&
              streamEvent.text
            ) {
              streamingAccumulatedThinking += streamEvent.text;
            }

            // ── Feed stream events into Feishu streaming card ──
            // IPC 注入的新 query 开始时，旧卡片已 complete()/abort()，
            // 需要为新 query 重建流式卡片并重置会话级状态。
            if (shouldRebuildStreamingSessionBeforeEvent(streamingSession)) {
              logger.warn(
                {
                  chatJid,
                  eventType: streamEvent.eventType,
                  turnId: streamEvent.turnId,
                  sessionId: streamEvent.sessionId || activeSessionId || null,
                  eventCursorId: eventCursorId || null,
                  activeCursorId: activeTurnCursor.id || null,
                  streamingSessionJid,
                  sessionState: streamingSession?.currentState ?? null,
                  previousAnswerLength:
                    streamingPresentationText.answerText.length,
                  previousCommentaryLength:
                    streamingPresentationText.commentaryText.length,
                  previousThinkingLength: streamingAccumulatedThinking.length,
                },
                'Rebuilding inactive Feishu streaming card before event feed',
              );
              unregisterStreamingSession(streamingSessionJid);
              streamingSession = undefined;
              if (ensureStreamingSessionAvailable()) {
                logger.debug(
                  { chatJid },
                  'Rebuilt streaming card for IPC-injected query',
                );
              }
            }
            const activeStreamingSession = ensureStreamingSessionAvailable();
            if (activeStreamingSession) {
              feedStreamEventToCard(
                activeStreamingSession,
                streamEventWithFooterUsage,
                streamingPresentationText,
              );
            }

            // ── 中断时立即保存已输出内容 ──
            // agent-runner 中断后不退出进程（进入 waitForIpcMessage），
            // finally 块不会执行，必须在此处立即保存。
            if (
              streamEvent.eventType === 'status' &&
              streamEvent.statusText === 'interrupted'
            ) {
              streamInterrupted = true;
              const provisionalUsage = buildProvisionalTokenUsage(
                activeStreamingTurnStartedAt,
              );
              // Skip if shutdown handler already saved this text (prevents duplicates)
              const inlineWebJid = chatJid.startsWith('web:')
                ? chatJid
                : `web:${effectiveGroup.folder}`;
              const inlineAlreadySaved =
                shutdownSavedJids.has(chatJid) ||
                shutdownSavedJids.has(inlineWebJid);
              if (!sentReply && !inlineAlreadySaved) {
                const interruptedText = buildInterruptedReply(
                  streamingPresentationText.answerText,
                  streamingAccumulatedThinking,
                  streamingPresentationText.commentaryText,
                );
                try {
                  let streamingCardHandledIM = false;
                  const activeStreamingSession =
                    ensureStreamingSessionAvailable();
                  if (activeStreamingSession?.isActive()) {
                    await patchStreamingSessionFooterUsage(
                      activeStreamingSession,
                      activeRuntimeIdentity,
                      provisionalUsage,
                    ).catch(() => {});
                    syncTerminalPresentationTextToCard(
                      activeStreamingSession,
                      streamingPresentationText,
                      undefined,
                    );
                    streamingCardHandledIM = await activeStreamingSession
                      .abort('已中断')
                      .then(() => true)
                      .catch(() => false);
                  }
                  lastReplyMsgId = await sendMessage(chatJid, interruptedText, {
                    sendToIM: false,
                    messageMeta: {
                      turnId: streamEvent.turnId || activeLastProcessed.id,
                      sessionId: streamEvent.sessionId || activeSessionId,
                      sourceKind: 'interrupt_partial',
                      finalizationReason: 'interrupted',
                      runtimeIdentity: activeRuntimeIdentity,
                      tokenUsage: provisionalUsage,
                    },
                  });
                  const replyImJid = resolveInterruptedPartialImJid(
                    replySourceImJid ?? (directImReply ? null : chatJid),
                  );
                  const staticImDeliverySucceeded =
                    await sendInterruptedPartialToImIfNeeded({
                      replyImJid,
                      streamingCardHandledIm: streamingCardHandledIM,
                      text: interruptedText,
                      groupFolder: effectiveGroup.folder,
                      lifecycleMessages: messagesForAgent,
                      lifecycleDetails: { deliveryPoint: 'main_status' },
                    });
                  if (
                    !shouldCommitCursorAfterInterruptedPartialDelivery({
                      replyImJid,
                      streamingCardHandledIm: streamingCardHandledIM,
                      staticImDeliverySucceeded,
                    })
                  ) {
                    blockCursorCommit('interrupted_partial_delivery_failed');
                  }
                  sentReply = true;
                  clearStreamingSnapshot(chatJid);
                  streamingPresentationText =
                    createEmptyStreamPresentationTextState();
                  streamingAccumulatedThinking = '';
                  activeStreamingEventTurnId = undefined;
                  activeStreamingMessageCursorId = undefined;
                  commitCursor();
                } catch (err) {
                  logger.warn(
                    { err, chatJid },
                    'Failed to save interrupted text on status event',
                  );
                }
              }
            }

            // Persist SDK Task lifecycle to DB so tabs survive page refresh
            const se = streamEventWithFooterUsage;
            if (
              (se.eventType === 'task_start' && se.toolUseId) ||
              (se.eventType === 'tool_use_start' &&
                se.toolName === 'Task' &&
                se.toolUseId)
            ) {
              try {
                const taskId = se.toolUseId;
                queryTaskIds.add(taskId);
                const existing = getAgent(taskId);
                const desc = se.taskDescription || se.toolInputSummary || '';
                const taskName = desc.slice(0, 40) || existing?.name || 'Task';
                if (!existing) {
                  createAgent({
                    id: taskId,
                    group_folder: group.folder,
                    chat_jid: chatJid,
                    name: taskName,
                    prompt: desc,
                    status: 'running',
                    kind: 'task',
                    created_by: null,
                    created_at: new Date().toISOString(),
                    completed_at: null,
                    result_summary: null,
                    last_im_jid: null,
                    spawned_from_jid: null,
                  });
                } else if (se.taskDescription) {
                  updateAgentInfo(
                    taskId,
                    se.taskDescription.slice(0, 40),
                    se.taskDescription,
                  );
                }
                broadcastAgentStatus(
                  chatJid,
                  taskId,
                  'running',
                  taskName,
                  desc,
                  undefined,
                  'task',
                );
              } catch (err) {
                logger.warn(
                  { err, toolUseId: se.toolUseId },
                  'Failed to persist task_start to DB',
                );
              }
            }
            if (se.eventType === 'tool_use_end' && se.toolUseId) {
              try {
                const existing = getAgent(se.toolUseId);
                if (
                  existing &&
                  existing.kind === 'task' &&
                  existing.status === 'running'
                ) {
                  updateAgentStatus(se.toolUseId, 'completed');
                  queryTaskIds.delete(existing.id);
                  broadcastAgentStatus(
                    chatJid,
                    existing.id,
                    'completed',
                    existing.name,
                    existing.prompt,
                    existing.result_summary || '任务已完成',
                    'task',
                  );
                }
              } catch (err) {
                logger.warn(
                  { err, toolUseId: se.toolUseId },
                  'Failed to persist tool_use_end to DB',
                );
              }
            }
            if (se.eventType === 'task_notification' && se.taskId) {
              try {
                const status =
                  se.taskStatus === 'completed' ? 'completed' : 'error';
                const summary = se.taskSummary?.slice(0, 2000);
                let targetTaskId = se.taskId;
                let existing = getAgent(targetTaskId);
                if (!existing || existing.kind !== 'task') {
                  // agent-runner now translates SDK task_id → toolUseId,
                  // so this fallback should rarely trigger. Keep as safety net.
                  const fallbackTaskId = pickRunningTaskForNotification();
                  if (fallbackTaskId) {
                    targetTaskId = fallbackTaskId;
                    existing = getAgent(fallbackTaskId);
                    logger.debug(
                      {
                        chatJid,
                        sdkTaskId: se.taskId,
                        mappedTaskId: fallbackTaskId,
                      },
                      'Task notification ID fallback to running task',
                    );
                  }
                }

                if (!existing) {
                  createAgent({
                    id: targetTaskId,
                    group_folder: group.folder,
                    chat_jid: chatJid,
                    name: 'Task',
                    prompt: '',
                    status,
                    kind: 'task',
                    created_by: null,
                    created_at: new Date().toISOString(),
                    completed_at: new Date().toISOString(),
                    result_summary: summary || null,
                    last_im_jid: null,
                    spawned_from_jid: null,
                  });
                  broadcastAgentStatus(
                    chatJid,
                    targetTaskId,
                    status,
                    'Task',
                    '',
                    summary,
                    'task',
                  );
                } else if (existing.kind === 'task') {
                  updateAgentStatus(existing.id, status, summary);
                  queryTaskIds.delete(existing.id);
                  broadcastAgentStatus(
                    chatJid,
                    existing.id,
                    status,
                    existing.name,
                    existing.prompt,
                    summary,
                    'task',
                  );
                }
              } catch (err) {
                logger.warn(
                  { err, taskId: se.taskId },
                  'Failed to persist task_notification to DB',
                );
              }
            }

            // Persist token usage to the latest agent message + usage_records
            if (se.eventType === 'usage' && se.usage) {
              try {
                updateLatestMessageTokenUsage(
                  chatJid,
                  JSON.stringify(se.usage),
                  lastReplyMsgId,
                  se.usage.costUSD,
                );

                // Write to usage_records + usage_daily_summary
                writeUsageRecords({
                  userId: effectiveGroup.created_by || 'system',
                  groupFolder: effectiveGroup.folder,
                  messageId: lastReplyMsgId,
                  usage: se.usage,
                });

                logger.debug(
                  {
                    chatJid,
                    msgId: lastReplyMsgId,
                    costUSD: se.usage.costUSD,
                    inputTokens: se.usage.inputTokens,
                  },
                  'Token usage persisted',
                );

                // Update billing monthly usage
                const ownerGroup = registeredGroups[chatJid];
                if (ownerGroup?.created_by && se.usage.costUSD) {
                  try {
                    const effective = updateUsage(
                      ownerGroup.created_by,
                      se.usage.costUSD,
                      se.usage.inputTokens || 0,
                      se.usage.outputTokens || 0,
                    );
                    deductUsageCost(
                      ownerGroup.created_by,
                      se.usage.costUSD,
                      lastReplyMsgId || chatJid,
                      effective,
                    );
                    // Broadcast real-time billing update to the user
                    const owner = getUserById(ownerGroup.created_by);
                    if (owner && owner.role !== 'admin') {
                      const freshAccess = checkBillingAccessFresh(
                        ownerGroup.created_by,
                        owner.role,
                      );
                      if (freshAccess.usage) {
                        broadcastBillingUpdate(ownerGroup.created_by, {
                          ...freshAccess,
                        });
                      }
                    }
                  } catch (billingErr) {
                    logger.warn(
                      { err: billingErr, chatJid },
                      'Failed to update billing usage',
                    );
                  }
                }
              } catch (err) {
                logger.warn({ err, chatJid }, 'Failed to persist token usage');
              }
            }

            // Reset idle timer on stream events so long-running tool calls
            // (e.g. MCP batch writes) don't get killed while the agent is
            // actively working. Previously only final results triggered a reset.
            resetIdleTimer();
            return;
          }

          // Streaming output callback — called for each agent result
          if (result.result) {
            const raw =
              typeof result.result === 'string'
                ? result.result
                : JSON.stringify(result.result);
            let text = stripAgentInternalTags(raw);
            if (result.sourceKind === 'overflow_partial') {
              text = buildOverflowPartialReply(text);
            }
            logger.info(
              { group: group.name },
              `Agent output: ${raw.slice(0, 200)}`,
            );
            if (text) {
              // Stop typing indicator before sending — clears the 4s refresh timer
              // so it doesn't keep firing while the agent stays alive in idle state.
              await setTyping(chatJid, false);
              const visibleReplyParts = resolveVisibleReplyParts(
                text,
                streamingPresentationText,
                activeRuntimeIdentity,
              );
              logOpenAiFinalVisibleReplyFields({
                chatJid,
                group: group.name,
                turnId: result.turnId,
                sessionId: result.sessionId || activeSessionId,
                sdkMessageUuid: result.sdkMessageUuid,
                sourceKind: result.sourceKind || 'sdk_final',
                finalizationReason: result.finalizationReason || 'completed',
                rawText: text,
                presentationText: streamingPresentationText,
                runtimeIdentity: activeRuntimeIdentity,
                visibleReplyParts,
                message: 'OpenAI final visible reply fields resolved',
              });
              if (visibleReplyParts.droppedPresentationAnswer) {
                logger.warn(
                  {
                    chatJid,
                    group: group.name,
                    turnId: result.turnId,
                    sessionId: result.sessionId,
                    sdkMessageUuid: result.sdkMessageUuid,
                    rawTextLen: text.length,
                    presentationAnswerLen:
                      streamingPresentationText.answerText.length,
                    presentationCommentaryLen:
                      streamingPresentationText.commentaryText.length,
                    runtimeIdentity: activeRuntimeIdentity,
                    sourceKind: result.sourceKind || 'sdk_final',
                    finalizationReason:
                      result.finalizationReason || 'completed',
                  },
                  'Ignored presentation answer for final visible reply',
                );
              }
              const visibleText = decorateTaskReplyText(
                visibleReplyParts.visibleText,
                result.sourceKind || 'sdk_final',
                chatJid,
              );
              recordLifecycleForMessages({
                messages: lifecycleMessagesForActiveTurn,
                stage: 'finalized',
                details: {
                  sourceKind: result.sourceKind || 'sdk_final',
                  finalizationReason: result.finalizationReason || 'completed',
                  visibilityResolution: {
                    agentType: activeRuntimeIdentity?.agentType ?? null,
                    selectedSource: 'raw_final',
                    rawFinalLength: text.length,
                    presentationAnswerLength:
                      streamingPresentationText.answerText.length,
                    visibleTextLength: visibleReplyParts.visibleText.length,
                  },
                },
              });
              const localImagePaths = extractLocalImImagePaths(
                visibleText,
                effectiveGroup.folder,
              );

              // ── Complete Feishu streaming card ──
              // If a streaming card is active, finalize it with the complete text.
              // The card replaces the normal IM sendMessage for the Feishu channel.
              let streamingCardHandledIM = false;
              const activeStreamingSession = ensureStreamingSessionAvailable();
              if (activeStreamingSession?.isActive()) {
                try {
                  activeStreamingSession.setRuntimeIdentity(
                    activeRuntimeIdentity,
                  );
                  await patchStreamingSessionFooterUsage(
                    activeStreamingSession,
                    activeRuntimeIdentity,
                    buildProvisionalTokenUsage(activeStreamingTurnStartedAt),
                  ).catch(() => {});
                  syncTerminalPresentationTextToCard(
                    activeStreamingSession,
                    streamingPresentationText,
                    visibleReplyParts.commentaryText,
                  );
                  if (result.finalizationReason === 'error') {
                    await activeStreamingSession.fail(visibleText);
                  } else {
                    await activeStreamingSession.complete(visibleText);
                  }
                  streamingCardHandledIM = true;
                  recordLifecycleForMessages({
                    messages: lifecycleMessagesForActiveTurn,
                    stage: 'im_delivered',
                    details: {
                      delivery: 'streaming_card',
                      targetJid: streamingSessionJid,
                      messageId: activeStreamingSession.currentMessageId,
                    },
                  });
                  // Streaming card replaced the normal sendMessage path,
                  // so clear the ack reaction that would normally be cleared in sendMessage.
                  imManager.clearAckReaction(chatJid);
                  logger.debug(
                    { chatJid },
                    'Streaming card completed with final text',
                  );
                } catch (err) {
                  logger.warn(
                    { err, chatJid },
                    'Streaming card complete failed, falling back to static message',
                  );
                  // Abort the card so it doesn't stay stuck in "streaming" state
                  await activeStreamingSession
                    .abort('回复已通过消息发送')
                    .catch(() => {});
                  // Fall through to normal sendMessage
                }
              }

              // ── Rebuild streaming card after overflow_partial ──
              // The completed card was consumed; create a new one so post-compaction
              // tool-call progress remains visible on Feishu (#223).
              if (
                streamingCardHandledIM &&
                result.sourceKind === 'overflow_partial'
              ) {
                unregisterStreamingSession(streamingSessionJid);
                streamingPresentationText =
                  createEmptyStreamPresentationTextState();
                streamingAccumulatedThinking = '';
                streamingSession = undefined;
                if (ensureStreamingSessionAvailable()) {
                  logger.debug(
                    { chatJid, sourceKind: result.sourceKind },
                    'Rebuilt streaming card after partial output',
                  );
                }
              }

              // Skip IM send to the original chatJid when:
              // 1. Streaming card already handled the IM delivery, OR
              // 2. Reply route switched to a different IM channel (the routed IM
              //    path below will deliver to the correct channel instead), OR
              // 3. Reply route was cleared to null (web message injected into an
              //    IM-originated session — replies should go to web only).
              // Any send_message content is delivered independently via IPC watcher.
              const routeCleared = directImReply && replySourceImJid === null;
              const routeSwitchedAway =
                directImReply &&
                replySourceImJid !== null &&
                replySourceImJid !== chatJid;
              const skipImSend =
                (streamingCardHandledIM && directImReply) ||
                routeSwitchedAway ||
                routeCleared;
              // When the runner stays alive and processes multiple IPC messages,
              // result.turnId stays the same (set at process start).  If we already
              // saved a reply with this turnId, the INSERT OR REPLACE would overwrite
              // the previous reply.  Use a fresh ID to prevent that.
              const effectiveTurnId = result.turnId || activeLastProcessed.id;
              const turnIdForDb =
                sentReply && effectiveTurnId === lastSavedTurnId
                  ? undefined // no turnId → fresh INSERT, no UPSERT dedup
                  : effectiveTurnId;

              const directImSendRequested = directImReply && !skipImSend;
              lastReplyMsgId = await sendMessage(chatJid, visibleText, {
                sendToIM: directImSendRequested,
                localImagePaths,
                messageMeta: {
                  turnId: turnIdForDb,
                  sessionId: result.sessionId || activeSessionId,
                  sdkMessageUuid: result.sdkMessageUuid,
                  sourceKind: result.sourceKind || 'sdk_final',
                  finalizationReason: result.finalizationReason || 'completed',
                  runtimeIdentity: activeRuntimeIdentity,
                },
              });
              if (directImSendRequested) {
                recordLifecycleForMessages({
                  messages: lifecycleMessagesForActiveTurn,
                  stage: 'im_delivered',
                  details: { delivery: 'static_message', targetJid: chatJid },
                });
              }
              lastSavedTurnId = effectiveTurnId;

              // For routed IM (web JID with IM source), only send the FIRST
              // substantive reply to IM. Subsequent results (e.g., SDK Task
              // completions) are stored in DB but not spammed to IM.
              // Streaming card already handles IM delivery for the first reply.
              if (replySourceImJid && replySourceImJid !== chatJid) {
                if (!streamingCardHandledIM && !sentReply) {
                  const imSent = await sendImWithRetry(
                    replySourceImJid,
                    visibleText,
                    localImagePaths,
                  );
                  recordLifecycleForMessages({
                    messages: lifecycleMessagesForActiveTurn,
                    stage: 'im_delivered',
                    status: imSent ? 'ok' : 'error',
                    reason: imSent ? null : 'send_failed_after_retries',
                    details: { delivery: 'static_message' },
                  });
                  if (
                    !shouldCommitCursorAfterRoutedImDelivery({
                      requiresRoutedImDelivery: true,
                      routedImDeliverySucceeded: imSent,
                    })
                  ) {
                    blockCursorCommit('routed_im_delivery_failed');
                  }
                }
              }

              // Optional mirror mode for explicitly bound IM channels
              const webJid = chatJid.startsWith('web:')
                ? chatJid
                : `web:${effectiveGroup.folder}`;
              for (const [imJid, g] of Object.entries(registeredGroups)) {
                if (
                  g.target_main_jid !== webJid ||
                  imJid === chatJid ||
                  imJid === replySourceImJid
                )
                  continue;
                if (g.reply_policy !== 'mirror') continue;
                if (getChannelType(imJid))
                  sendImWithFailTracking(imJid, visibleText, localImagePaths, {
                    lifecycleMessages: lifecycleMessagesForActiveTurn,
                    lifecycleDetails: { delivery: 'mirror_message' },
                  });
              }

              sentReply = true;
              // Clear streaming snapshot so the next turn starts fresh.
              // Without this, saveInterruptedStreamingMessages() would merge
              // text from multiple turns into one message on shutdown.
              clearStreamingSnapshot(chatJid);
              streamingPresentationText =
                createEmptyStreamPresentationTextState();
              streamingAccumulatedThinking = '';
              activeStreamingEventTurnId = undefined;
              activeStreamingMessageCursorId = undefined;
              // Persist cursor as soon as a visible reply is emitted.
              // Long-lived runners may stay alive for idleTimeout, and waiting
              // until process exit would cause duplicate replay after restart.
              if (commitCursor()) {
                recordLifecycleForMessages({
                  messages: lifecycleMessagesForActiveTurn,
                  stage: 'cursor_committed',
                  details: { cursor: activeTurnCursor },
                });
              }
            }
            // Only reset idle timer on actual results, not session-update markers (result: null)
            resetIdleTimer();
          }

          if (result.status === 'error') {
            hadError = true;
            if (result.error) lastError = result.error;
          }
        } catch (err) {
          logger.error({ group: group.name, err }, 'onOutput callback failed');
          hadError = true;
        }
      },
      imagesForAgent,
      currentTurnSourceJid,
      {
        usePrimarySession: runtimeSessionPolicy.usePrimarySession,
        persistPrimarySession: runtimeSessionPolicy.persistPrimarySession,
      },
    );
  } finally {
    await setTyping(chatJid, false);
    // Always clear ack reaction in finally — covers error/interrupt/abort paths
    // where the normal sendMessage (which clears it) is never called.
    imManager.clearAckReaction(chatJid);
    if (idleTimer) clearTimeout(idleTimer);
    activeRouteUpdaters.delete(effectiveGroup.folder);
    activeImReplyRoutes.delete(effectiveGroup.folder);
    activeImLifecycleMessages.delete(effectiveGroup.folder);

    // ── 检测中断：有累积文本但从未发送回复 ──
    const wasInterrupted = streamInterrupted && !sentReply;

    // ── Streaming card cleanup ──
    const activeStreamingSession = streamingSession;
    let streamingCardHandledInterruptedPartial = false;
    if (activeStreamingSession) {
      if (activeStreamingSession.isActive()) {
        syncTerminalPresentationTextToCard(
          activeStreamingSession,
          streamingPresentationText,
          undefined,
        );
        if (hadError || !output || output.status === 'error') {
          streamingCardHandledInterruptedPartial = await activeStreamingSession
            .abort('处理出错')
            .then(() => true)
            .catch(() => false);
        } else if (wasInterrupted) {
          const provisionalUsage = buildProvisionalTokenUsage(
            activeStreamingTurnStartedAt,
          );
          await patchStreamingSessionFooterUsage(
            activeStreamingSession,
            activeRuntimeIdentity,
            provisionalUsage,
          ).catch(() => {});
          streamingCardHandledInterruptedPartial = await activeStreamingSession
            .abort('已中断')
            .then(() => true)
            .catch(() => false);
        } else {
          const provisionalUsage = buildProvisionalTokenUsage(
            activeStreamingTurnStartedAt,
          );
          await patchStreamingSessionFooterUsage(
            activeStreamingSession,
            activeRuntimeIdentity,
            provisionalUsage,
          ).catch(() => {});
          streamingCardHandledInterruptedPartial = await activeStreamingSession
            .abort('未收到最终正文')
            .then(() => true)
            .catch(() => {
              activeStreamingSession.dispose();
              return false;
            });
        }
      }
      unregisterStreamingSession(streamingSessionJid);
    }

    // ── 保存中断内容到数据库 + 广播到 Web ──
    // Skip if the shutdown handler already saved this streaming text (prevents duplicates).
    const webJidForShutdownCheck = chatJid.startsWith('web:')
      ? chatJid
      : `web:${effectiveGroup.folder}`;
    const alreadySavedByShutdown =
      shutdownSavedJids.has(chatJid) ||
      shutdownSavedJids.has(webJidForShutdownCheck);

    if (wasInterrupted && !alreadySavedByShutdown) {
      const provisionalUsage = buildProvisionalTokenUsage(
        activeStreamingTurnStartedAt,
      );
      const interruptedText = buildInterruptedReply(
        streamingPresentationText.answerText,
        streamingAccumulatedThinking,
        streamingPresentationText.commentaryText,
      );
      try {
        lastReplyMsgId = await sendMessage(chatJid, interruptedText, {
          sendToIM: false,
          messageMeta: {
            turnId: activeLastProcessed.id,
            sessionId: activeSessionId,
            sourceKind: 'interrupt_partial',
            finalizationReason: 'interrupted',
            runtimeIdentity: activeRuntimeIdentity,
            tokenUsage: provisionalUsage,
          },
        });
        const replyImJid = resolveInterruptedPartialImJid(
          replySourceImJid ?? (directImReply ? null : chatJid),
        );
        const staticImDeliverySucceeded =
          await sendInterruptedPartialToImIfNeeded({
            replyImJid,
            streamingCardHandledIm: streamingCardHandledInterruptedPartial,
            text: interruptedText,
            groupFolder: effectiveGroup.folder,
            lifecycleMessages: lifecycleMessagesForActiveTurn,
            lifecycleDetails: { deliveryPoint: 'main_finally_interrupted' },
          });
        if (
          !shouldCommitCursorAfterInterruptedPartialDelivery({
            replyImJid,
            streamingCardHandledIm: streamingCardHandledInterruptedPartial,
            staticImDeliverySucceeded,
          })
        ) {
          blockCursorCommit('interrupted_partial_delivery_failed');
        }
        sentReply = true;
        commitCursor();
      } catch (err) {
        logger.warn({ err, chatJid }, 'Failed to save interrupted text');
      }
    }

    // ── 兜底：进程异常退出导致累积文本未持久化 ──
    // 使用 buildInterruptedReply 而非 buildOverflowPartialReply：
    // 进程被杀（SIGTERM/错误）后不会自动继续，"上下文压缩中"提示会误导用户。
    if (
      !sentReply &&
      !alreadySavedByShutdown &&
      (streamingPresentationText.answerText.trim() ||
        streamingPresentationText.commentaryText.trim())
    ) {
      try {
        const provisionalUsage = buildProvisionalTokenUsage(
          activeStreamingTurnStartedAt,
        );
        const partialReply = buildInterruptedReply(
          streamingPresentationText.answerText,
          streamingAccumulatedThinking,
          streamingPresentationText.commentaryText,
        );
        lastReplyMsgId = await sendMessage(chatJid, partialReply, {
          sendToIM: false,
          messageMeta: {
            turnId: activeLastProcessed.id,
            sessionId: activeSessionId,
            sourceKind: 'interrupt_partial',
            finalizationReason: 'error',
            runtimeIdentity: activeRuntimeIdentity,
            tokenUsage: provisionalUsage,
          },
        });
        const replyImJid = resolveInterruptedPartialImJid(
          replySourceImJid ?? (directImReply ? null : chatJid),
        );
        const staticImDeliverySucceeded =
          await sendInterruptedPartialToImIfNeeded({
            replyImJid,
            streamingCardHandledIm: streamingCardHandledInterruptedPartial,
            text: partialReply,
            groupFolder: effectiveGroup.folder,
            lifecycleMessages: lifecycleMessagesForActiveTurn,
            lifecycleDetails: { deliveryPoint: 'main_finally_error' },
          });
        if (
          !shouldCommitCursorAfterInterruptedPartialDelivery({
            replyImJid,
            streamingCardHandledIm: streamingCardHandledInterruptedPartial,
            staticImDeliverySucceeded,
          })
        ) {
          blockCursorCommit('interrupted_partial_delivery_failed');
        }
        sentReply = true;
        commitCursor();
      } catch (err) {
        logger.warn({ err, chatJid }, 'Failed to save overflow partial text');
      }
    }
    if (clearActiveStreamingTurns([activeStreamingTurnKey])) {
      saveState();
    }
  }

  // runAgent threw — output is undefined, cannot proceed with post-processing.
  // If a reply was already sent, commit the cursor so we don't re-process.
  // Otherwise return false to allow retry (H-1 audit fix).
  if (!output) {
    if (sentReply) {
      return commitCursor();
    }
    return false;
  }

  // 不可恢复的转录错误（如超大图片/MIME 错配被固化在会话历史中）：无论是否已有回复，都必须重置会话
  const errorForReset = [lastError, output.error].filter(Boolean).join(' ');
  if (
    (output.status === 'error' || hadError) &&
    errorForReset.includes('unrecoverable_transcript:')
  ) {
    const detail = (lastError || output.error || '').replace(
      /.*unrecoverable_transcript:\s*/,
      '',
    );
    logger.warn(
      { group: group.name, folder: group.folder, error: detail },
      'Unrecoverable transcript error, auto-resetting session',
    );

    // 清除会话文件（保留 settings.json）
    await clearSessionRuntimeFiles(group.folder);

    // 清除当前主会话（保留同 folder 下独立 agent 会话）
    try {
      clearPrimaryRuntimeSession(group.folder);
    } catch (err) {
      logger.error(
        { folder: group.folder, err },
        'Failed to clear session state during auto-reset',
      );
    }

    sendSystemMessage(chatJid, 'context_reset', `会话已自动重置：${detail}`);
    return commitCursor();
  }

  // Container closed during query (e.g. home folder drain) without sending a reply:
  // don't commit cursor so the message gets retried on the next poll cycle.
  // If sentReply is true the cursor was already committed at line 722, no action needed.
  if (output.status === 'closed' && !sentReply) {
    logger.warn(
      { group: group.name, chatJid },
      'Container closed during query without reply, keeping cursor for retry',
    );
    return true;
  }

  // Query 出错时，将残留 running task 标记为 error，避免长期僵尸状态。
  // 正常退出不做强制 completed，避免把未确认完成的任务误判为已完成。
  const isErrorExit = output.status === 'error' || hadError;
  if (isErrorExit) {
    try {
      // 先获取 running agents（广播需要 agent 详情），再批量标记 error
      const runningAgents = getRunningTaskAgentsByChat(chatJid);
      const marked = markRunningTaskAgentsAsError(chatJid);
      if (marked > 0) {
        logger.info(
          { chatJid, marked },
          'Marked remaining running task agents as error',
        );
        for (const agent of runningAgents) {
          broadcastAgentStatus(
            chatJid,
            agent.id,
            'error',
            agent.name,
            agent.prompt,
            '容器超时或异常退出',
            agent.kind,
          );
        }
      }
    } catch (err) {
      logger.warn({ chatJid, err }, 'Failed to mark running task agents');
    }
  } else {
    // Safety net: if query already ended successfully but some task agents are still
    // running (usually due SDK event ID mismatch), force-complete them to avoid stale tabs.
    try {
      let completed = 0;
      for (const taskId of queryTaskIds) {
        const agent = getAgent(taskId);
        if (
          !agent ||
          agent.kind !== 'task' ||
          agent.chat_jid !== chatJid ||
          agent.status !== 'running'
        )
          continue;
        updateAgentStatus(
          taskId,
          'completed',
          agent.result_summary || '任务已完成',
        );
        broadcastAgentStatus(
          chatJid,
          taskId,
          'completed',
          agent.name,
          agent.prompt,
          agent.result_summary || '任务已完成',
          agent.kind,
        );
        completed += 1;
      }
      if (completed > 0) {
        logger.warn(
          { chatJid, completed },
          'Force-completed stale running task agents after successful query',
        );
      }
    } catch (err) {
      logger.warn(
        { chatJid, err },
        'Failed to force-complete stale running task agents',
      );
    }
  }

  if (isErrorExit && !sentReply) {
    // Only roll back cursor if no reply was sent — if the agent already
    // replied successfully, a subsequent timeout is not a real error and
    // rolling back would cause the same messages to be re-processed,
    // leading to duplicate replies.
    const errorDetail = output.error || lastError || '未知错误';

    // 上下文溢出错误：跳过重试，提交游标，通知用户
    if (errorDetail.startsWith('context_overflow:')) {
      const overflowMsg = errorDetail.replace(/^context_overflow:\s*/, '');
      sendSystemMessage(chatJid, 'context_overflow', overflowMsg);
      logger.warn(
        { group: group.name, error: overflowMsg },
        'Context overflow detected, skipping retry',
      );
      return commitCursor();
    }

    // OOM auto-recovery: detect consecutive process exits with code 137.
    // `signal SIGKILL` is ambiguous, so only the explicit exit code increments
    // the recovery counter.
    const isOom = OOM_EXIT_RE.test(errorDetail);
    if (isOom) {
      const folder = effectiveGroup.folder;
      consecutiveOomExits[folder] = (consecutiveOomExits[folder] || 0) + 1;
      setRouterState(
        `oom_exits:${folder}`,
        String(consecutiveOomExits[folder]),
      );
      logger.warn(
        {
          folder,
          consecutive: consecutiveOomExits[folder],
          threshold: OOM_AUTO_RESET_THRESHOLD,
        },
        'OOM exit detected (code 137)',
      );

      if (consecutiveOomExits[folder] >= OOM_AUTO_RESET_THRESHOLD) {
        logger.warn(
          { folder, consecutive: consecutiveOomExits[folder] },
          'Consecutive OOM threshold reached, auto-resetting session to break death loop',
        );
        consecutiveOomExits[folder] = 0;
        deleteRouterState(`oom_exits:${folder}`);

        // Clear session files and DB records (same as unrecoverable_transcript handling)
        try {
          await clearSessionRuntimeFiles(folder);
        } catch (err) {
          logger.error(
            { folder, err },
            'Failed to clear session files during OOM auto-reset',
          );
        }
        try {
          deletePrimaryRuntimeSessions(folder);
          delete sessions[folder];
        } catch (err) {
          logger.error(
            { folder, err },
            'Failed to clear session during OOM auto-reset',
          );
        }

        sendSystemMessage(
          chatJid,
          'context_reset',
          '会话文件过大导致内存溢出（OOM），已自动重置会话。之前的对话上下文已清除，请重新描述您的需求。',
        );
        return commitCursor();
      }
    } else if (consecutiveOomExits[effectiveGroup.folder]) {
      // Non-OOM error: reset the consecutive counter only if it was set
      delete consecutiveOomExits[effectiveGroup.folder];
      deleteRouterState(`oom_exits:${effectiveGroup.folder}`);
    }

    sendSystemMessage(chatJid, 'agent_error', errorDetail);
    logger.warn(
      { group: group.name, error: errorDetail },
      'Agent error (no reply sent), keeping cursor at previous position for retry',
    );
    return false;
  }

  // Reset OOM counter on successful exit (only write DB if counter was set)
  if (consecutiveOomExits[effectiveGroup.folder]) {
    delete consecutiveOomExits[effectiveGroup.folder];
    deleteRouterState(`oom_exits:${effectiveGroup.folder}`);
  }

  // Final fallback for silent-success paths (no visible reply).
  if (!commitCursor()) {
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  turnId?: string,
  messageCursor?: MessageCursor,
  onOutput?: (output: AgentProcessOutput) => Promise<void>,
  images?: Array<{ data: string; mimeType?: string }>,
  activeSourceJid?: string | null,
  options: {
    usePrimarySession?: boolean;
    persistPrimarySession?: boolean;
  } = {},
): Promise<{ status: 'success' | 'error' | 'closed'; error?: string }> {
  const isHome = !!group.is_home;
  const isAdminHome = isHome && group.folder === MAIN_GROUP_FOLDER;
  const usePrimarySession = options.usePrimarySession ?? true;
  const persistPrimarySession = options.persistPrimarySession ?? true;
  const sessionId = usePrimarySession
    ? resolvePrimaryRuntimeSessionId({
        folder: group.folder,
        sessions,
        loadSession: getSession,
      })
    : undefined;

  // Update tasks snapshot for the runner to read (filtered by group).
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isAdminHome,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (admin home only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isAdminHome,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: AgentProcessOutput) => {
        queue.markRunnerActivity(chatJid);
        if (
          (output.status === 'success' && output.result !== null) ||
          (output.status === 'stream' &&
            output.streamEvent?.eventType === 'status' &&
            output.streamEvent.statusText === 'interrupted')
        ) {
          queue.markRunnerQueryIdle(chatJid);
        }
        // 仅从成功的输出中更新 session ID；
        // error 输出可能携带 stale ID，会覆盖流式传递的有效 session
        if (
          persistPrimarySession &&
          output.newSessionId &&
          output.status !== 'error'
        ) {
          rememberPrimaryRuntimeSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  ipcWatcherManager?.watchGroup(group.folder);
  try {
    const agentType = normalizeAgentType(group.agentType);
    const selectedRunner = agentType;
    const effectiveRuntimeIdentity = resolveEffectiveRuntimeIdentity(group, {
      ...getOpenAiRuntimeIdentityOptions(),
    });
    const runtimeBuildLogFields = getRuntimeBuildLogFields();

    logger.info(
      {
        requestedAgentType: agentType,
        effectiveAgentType: agentType,
        selectedRunner,
        chatJid,
        groupFolder: group.folder,
        agentType,
        sessionId: sessionId || null,
        activeSourceJid: activeSourceJid || chatJid,
        isHome,
        isAdminHome,
        ...runtimeBuildLogFields,
      },
      'Dispatching workspace agent run',
    );

    const onProcessCb = (proc: ChildProcess, identifier: string) => {
      queue.registerProcess(
        chatJid,
        proc,
        identifier,
        group.folder,
        identifier,
        undefined,
        undefined,
        activeSourceJid || chatJid,
      );
    };

    const output = await runAgentProcess(
      group,
      {
        prompt,
        sessionId,
        turnId,
        messageCursor,
        groupFolder: group.folder,
        chatJid,
        agentType,
        model: effectiveRuntimeIdentity.model ?? null,
        reasoningEffort: effectiveRuntimeIdentity.reasoningEffort ?? null,
        speedTier: effectiveRuntimeIdentity.speedTier ?? null,
        isHome,
        isAdminHome,
        images,
      },
      onProcessCb,
      wrappedOnOutput,
    );

    // 仅从成功的最终输出中更新 session ID；
    // error 状态的输出可能携带 stale ID，覆盖流式阶段已写入的有效 session
    if (
      persistPrimarySession &&
      output.newSessionId &&
      output.status !== 'error'
    ) {
      rememberPrimaryRuntimeSession(group.folder, output.newSessionId);
    }

    // Agent was interrupted by _close sentinel (home folder drain).
    // Propagate so processGroupMessages can skip cursor commit.
    if (output.status === 'closed') {
      return { status: 'closed' };
    }

    if (output.status === 'error') {
      logger.error({ group: group.name, error: output.error }, 'Agent error');
      if (output.result && wrappedOnOutput && !output.alreadyStreamedError) {
        try {
          await wrappedOnOutput(output);
        } catch (err) {
          logger.error(
            { group: group.name, err },
            'Failed to emit agent error output',
          );
        }
      }
      return { status: 'error', error: output.error };
    }

    return { status: 'success' };
  } catch (err) {
    const errorMsg = serializeErrorForOutput(err);
    logger.error({ group: group.name, err }, 'Agent error');
    return { status: 'error', error: errorMsg };
  } finally {
    ipcWatcherManager?.unwatchGroup(group.folder);
  }
}

async function sendMessage(
  jid: string,
  text: string,
  options: SendMessageOptions = {},
): Promise<string | undefined> {
  const isIMChannel = getChannelType(jid) !== null;
  const sendToIM = options.sendToIM ?? isIMChannel;
  const messageMeta = await enrichOutboundMessageMeta(options.messageMeta);
  let imDeliveryFailed = false;
  try {
    if (sendToIM && isIMChannel) {
      try {
        const localImagePaths =
          options.localImagePaths ??
          extractLocalImImagePaths(text, resolveEffectiveFolder(jid));
        await imManager.sendMessage(jid, text, localImagePaths, messageMeta);
      } catch (err) {
        logger.error({ jid, err }, 'Failed to send message to IM channel');
        imDeliveryFailed = true;
        throw err;
      }
    }

    // Persist assistant reply so Web polling can render it and clear waiting state.
    const msgId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const serializedTokenUsage = serializeAssistantTokenUsage(
      messageMeta?.tokenUsage,
    );
    ensureChatExists(jid);
    const persistedMsgId = storeMessageDirect(
      msgId,
      jid,
      'cli-claw-agent',
      ASSISTANT_NAME,
      text,
      timestamp,
      true,
      {
        tokenUsage: serializedTokenUsage,
        meta: messageMeta,
      },
    );

    broadcastNewMessage(
      jid,
      {
        id: persistedMsgId,
        chat_jid: jid,
        sender: 'cli-claw-agent',
        sender_name: ASSISTANT_NAME,
        content: text,
        timestamp,
        is_from_me: true,
        turn_id: messageMeta?.turnId ?? null,
        session_id: messageMeta?.sessionId ?? null,
        sdk_message_uuid: messageMeta?.sdkMessageUuid ?? null,
        source_kind: messageMeta?.sourceKind ?? null,
        finalization_reason: messageMeta?.finalizationReason ?? null,
        runtime_identity: messageMeta?.runtimeIdentity ?? null,
        token_usage: serializedTokenUsage,
      },
      undefined,
      options.source,
    );
    logger.info({ jid, length: text.length, sendToIM }, 'Message sent');
    // Skip agent_reply broadcast for scheduled tasks to avoid clearing
    // streaming state of a concurrently running main agent.
    // Safe because scheduled tasks never trigger typing indicators, so there's
    // no typing state to clear. The message is still delivered via new_message.
    if (!options.source) {
      broadcastToWebClients(jid, text);
    }
    return persistedMsgId;
  } catch (err) {
    logger.error({ jid, err }, 'Failed to send message');
    if (imDeliveryFailed) {
      throw err;
    }
    return undefined;
  }
}

function decorateTaskReplyText(
  text: string,
  _sourceKind?: MessageSourceKind | null,
  _chatJid?: string,
): string {
  return text;
}

async function enrichOutboundMessageMeta(
  messageMeta?: OutboundMessageMeta,
): Promise<OutboundMessageMeta | undefined> {
  if (!messageMeta) return messageMeta;
  const tokenUsage = await attachRuntimeUsageFooterMeta(
    messageMeta.runtimeIdentity ?? null,
    messageMeta.tokenUsage,
  );
  if (tokenUsage === null && messageMeta.tokenUsage == null) {
    return messageMeta;
  }
  return {
    ...messageMeta,
    tokenUsage,
  };
}

async function enrichTokenUsageWithCurrentRuntimeRemaining(
  runtimeIdentity: OutboundMessageMeta['runtimeIdentity'],
  tokenUsage?: AssistantFooterTokenUsage | string | null,
): Promise<AssistantFooterTokenUsage | null> {
  return attachRuntimeUsageFooterMeta(runtimeIdentity ?? null, tokenUsage);
}

async function patchStreamingSessionFooterUsage(
  session: StreamingCardController | undefined,
  runtimeIdentity: OutboundMessageMeta['runtimeIdentity'],
  tokenUsage?: AssistantFooterTokenUsage | string | null,
): Promise<void> {
  if (!session) return;
  const enrichedUsage = await enrichTokenUsageWithCurrentRuntimeRemaining(
    runtimeIdentity,
    tokenUsage,
  );
  if (!enrichedUsage) return;
  await session.patchUsageNote({
    inputTokens: enrichedUsage.inputTokens ?? 0,
    outputTokens: enrichedUsage.outputTokens ?? 0,
    costUSD: enrichedUsage.costUSD ?? 0,
    durationMs: enrichedUsage.durationMs ?? 0,
    numTurns: enrichedUsage.numTurns ?? 1,
    primaryUsagePct: enrichedUsage.primaryUsagePct ?? undefined,
    secondaryUsagePct: enrichedUsage.secondaryUsagePct ?? undefined,
    primaryRemainingPct: enrichedUsage.primaryRemainingPct ?? undefined,
    secondaryRemainingPct: enrichedUsage.secondaryRemainingPct ?? undefined,
  });
}

async function enrichUsageStreamEventForFooter(
  streamEvent: StreamEvent,
  runtimeIdentity: OutboundMessageMeta['runtimeIdentity'],
  startedAtMs: number,
): Promise<StreamEvent> {
  if (streamEvent.eventType !== 'usage' || !streamEvent.usage) {
    return streamEvent;
  }
  const normalizedStreamEvent = normalizeStreamEventUsageForCard(
    streamEvent,
    startedAtMs,
  );
  const normalizedUsage = normalizedStreamEvent.usage;
  if (!normalizedUsage) return normalizedStreamEvent;
  const enrichedUsage = await enrichTokenUsageWithCurrentRuntimeRemaining(
    runtimeIdentity,
    normalizedUsage,
  );
  if (!enrichedUsage) return normalizedStreamEvent;
  return {
    ...normalizedStreamEvent,
    usage: {
      ...normalizedUsage,
      primaryUsagePct: enrichedUsage.primaryUsagePct ?? undefined,
      secondaryUsagePct: enrichedUsage.secondaryUsagePct ?? undefined,
      primaryRemainingPct: enrichedUsage.primaryRemainingPct ?? undefined,
      secondaryRemainingPct: enrichedUsage.secondaryRemainingPct ?? undefined,
    },
  };
}

export function buildInterruptedReply(
  _partialText?: string,
  _thinkingText?: string,
  _commentaryText?: string,
): string {
  return '*⚠️ 已中断*';
}

export function buildOverflowPartialReply(_partialText?: string): string {
  return '*⚠️ 上下文压缩中，请发送下一条消息继续*';
}

export async function persistInterruptedStreamingReply(
  entry: Pick<
    StreamingRecoveryEntry,
    'replyJid' | 'partialText' | 'commentaryText'
  >,
  finalizationReason: 'shutdown' | 'crash_recovery',
  _deliverMessage: (
    jid: string,
    text: string,
    options?: SendMessageOptions,
  ) => Promise<string | undefined> = sendMessage,
  _deliveryOptions: { sendToIM?: boolean } = {},
): Promise<string | undefined> {
  logger.info(
    { replyJid: entry.replyJid, finalizationReason },
    'Skipping partial reply body persistence',
  );
  return undefined;
}

/**
 * Drop in-progress streaming responses before shutdown.
 * Interrupted partial bodies are not final answers, so they must not be
 * persisted, sent to IM, or used to advance committed recovery cursors.
 */
async function saveInterruptedStreamingMessages(): Promise<void> {
  try {
    const recoveryEntries = buildStreamingRecoveryEntries(
      activeStreamingTurns,
      getActiveStreamingTexts(),
    );
    if (recoveryEntries.length === 0) return;
    let stateChanged = false;

    logger.info(
      { count: recoveryEntries.length },
      'Discarding interrupted streaming messages before shutdown',
    );

    for (const entry of recoveryEntries) {
      const replyRouteJid = stripVirtualJidSuffix(entry.replyJid);
      const suppressImDuringSelfRestart =
        getChannelType(replyRouteJid) !== null &&
        hasPendingSelfRestartForChat({
          pid: process.pid,
          requestChatJid: replyRouteJid,
        });
      if (suppressImDuringSelfRestart) {
        logger.info(
          { replyJid: entry.replyJid, streamingKey: entry.streamingKey },
          'Suppressing shutdown partial IM delivery during self-restart',
        );
      }
      await persistInterruptedStreamingReply(entry, 'shutdown', sendMessage, {
        sendToIM: false,
      });
      // Mark as saved so the per-group finally blocks don't duplicate
      shutdownSavedJids.add(entry.streamingKey);
      shutdownSavedJids.add(entry.snapshotJid);
      shutdownSavedJids.add(entry.replyJid);
      const nextCommitted = applyShutdownInterruptedStreamingCommittedCursor(
        lastCommittedCursor,
        entry,
        { imDeliverySuppressed: suppressImDuringSelfRestart },
      );
      if (nextCommitted !== lastCommittedCursor) {
        lastCommittedCursor = nextCommitted;
        stateChanged = true;
      }
    }
    if (
      clearActiveStreamingTurns(
        recoveryEntries.map((entry) => entry.streamingKey),
      )
    ) {
      stateChanged = true;
    }
    if (stateChanged) {
      saveState();
    }
  } catch (err) {
    logger.warn({ err }, 'Error saving interrupted streaming messages');
  }

  // Clean up buffer files because interrupted partials are discarded.
  cleanStreamingBufferDir();
}

// ─── Periodic Streaming Buffer ──────────────────────────────────────
// Writes in-progress streaming text to disk every 5s so that even SIGKILL
// crashes preserve most of the partial response.

const STREAMING_BUFFER_DIR = path.join(DATA_DIR, 'streaming-buffer');
const STREAMING_BUFFER_INTERVAL_MS = 5000;
let streamingBufferInterval: ReturnType<typeof setInterval> | null = null;
interface StreamingBufferPayload {
  text: string;
  commentaryText?: string;
  streamingKey?: string;
  snapshotJid?: string;
  commitJid?: string;
  replyJid?: string;
  cursor?: MessageCursor;
  turnId?: string;
  messageCursorId?: string;
}

export function encodeJidForFilename(jid: string): string {
  return Buffer.from(jid).toString('base64url');
}

export function decodeJidFromFilename(filename: string): string {
  const name = filename.endsWith('.json')
    ? filename.slice(0, -5)
    : filename.endsWith('.txt')
      ? filename.slice(0, -4)
      : filename;
  return Buffer.from(name, 'base64url').toString();
}

/** Write all active streaming texts to disk (atomic write per file). */
function flushStreamingBuffer(): void {
  try {
    const recoveryEntries = buildStreamingRecoveryEntries(
      activeStreamingTurns,
      getActiveStreamingTexts(),
    );
    if (recoveryEntries.length === 0) {
      // Nothing streaming — clean up any stale files
      cleanStreamingBufferDir();
      return;
    }

    fs.mkdirSync(STREAMING_BUFFER_DIR, { recursive: true });

    const activeFiles = new Set<string>();
    for (const entry of recoveryEntries) {
      const filename = encodeJidForFilename(entry.snapshotJid) + '.json';
      activeFiles.add(filename);
      const filePath = path.join(STREAMING_BUFFER_DIR, filename);
      const tmpPath = filePath + '.tmp';
      const payload: StreamingBufferPayload = {
        text: entry.partialText,
        commentaryText: entry.commentaryText,
        streamingKey: entry.streamingKey,
        snapshotJid: entry.snapshotJid,
        commitJid: entry.commitJid,
        replyJid: entry.replyJid,
        cursor: entry.cursor,
        turnId: entry.turnId,
        messageCursorId: entry.messageCursorId,
      };
      fs.writeFileSync(tmpPath, JSON.stringify(payload));
      fs.renameSync(tmpPath, filePath);
    }

    // Remove files for JIDs that are no longer streaming
    try {
      for (const f of fs.readdirSync(STREAMING_BUFFER_DIR)) {
        if (
          (f.endsWith('.json') || f.endsWith('.txt')) &&
          !activeFiles.has(f)
        ) {
          fs.unlinkSync(path.join(STREAMING_BUFFER_DIR, f));
        }
      }
    } catch {
      /* ignore cleanup errors */
    }
  } catch (err) {
    logger.debug({ err }, 'Error flushing streaming buffer');
  }
}

/** On startup, recover interrupted responses from buffer files left by a crash. */
function recoverStreamingBuffer(): void {
  try {
    const recoveryEntries = new Map<string, StreamingRecoveryEntry>();
    const recoveryEntriesBySnapshotJid = new Map<
      string,
      StreamingRecoveryEntry
    >();
    for (const [streamingKey, state] of Object.entries(activeStreamingTurns)) {
      const entry: StreamingRecoveryEntry = {
        streamingKey,
        commitJid: state.commitJid,
        replyJid: state.replyJid,
        snapshotJid: state.snapshotJid,
        cursor: state.cursor,
        partialText: '',
        commentaryText: '',
      };
      recoveryEntries.set(streamingKey, entry);
      recoveryEntriesBySnapshotJid.set(state.snapshotJid, entry);
    }

    const bufferFiles = fs.existsSync(STREAMING_BUFFER_DIR)
      ? fs
          .readdirSync(STREAMING_BUFFER_DIR)
          .filter((file) => file.endsWith('.json') || file.endsWith('.txt'))
      : [];

    for (const filename of bufferFiles) {
      const decodedKey = decodeJidFromFilename(filename);
      const filePath = path.join(STREAMING_BUFFER_DIR, filename);
      try {
        const payload: StreamingBufferPayload = filename.endsWith('.json')
          ? (JSON.parse(
              fs.readFileSync(filePath, 'utf-8'),
            ) as StreamingBufferPayload)
          : { text: fs.readFileSync(filePath, 'utf-8') };
        const snapshotJid =
          typeof payload.snapshotJid === 'string' && payload.snapshotJid
            ? payload.snapshotJid
            : decodedKey;
        const streamingKey =
          typeof payload.streamingKey === 'string' && payload.streamingKey
            ? payload.streamingKey
            : decodedKey;
        const partialText =
          typeof payload.text === 'string' ? payload.text.trim() : '';
        const commentaryText =
          typeof payload.commentaryText === 'string'
            ? payload.commentaryText.trim()
            : '';
        const existing =
          recoveryEntriesBySnapshotJid.get(snapshotJid) ||
          recoveryEntries.get(streamingKey) ||
          recoveryEntries.get(decodedKey);
        if (existing) {
          existing.partialText = partialText;
          existing.commentaryText = commentaryText;
          continue;
        }
        if (typeof payload.commitJid === 'string' && payload.commitJid) {
          const entry: StreamingRecoveryEntry = {
            streamingKey,
            commitJid: payload.commitJid,
            replyJid:
              typeof payload.replyJid === 'string' && payload.replyJid
                ? payload.replyJid
                : payload.commitJid,
            snapshotJid,
            cursor: normalizeCursor(payload.cursor),
            partialText,
            commentaryText,
            ...(typeof payload.turnId === 'string' && payload.turnId
              ? { turnId: payload.turnId }
              : {}),
            ...(typeof payload.messageCursorId === 'string' &&
            payload.messageCursorId
              ? { messageCursorId: payload.messageCursorId }
              : {}),
          };
          recoveryEntries.set(streamingKey, entry);
          recoveryEntriesBySnapshotJid.set(snapshotJid, entry);
          continue;
        }
        if (partialText) {
          logger.warn(
            { streamingKey, snapshotJid, filename },
            'Recovered orphaned streaming buffer text without commit cursor',
          );
        }
      } catch (err) {
        logger.warn(
          { err, filename },
          'Error reading streaming buffer payload',
        );
      }
    }

    if (recoveryEntries.size === 0) {
      if (bufferFiles.length > 0) {
        cleanStreamingBufferDir();
      }
      return;
    }

    logger.info(
      { count: recoveryEntries.size },
      'Discarding interrupted streaming buffer state',
    );

    let stateChanged = false;
    for (const entry of recoveryEntries.values()) {
      try {
        logger.info(
          {
            streamingKey: entry.streamingKey,
            replyJid: entry.replyJid,
            textLen: entry.partialText.length + entry.commentaryText.length,
          },
          'Discarded interrupted streaming buffer entry',
        );
      } catch (err) {
        logger.warn(
          { err, entry },
          'Error discarding interrupted streaming turn',
        );
      }
    }
    if (
      clearActiveStreamingTurns(
        [...recoveryEntries.values()].map((entry) => entry.streamingKey),
      )
    ) {
      stateChanged = true;
    }
    if (stateChanged) {
      saveState();
    }
    cleanStreamingBufferDir();
  } catch (err) {
    logger.warn({ err }, 'Error recovering streaming buffer');
  }
}

export function recoverStreamingBufferForTests(): void {
  recoverStreamingBuffer();
}

/** Remove all buffer files. */
function cleanStreamingBufferDir(): void {
  try {
    if (!fs.existsSync(STREAMING_BUFFER_DIR)) return;
    for (const f of fs.readdirSync(STREAMING_BUFFER_DIR)) {
      try {
        fs.unlinkSync(path.join(STREAMING_BUFFER_DIR, f));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function startStreamingBuffer(): void {
  streamingBufferInterval = setInterval(
    flushStreamingBuffer,
    STREAMING_BUFFER_INTERVAL_MS,
  );
}

function stopStreamingBuffer(): void {
  if (streamingBufferInterval) {
    clearInterval(streamingBufferInterval);
    streamingBufferInterval = null;
  }
}

/**
 * Check if a source group is authorized to send IPC messages to a target group.
 * - Admin home can send to any group.
 * - Non-home groups can only send to groups sharing the same folder.
 * - Member home groups can send to groups created by the same user.
 */
export function canSendCrossGroupMessage(
  isAdminHome: boolean,
  isHome: boolean,
  sourceFolder: string,
  sourceGroupEntry: RegisteredGroup | undefined,
  targetGroup: RegisteredGroup | undefined,
): boolean {
  if (isAdminHome) return true;
  if (targetGroup && targetGroup.folder === sourceFolder) return true;
  if (
    isHome &&
    targetGroup &&
    sourceGroupEntry?.created_by != null &&
    targetGroup.created_by === sourceGroupEntry.created_by
  )
    return true;
  return false;
}

function startIpcWatcher(): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const fsp = fs.promises;

  /**
   * Broadcast a message to all connected IM channels of a user that haven't
   * already received it. Used by scheduled tasks to fan out to all IM channels.
   */
  function broadcastToOwnerIMChannels(
    userId: string,
    sourceFolder: string,
    alreadySentJids: Set<string>,
    sendFn: (jid: string) => void,
    notifyChannels?: string[] | null,
  ): void {
    const sentChannelTypes = new Set<string>();
    for (const jid of alreadySentJids) {
      const ct = getChannelType(jid);
      if (ct) sentChannelTypes.add(ct);
    }
    const connectedTypes = imManager.getConnectedChannelTypes(userId);
    const ownerGroups = getGroupsByOwner(userId);
    for (const channelType of connectedTypes) {
      if (sentChannelTypes.has(channelType)) continue;
      // Filter by notify_channels if specified (null = all channels)
      if (notifyChannels && !notifyChannels.includes(channelType)) continue;
      const target = ownerGroups.find(
        (g) =>
          getChannelType(g.jid) === channelType && g.folder === sourceFolder,
      );
      if (target) {
        sendFn(target.jid);
        sentChannelTypes.add(channelType);
      }
    }
  }

  const processGroupIpc = async (sourceGroup: string) => {
    if (shuttingDown) return;
    // Determine if this IPC directory belongs to an admin home group
    const sourceGroupEntry = Object.values(registeredGroups).find(
      (g) => g.folder === sourceGroup,
    );
    const isAdminHome = !!(
      sourceGroupEntry?.is_home && sourceGroup === MAIN_GROUP_FOLDER
    );
    const isHome = !!sourceGroupEntry?.is_home;

    // Collect all IPC roots: main group dir + agents/*/ + tasks-run/*/
    // Tag agent roots with their agentId so we can route messages to virtual JIDs.
    const groupIpcRoot = path.join(ipcBaseDir, sourceGroup);
    const ipcRoots: Array<{
      path: string;
      agentId: string | null;
      taskId: string | null;
    }> = [{ path: groupIpcRoot, agentId: null, taskId: null }];
    try {
      const agentsDir = path.join(groupIpcRoot, 'agents');
      const agentEntries = await fsp.readdir(agentsDir, {
        withFileTypes: true,
      });
      for (const entry of agentEntries) {
        if (entry.isDirectory()) {
          ipcRoots.push({
            path: path.join(agentsDir, entry.name),
            agentId: entry.name,
            taskId: null,
          });
        }
      }
    } catch {
      /* agents dir may not exist */
    }
    try {
      const tasksRunDir = path.join(groupIpcRoot, 'tasks-run');
      const taskRunEntries = await fsp.readdir(tasksRunDir, {
        withFileTypes: true,
      });
      for (const entry of taskRunEntries) {
        if (entry.isDirectory()) {
          ipcRoots.push({
            path: path.join(tasksRunDir, entry.name),
            agentId: null,
            taskId: entry.name,
          });
        }
      }
    } catch {
      /* tasks-run dir may not exist */
    }

    // Pre-resolve owner's home folder once per group (avoid repeated DB queries in the message loop)
    const ownerHomeFolderForIm = sourceGroupEntry?.created_by
      ? getUserHomeGroup(sourceGroupEntry.created_by)?.folder || sourceGroup
      : sourceGroup;

    for (const {
      path: ipcRoot,
      agentId: ipcAgentId,
      taskId: ipcTaskId,
    } of ipcRoots) {
      const messagesDir = path.join(ipcRoot, 'messages');
      const tasksDir = path.join(ipcRoot, 'tasks');

      // Process messages from this group's IPC directory
      try {
        const messageEntries = await fsp.readdir(messagesDir);
        const messageFiles = messageEntries.filter((f) => f.endsWith('.json'));
        for (const file of messageFiles) {
          const filePath = path.join(messagesDir, file);
          try {
            const raw = await fsp.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            if (data.type === 'message' && data.chatJid && data.text) {
              const targetGroup = registeredGroups[data.chatJid];
              if (
                canSendCrossGroupMessage(
                  isAdminHome,
                  isHome,
                  sourceGroup,
                  sourceGroupEntry,
                  targetGroup,
                )
              ) {
                // Conversation agents: route to virtual JID so message appears
                // in the agent tab, not the main conversation.
                const effectiveChatJid = ipcAgentId
                  ? `${data.chatJid}#agent:${ipcAgentId}`
                  : data.chatJid;
                const rawIpcText = String(data.text);
                const visibleIpcText = resolveVisibleReplyParts(
                  rawIpcText,
                  undefined,
                  {
                    agentType:
                      targetGroup?.agentType ??
                      sourceGroupEntry?.agentType ??
                      null,
                  },
                ).visibleText;
                // Feishu card JSON: store extracted markdown for web, send raw JSON to IM
                const cardText = extractFeishuCardText(visibleIpcText);
                const webText = cardText || visibleIpcText;
                await sendMessage(effectiveChatJid, webText, {
                  messageMeta: {
                    sourceKind: 'sdk_send_message',
                  },
                });

                // Forward to IM channel — but NOT for conversation agent messages.
                // Conversation agents handle their own IM routing in
                // processAgentConversation's wrappedOnOutput callback.
                if (!ipcAgentId) {
                  const ipcImRoute = activeImReplyRoutes.get(sourceGroup);
                  if (
                    ipcImRoute &&
                    getChannelType(data.chatJid) === null &&
                    ipcImRoute !== data.chatJid
                  ) {
                    const localImages = extractLocalImImagePaths(
                      visibleIpcText,
                      sourceGroup,
                    );
                    sendImWithFailTracking(
                      ipcImRoute,
                      visibleIpcText,
                      localImages,
                    );
                  }

                  // Scheduled task: broadcast to all connected IM channels of the owner
                  if (data.isScheduledTask && sourceGroupEntry?.created_by) {
                    const alreadySent = new Set<string>(
                      [data.chatJid, ipcImRoute].filter(Boolean) as string[],
                    );
                    const taskLocalImages = extractLocalImImagePaths(
                      visibleIpcText,
                      sourceGroup,
                    );
                    // Resolve notify_channels from the task
                    let taskNotifyChannels: string[] | null | undefined;
                    if (ipcTaskId) {
                      const taskRecord = getTaskById(ipcTaskId);
                      taskNotifyChannels = taskRecord?.notify_channels;
                    }
                    broadcastToOwnerIMChannels(
                      sourceGroupEntry.created_by,
                      ownerHomeFolderForIm,
                      alreadySent,
                      (jid) =>
                        sendImWithFailTracking(
                          jid,
                          visibleIpcText,
                          taskLocalImages,
                        ),
                      taskNotifyChannels,
                    );
                  }
                }
                logger.info(
                  {
                    chatJid: effectiveChatJid,
                    sourceGroup,
                    agentId: ipcAgentId,
                  },
                  'IPC message sent',
                );
              } else {
                logger.warn(
                  { chatJid: data.chatJid, sourceGroup },
                  'Unauthorized IPC message attempt blocked',
                );
              }
            } else if (
              data.type === 'image' &&
              data.chatJid &&
              data.imageBase64
            ) {
              // Handle image IPC messages from send_image MCP tool
              const targetGroup = registeredGroups[data.chatJid];
              if (
                canSendCrossGroupMessage(
                  isAdminHome,
                  isHome,
                  sourceGroup,
                  sourceGroupEntry,
                  targetGroup,
                )
              ) {
                try {
                  const imageBuffer = Buffer.from(data.imageBase64, 'base64');
                  const mimeType = data.mimeType || 'image/png';
                  const caption = data.caption || undefined;
                  const fileName = data.fileName || undefined;

                  // For conversation agents, use activeImReplyRoutes (the IM
                  // channel this conversation agent is bound to — e.g. DingTalk JID).
                  const imgImRoute = ipcAgentId
                    ? (activeImReplyRoutes.get(sourceGroup) ?? null)
                    : getChannelType(data.chatJid) !== null
                      ? data.chatJid
                      : (activeImReplyRoutes.get(sourceGroup) ?? null);
                  if (imgImRoute) {
                    const sent = await retryImOperation(
                      'send_image',
                      imgImRoute,
                      () =>
                        imManager.sendImage(
                          imgImRoute,
                          imageBuffer,
                          mimeType,
                          caption,
                          fileName,
                        ),
                    );
                    recordDirectImDeliveryLifecycleForMessages({
                      messages:
                        activeImLifecycleMessages.get(sourceGroup) ?? [],
                      delivery: 'direct_image',
                      targetJid: imgImRoute,
                      sent,
                      details: {
                        fileName,
                        mimeType,
                        size: imageBuffer.length,
                      },
                    });
                    if (!sent) {
                      const failMsg = `⚠️ 图片 "${fileName || caption || 'image'}" 发送失败（IM 通道发送失败），请稍后重试。`;
                      broadcastToWebClients(sourceGroup, failMsg);
                    }
                  } else {
                    recordDirectImDeliveryLifecycleForMessages({
                      messages:
                        activeImLifecycleMessages.get(sourceGroup) ?? [],
                      delivery: 'direct_image',
                      targetJid: null,
                      sent: null,
                      reason: 'no_im_route',
                      details: {
                        fileName,
                        mimeType,
                        size: imageBuffer.length,
                      },
                    });
                    logger.debug(
                      { chatJid: data.chatJid, sourceGroup },
                      'No IM route for send_image, skipped IM delivery',
                    );
                    const skipImgMsg = `⚠️ 图片 "${fileName || 'image'}" 未发送到 IM 通道（当前会话无 IM 路由绑定）。`;
                    broadcastToWebClients(
                      data.chatJid ?? sourceGroup,
                      skipImgMsg,
                    );
                  }

                  // Conversation agents: store in virtual JID (agent tab).
                  const imgChatJid = ipcAgentId
                    ? `${data.chatJid}#agent:${ipcAgentId}`
                    : data.chatJid;

                  // Persist image message to DB and broadcast to WebSocket (same as sendMessage flow)
                  const displayText = caption
                    ? `[图片: ${fileName || 'image'}]\n${caption}`
                    : `[图片: ${fileName || 'image'}]`;
                  const imgMsgId = crypto.randomUUID();
                  const imgTimestamp = new Date().toISOString();
                  ensureChatExists(imgChatJid);
                  const persistedImgMsgId = storeMessageDirect(
                    imgMsgId,
                    imgChatJid,
                    'cli-claw-agent',
                    ASSISTANT_NAME,
                    displayText,
                    imgTimestamp,
                    true,
                    { meta: { sourceKind: 'sdk_send_message' } },
                  );
                  broadcastNewMessage(imgChatJid, {
                    id: persistedImgMsgId,
                    chat_jid: imgChatJid,
                    sender: 'cli-claw-agent',
                    sender_name: ASSISTANT_NAME,
                    content: displayText,
                    timestamp: imgTimestamp,
                    is_from_me: true,
                    turn_id: null,
                    session_id: null,
                    sdk_message_uuid: null,
                    source_kind: 'sdk_send_message',
                    finalization_reason: null,
                  });
                  broadcastToWebClients(imgChatJid, displayText);

                  // Scheduled task: broadcast image to all connected IM channels
                  // (not applicable for agent IPC)
                  if (
                    !ipcAgentId &&
                    data.isScheduledTask &&
                    sourceGroupEntry?.created_by
                  ) {
                    const alreadySent = new Set<string>(
                      [data.chatJid, imgImRoute].filter(Boolean) as string[],
                    );
                    let imgTaskNotifyChannels: string[] | null | undefined;
                    if (ipcTaskId) {
                      const imgTaskRecord = getTaskById(ipcTaskId);
                      imgTaskNotifyChannels = imgTaskRecord?.notify_channels;
                    }
                    broadcastToOwnerIMChannels(
                      sourceGroupEntry.created_by,
                      ownerHomeFolderForIm,
                      alreadySent,
                      (jid) =>
                        imManager
                          .sendImage(
                            jid,
                            imageBuffer,
                            mimeType,
                            caption,
                            fileName,
                          )
                          .catch((err) =>
                            logger.warn(
                              { jid, err },
                              'Failed to broadcast task image to IM',
                            ),
                          ),
                      imgTaskNotifyChannels,
                    );
                  }

                  logger.info(
                    {
                      chatJid: imgChatJid,
                      sourceGroup,
                      mimeType,
                      size: imageBuffer.length,
                      agentId: ipcAgentId,
                    },
                    'IPC image sent',
                  );
                } catch (err) {
                  logger.error(
                    { chatJid: data.chatJid, sourceGroup, err },
                    'Failed to process IPC image',
                  );
                }
              } else {
                logger.warn(
                  { chatJid: data.chatJid, sourceGroup },
                  'Unauthorized IPC image attempt blocked',
                );
              }
            }
            await fsp.unlink(filePath);
          } catch (err) {
            logger.error(
              { file, sourceGroup, err },
              'Error processing IPC message',
            );
            const errorDir = path.join(ipcBaseDir, 'errors');
            await fsp.mkdir(errorDir, { recursive: true });
            try {
              await fsp.rename(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            } catch (renameErr) {
              logger.error(
                { file, sourceGroup, renameErr },
                'Failed to move IPC message to error directory, deleting',
              );
              try {
                await fsp.unlink(filePath);
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          logger.error(
            { err, sourceGroup },
            'Error reading IPC messages directory',
          );
        }
      }

      // Process tasks from this group's IPC directory
      try {
        const allEntries = await fsp.readdir(tasksDir, {
          withFileTypes: true,
        });

        // 清理孤儿结果文件（容器崩溃或超时后残留，超过 10 分钟自动删除）
        for (const entry of allEntries) {
          if (
            entry.isFile() &&
            entry.name.endsWith('.json') &&
            (entry.name.startsWith('install_skill_result_') ||
              entry.name.startsWith('uninstall_skill_result_') ||
              entry.name.startsWith('list_tasks_result_'))
          ) {
            try {
              const filePath = path.join(tasksDir, entry.name);
              const stat = await fsp.stat(filePath);
              if (Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
                await fsp.unlink(filePath);
                logger.debug(
                  { sourceGroup, file: entry.name },
                  'Cleaned up stale skill result file',
                );
              }
            } catch {
              /* ignore */
            }
          }
        }

        const taskFiles = allEntries
          .filter(
            (entry) =>
              entry.isFile() &&
              entry.name.endsWith('.json') &&
              !entry.name.startsWith('install_skill_result_') &&
              !entry.name.startsWith('uninstall_skill_result_') &&
              !entry.name.startsWith('list_tasks_result_'),
          )
          .map((entry) => entry.name);
        for (const file of taskFiles) {
          const filePath = path.join(tasksDir, file);
          try {
            const raw = await fsp.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            // Pass source group identity to processTaskIpc for authorization
            await processTaskIpc(
              data,
              sourceGroup,
              isAdminHome,
              isHome,
              sourceGroupEntry,
              ipcAgentId,
            );
            await fsp.unlink(filePath);
          } catch (err) {
            logger.error(
              { file, sourceGroup, err },
              'Error processing IPC task',
            );
            const errorDir = path.join(ipcBaseDir, 'errors');
            await fsp.mkdir(errorDir, { recursive: true });
            try {
              await fsp.rename(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            } catch (renameErr) {
              logger.error(
                { file, sourceGroup, renameErr },
                'Failed to move IPC task to error directory, deleting',
              );
              try {
                await fsp.unlink(filePath);
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          logger.error(
            { err, sourceGroup },
            'Error reading IPC tasks directory',
          );
        }
      }
    } // end for (const ipcRoot of ipcRoots)
  };

  const processIpcFilesFull = async () => {
    if (shuttingDown) return;
    let groupFolders: string[];
    try {
      const entries = await fsp.readdir(ipcBaseDir, { withFileTypes: true });
      groupFolders = entries
        .filter((e) => e.isDirectory() && e.name !== 'errors')
        .map((e) => e.name);
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      return;
    }

    for (const sourceGroup of groupFolders) {
      // Route through the concurrency guard to prevent racing with event-driven triggers
      ipcWatcherManager!.triggerProcess(sourceGroup);
    }
  };

  // Initialize the event-driven IPC watcher manager
  ipcWatcherManager = new IpcWatcherManager();
  ipcWatcherManager.bind(processGroupIpc, processIpcFilesFull);

  // Initial full scan
  processIpcFilesFull().catch((err) => {
    logger.error({ err }, 'Error in initial IPC scan');
  });

  // Start fallback polling (5s instead of 1s)
  ipcWatcherManager.startFallback();

  logger.info('IPC watcher started (event-driven + 5s fallback)');
}

async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    execution_type?: string;
    script_command?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    // For install_skill / uninstall_skill
    package?: string;
    requestId?: string;
    skillId?: string;
    // For send_file
    filePath?: string;
    fileName?: string;
    // For list_tasks
    isAdminHome?: boolean;
  },
  sourceGroup: string, // Verified identity from IPC directory
  isAdminHome: boolean, // Whether source is the admin home workspace
  isHome: boolean, // Whether source is a home workspace
  sourceGroupEntry: RegisteredGroup | undefined, // Source group's registered entry
  ipcAgentId: string | null = null, // Non-null when IPC comes from a conversation agent
): Promise<void> {
  switch (data.type) {
    case 'schedule_task':
      if (data.schedule_type && data.schedule_value && data.targetJid) {
        const execType =
          data.execution_type === 'script'
            ? ('script' as const)
            : ('agent' as const);

        // Script tasks require prompt OR script_command; agent tasks require prompt
        if (execType === 'agent' && !data.prompt) {
          logger.warn('schedule_task: agent mode requires prompt');
          break;
        }
        if (execType === 'script' && !data.script_command) {
          logger.warn('schedule_task: script mode requires script_command');
          break;
        }

        // Only admin home can create script tasks
        if (execType === 'script' && !isAdminHome) {
          logger.warn(
            { sourceGroup },
            'Non-admin workspace attempted to create script task',
          );
          break;
        }

        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-admin-home groups can only schedule for themselves
        if (!isAdminHome && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = Number(data.schedule_value);
          if (!Number.isFinite(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = crypto.randomUUID();
        const taskCreatedBy = resolveTaskOwner(
          {},
          sourceGroupEntry,
          targetGroupEntry,
        );

        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt || '',
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: 'isolated',
          execution_type: execType,
          script_command: data.script_command ?? null,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
          created_by: taskCreatedBy,
          notify_channels: null,
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, execType },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isAdminHome || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isAdminHome || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isAdminHome || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'list_tasks':
      if (data.requestId) {
        const requestId = data.requestId;
        if (!SAFE_REQUEST_ID_RE.test(requestId)) {
          logger.warn(
            { sourceGroup, requestId },
            'Rejected list_tasks request with invalid requestId',
          );
          break;
        }
        const listTasksDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'tasks');
        const listTasksDirResolved = path.resolve(listTasksDir);
        const resultFileName = `list_tasks_result_${requestId}.json`;
        const resultFilePath = path.resolve(listTasksDir, resultFileName);
        if (!resultFilePath.startsWith(`${listTasksDirResolved}${path.sep}`)) {
          logger.warn(
            { sourceGroup, requestId, resultFilePath },
            'Rejected list_tasks request with unsafe result file path',
          );
          break;
        }

        fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
        try {
          const allTasks = getAllTasks();
          // Admin home sees all tasks, others only see their own group's tasks
          const filteredTasks = isAdminHome
            ? allTasks
            : allTasks.filter((t) => t.group_folder === sourceGroup);
          const taskList = filteredTasks.map((t) => ({
            id: t.id,
            groupFolder: t.group_folder,
            prompt: t.prompt,
            schedule_type: t.schedule_type,
            schedule_value: t.schedule_value,
            status: t.status,
            next_run: t.next_run,
          }));
          const resultData = JSON.stringify({ success: true, tasks: taskList });
          const tmpPath = `${resultFilePath}.tmp`;
          fs.writeFileSync(tmpPath, resultData);
          fs.renameSync(tmpPath, resultFilePath);
          logger.debug(
            { sourceGroup, taskCount: taskList.length },
            'Task list sent via IPC',
          );
        } catch (err) {
          const errorResult = JSON.stringify({
            success: false,
            error: serializeErrorForOutput(err),
          });
          const tmpPath = `${resultFilePath}.tmp`;
          fs.writeFileSync(tmpPath, errorResult);
          fs.renameSync(tmpPath, resultFilePath);
          logger.error({ sourceGroup, err }, 'Failed to list tasks via IPC');
        }
      }
      break;

    case 'refresh_groups':
      // Only admin home group can request a refresh
      if (isAdminHome) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await syncGroupMetadata(true);
        // Write updated snapshot immediately
        const availableGroups = getAvailableGroups();
        writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only admin home group can register new groups
      if (!isAdminHome) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder) {
        // Inherit created_by from the source group so onNewChat won't re-route
        const sourceEntry = Object.values(registeredGroups).find(
          (g) => g.folder === sourceGroup,
        );
        registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          added_at: new Date().toISOString(),
          created_by: sourceEntry?.created_by,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'install_skill':
      if (data.package && data.requestId) {
        const pkg = data.package;
        const requestId = data.requestId;
        if (!SAFE_REQUEST_ID_RE.test(requestId)) {
          logger.warn(
            { sourceGroup, requestId },
            'Rejected install_skill request with invalid requestId',
          );
          break;
        }
        const tasksDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'tasks');
        const tasksDirResolved = path.resolve(tasksDir);
        const resultFileName = `install_skill_result_${requestId}.json`;
        const resultFilePath = path.resolve(tasksDir, resultFileName);
        if (!resultFilePath.startsWith(`${tasksDirResolved}${path.sep}`)) {
          logger.warn(
            { sourceGroup, requestId, resultFilePath },
            'Rejected install_skill request with unsafe result file path',
          );
          break;
        }

        // Find the user who owns this group
        const sourceGroupForSkill = Object.values(registeredGroups).find(
          (g) => g.folder === sourceGroup,
        );
        const userId = sourceGroupForSkill?.created_by;

        if (!userId) {
          logger.warn(
            { sourceGroup },
            'Cannot install skill: no user associated with group',
          );
          const errorResult = JSON.stringify({
            success: false,
            error: 'No user associated with this group',
          });
          const tmpPath = `${resultFilePath}.tmp`;
          fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
          fs.writeFileSync(tmpPath, errorResult);
          fs.renameSync(tmpPath, resultFilePath);
          break;
        }

        try {
          const result = await installSkillForUser(userId, pkg);
          const tmpPath = `${resultFilePath}.tmp`;
          fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
          fs.writeFileSync(tmpPath, JSON.stringify(result));
          fs.renameSync(tmpPath, resultFilePath);
          logger.info(
            { sourceGroup, userId, pkg, success: result.success },
            'Skill installation via IPC completed',
          );
        } catch (err) {
          const errorResult = JSON.stringify({
            success: false,
            error: serializeErrorForOutput(err),
          });
          const tmpPath = `${resultFilePath}.tmp`;
          fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
          fs.writeFileSync(tmpPath, errorResult);
          fs.renameSync(tmpPath, resultFilePath);
          logger.error(
            { sourceGroup, userId, pkg, err },
            'Skill installation via IPC failed',
          );
        }
      } else {
        logger.warn(
          { data },
          'Invalid install_skill request - missing required fields',
        );
      }
      break;

    case 'uninstall_skill':
      if (data.skillId && data.requestId) {
        const skillId = data.skillId;
        const requestId = data.requestId;
        if (!SAFE_REQUEST_ID_RE.test(requestId)) {
          logger.warn(
            { sourceGroup, requestId },
            'Rejected uninstall_skill request with invalid requestId',
          );
          break;
        }
        const tasksDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'tasks');
        const tasksDirResolved = path.resolve(tasksDir);
        const resultFileName = `uninstall_skill_result_${requestId}.json`;
        const resultFilePath = path.resolve(tasksDir, resultFileName);
        if (!resultFilePath.startsWith(`${tasksDirResolved}${path.sep}`)) {
          logger.warn(
            { sourceGroup, requestId, resultFilePath },
            'Rejected uninstall_skill request with unsafe result file path',
          );
          break;
        }

        const sourceGroupForUninstall = Object.values(registeredGroups).find(
          (g) => g.folder === sourceGroup,
        );
        const userId = sourceGroupForUninstall?.created_by;

        if (!userId) {
          logger.warn(
            { sourceGroup },
            'Cannot uninstall skill: no user associated with group',
          );
          const errorResult = JSON.stringify({
            success: false,
            error: 'No user associated with this group',
          });
          const tmpPath = `${resultFilePath}.tmp`;
          fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
          fs.writeFileSync(tmpPath, errorResult);
          fs.renameSync(tmpPath, resultFilePath);
          break;
        }

        const result = deleteSkillForUser(userId, skillId);
        const tmpPath = `${resultFilePath}.tmp`;
        fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(result));
        fs.renameSync(tmpPath, resultFilePath);
        logger.info(
          { sourceGroup, userId, skillId, success: result.success },
          'Skill uninstall via IPC completed',
        );
      } else {
        logger.warn(
          { data },
          'Invalid uninstall_skill request - missing required fields',
        );
      }
      break;

    case 'send_file':
      logger.debug(
        { data, sourceGroup, isAdminHome, isHome },
        'processTaskIpc send_file reached',
      );
      if (data.chatJid && data.filePath && data.fileName) {
        // Cross-group authorization check (same as send_message)
        const targetGroup = registeredGroups[data.chatJid];
        if (
          !canSendCrossGroupMessage(
            isAdminHome,
            isHome,
            sourceGroup,
            sourceGroupEntry,
            targetGroup,
          )
        ) {
          logger.warn(
            { chatJid: data.chatJid, sourceGroup },
            'Unauthorized IPC send_file attempt blocked',
          );
          break;
        }

        try {
          // Resolve to workspace path - IPC sends relative paths from workspace/group
          const fullPath = path.join(GROUPS_DIR, sourceGroup, data.filePath);

          // Path traversal protection: ensure resolved path stays within workspace
          let resolvedPath = path.resolve(fullPath);
          const safeRoot = path.resolve(GROUPS_DIR, sourceGroup) + path.sep;
          if (!resolvedPath.startsWith(safeRoot)) {
            logger.warn(
              { sourceGroup, filePath: data.filePath, resolvedPath },
              'Path traversal attempt blocked in send_file IPC',
            );
            break;
          }

          if (!fs.existsSync(resolvedPath)) {
            // Fallback: search in downloads subdirs (DingTalk/Telegram files land here)
            const downloadsDir = path.join(
              GROUPS_DIR,
              sourceGroup,
              'downloads',
            );
            const fileName = data.fileName || path.basename(data.filePath);
            const foundPath = fs.existsSync(downloadsDir)
              ? findFileInSubdirs(downloadsDir, fileName)
              : null;
            if (foundPath) {
              logger.info(
                { originalPath: resolvedPath, foundPath },
                'send_file: fell back to downloads subdirectory',
              );
              resolvedPath = foundPath;
            } else {
              const warnMsg = `⚠️ 文件 "${data.fileName}" 未找到（路径 "${data.filePath}" 不存在）。请引导用户确认正确的文件路径，或使用 'send_file' 时提供正确的相对路径。`;
              broadcastToWebClients(sourceGroup, warnMsg);
              // Also notify via DingTalk for conversation agents bound to IM
              const imRoute = activeImReplyRoutes.get(sourceGroup);
              recordDirectImDeliveryLifecycleForMessages({
                messages: activeImLifecycleMessages.get(sourceGroup) ?? [],
                delivery: 'direct_file',
                targetJid: imRoute ?? null,
                sent: null,
                reason: 'file_not_found',
                details: {
                  fileName: data.fileName,
                  filePath: data.filePath,
                },
              });
              if (imRoute) {
                try {
                  await imManager.sendMessage(imRoute, warnMsg);
                } catch {
                  // ignore
                }
              }
              logger.warn(
                { filePath: data.filePath, resolvedPath },
                'send_file: file not found',
              );
              break;
            }
          }

          // Route to IM: for conversation agents, use activeImReplyRoutes (the IM
          // channel this conversation agent is bound to — e.g. DingTalk group JID).
          const fileImRoute = ipcAgentId
            ? (activeImReplyRoutes.get(sourceGroup) ?? null)
            : getChannelType(data.chatJid) !== null
              ? data.chatJid
              : (activeImReplyRoutes.get(sourceGroup) ?? null);
          if (fileImRoute) {
            const imFileName = data.fileName || path.basename(resolvedPath);
            const sent = await retryImOperation('send_file', fileImRoute, () =>
              imManager.sendFile(fileImRoute, resolvedPath, imFileName),
            );
            recordDirectImDeliveryLifecycleForMessages({
              messages: activeImLifecycleMessages.get(sourceGroup) ?? [],
              delivery: 'direct_file',
              targetJid: fileImRoute,
              sent,
              details: {
                fileName: imFileName,
                filePath: data.filePath,
              },
            });
            if (!sent) {
              const failMsg = `⚠️ 文件 "${data.fileName}" 发送失败，请稍后重试。`;
              broadcastToWebClients(sourceGroup, failMsg);
              // Also notify via DingTalk directly so the user sees it there
              try {
                await imManager.sendMessage(fileImRoute, failMsg);
              } catch {
                // ignore — failure notification itself failing should not crash
              }
            }
          } else {
            recordDirectImDeliveryLifecycleForMessages({
              messages: activeImLifecycleMessages.get(sourceGroup) ?? [],
              delivery: 'direct_file',
              targetJid: null,
              sent: null,
              reason: 'no_im_route',
              details: {
                fileName: data.fileName,
                filePath: data.filePath,
              },
            });
            logger.debug(
              { chatJid: data.chatJid, sourceGroup },
              'No IM route for send_file, skipped IM delivery',
            );
            // Notify the user that file delivery to IM was skipped
            const skipMsg = `⚠️ 文件 "${data.fileName}" 未发送到 IM 通道（当前会话无 IM 路由绑定，文件仅保存在工作区）。`;
            broadcastToWebClients(data.chatJid ?? sourceGroup, skipMsg);
          }
          logger.info(
            {
              sourceGroup,
              chatJid: data.chatJid,
              fileName: data.fileName,
              imRoute: fileImRoute,
            },
            'File sent via IPC',
          );
        } catch (err) {
          logger.error({ err, data }, 'Failed to send file via IPC');
        }
      } else {
        logger.warn(
          { data },
          'Invalid send_file request - missing required fields',
        );
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

/**
 * Process messages for a user-created conversation agent.
 * Similar to processGroupMessages but uses agent-specific session/IPC and virtual JID.
 * The agent process stays alive for idleTimeout, cycling idle→running.
 */
async function processAgentConversation(
  chatJid: string,
  agentId: string,
): Promise<void> {
  const agent = getAgent(agentId);
  if (!agent || (agent.kind !== 'conversation' && agent.kind !== 'spawn')) {
    logger.warn(
      { chatJid, agentId },
      'processAgentConversation: agent not found or not a conversation/spawn',
    );
    return;
  }

  let group = registeredGroups[chatJid];
  if (!group) {
    registeredGroups = getAllRegisteredGroups();
    group = registeredGroups[chatJid];
  }
  if (!group) return;

  const { effectiveGroup } = resolveEffectiveGroup(group);

  const virtualChatJid = `${chatJid}#agent:${agentId}`;
  const virtualJid = virtualChatJid; // used as queue key

  // Get pending messages. Recovery replays from the committed cursor because
  // lastAgentTimestamp may have advanced when IPC accepted a message that the
  // killed runner never completed.
  const isRecovery = agentRecoveryVirtualJids.has(virtualChatJid);
  const recoveryCursor = isRecovery
    ? resolveConversationAgentRecoveryCursor(
        lastCommittedCursor,
        virtualChatJid,
      )
    : null;
  if (isRecovery && !recoveryCursor) {
    agentRecoveryVirtualJids.delete(virtualChatJid);
    logger.info(
      { chatJid, agentId, virtualChatJid },
      'processAgentConversation: skipping recovery without committed cursor',
    );
    return;
  }
  const sinceCursor = isRecovery
    ? recoveryCursor!
    : lastAgentTimestamp[virtualChatJid] || EMPTY_CURSOR;
  const missedMessagesBeforeInterruptedDrop = getMessagesSince(
    virtualChatJid,
    sinceCursor,
  );
  const missedMessages = dropMessagesAtOrBeforeLatestInterruptedPartial(
    virtualChatJid,
    sinceCursor,
    missedMessagesBeforeInterruptedDrop,
  );
  if (missedMessages.length === 0) {
    if (isRecovery) agentRecoveryVirtualJids.delete(virtualChatJid);
    // Spawn agents are fire-and-forget: if no messages are found (race condition
    // or cursor already advanced), mark as error so they don't stay idle forever.
    if (agent.kind === 'spawn' && agent.status === 'idle') {
      updateAgentStatus(agentId, 'error', '未找到待处理消息');
      broadcastAgentStatus(
        chatJid,
        agentId,
        'error',
        agent.name,
        agent.prompt,
        '未找到待处理消息',
      );
      logger.warn(
        { chatJid, agentId },
        'Spawn agent had no pending messages, marked as error',
      );
    }
    return;
  }
  if (isRecovery) agentRecoveryVirtualJids.delete(virtualChatJid);

  const isHome = !!effectiveGroup.is_home;
  const isAdminHome = isHome && effectiveGroup.folder === MAIN_GROUP_FOLDER;

  // Update agent status → running
  updateAgentStatus(agentId, 'running');
  broadcastAgentStatus(chatJid, agentId, 'running', agent.name, agent.prompt);

  const messagesForAgent = selectLeadingSourceTurnMessages(
    missedMessages,
    virtualChatJid,
  );
  const hasDeferredSourceMessages =
    messagesForAgent.length < missedMessages.length;
  const currentTurnSourceJid = resolveMessageSourceJid(
    messagesForAgent[0]!,
    virtualChatJid,
  );

  const prompt = formatMessages(messagesForAgent, false);
  const images = collectMessageImages(virtualChatJid, messagesForAgent);
  const imagesForAgent = images.length > 0 ? images : undefined;
  // Agent conversation turns are cut at the first source boundary. Route the
  // reply to the current turn's source so later pending sources wait for their
  // own turn instead of being mixed into this runner input.
  let replySourceImJid: string | null = null;
  {
    const lastSourceJid =
      messagesForAgent[messagesForAgent.length - 1]?.source_jid;
    if (lastSourceJid && getChannelType(lastSourceJid) !== null) {
      replySourceImJid = lastSourceJid;
    }
  }

  // Fallback: if no IM source in current messages (e.g. web "继续" after
  // restart), recover from the persisted last_im_jid in the DB (#225).
  // Verify the channel is actually connected — stale JIDs from disabled
  // channels would cause unnecessary retries and eventual auto-unbind.
  if (!replySourceImJid) {
    const agentRow = getAgent(agentId);
    if (agentRow?.last_im_jid) {
      if (imManager.isChannelAvailableForJid(agentRow.last_im_jid)) {
        replySourceImJid = agentRow.last_im_jid;
        logger.info(
          { chatJid, agentId, recoveredImJid: replySourceImJid },
          'Recovered IM routing from persisted last_im_jid',
        );
      } else {
        logger.info(
          { chatJid, agentId, staleImJid: agentRow.last_im_jid },
          'Skipped last_im_jid recovery: channel disconnected',
        );
      }
    }
  }

  // Persist the IM routing target so it survives service restarts.
  if (replySourceImJid) {
    updateAgentLastImJid(agentId, replySourceImJid);
    // Also publish to activeImReplyRoutes so send_file/send_image IPC can route to IM.
    activeImReplyRoutes.set(effectiveGroup.folder, replySourceImJid);
  }
  activeImLifecycleMessages.set(effectiveGroup.folder, messagesForAgent);

  // ── Feishu Streaming Card (conversation agent) ──
  // Unlike processGroupMessages which falls back to chatJid, conversation agents
  // only stream when the message originates from an IM channel (replySourceImJid).
  // Web-only interactions don't need a Feishu streaming card.
  // Use agent-scoped key to avoid colliding with the main session's streaming card (#242).
  const streamingSessionJid = replySourceImJid
    ? `${replySourceImJid}#agent:${agentId}`
    : undefined;
  let agentStreamingSession = replySourceImJid
    ? imManager.createStreamingSession(replySourceImJid, (messageId) =>
        registerMessageIdMapping(messageId, streamingSessionJid!),
      )
    : undefined;
  let agentStreamingPresentationText = createEmptyStreamPresentationTextState();
  let agentStreamingThinking = '';
  let agentStreamInterrupted = false;
  let agentStreamingEventTurnId: string | undefined;
  let agentStreamingMessageCursorId: string | undefined;
  let agentStreamStartedLifecycleRecorded = false;
  if (agentStreamingSession && streamingSessionJid) {
    registerStreamingSession(streamingSessionJid, agentStreamingSession);
    logger.debug(
      { chatJid, agentId },
      'Streaming card session created for conversation agent',
    );
  }
  const ensureAgentStreamingSessionAvailable = () => {
    if (!streamingSessionJid) {
      return undefined;
    }
    agentStreamingSession = ensureLateBoundStreamingSession(
      agentStreamingSession,
      {
        createJid: replySourceImJid,
        registerJid: streamingSessionJid,
        isChannelAvailable: (jid) => imManager.isChannelAvailableForJid(jid),
        createSession: (jid) =>
          imManager.createStreamingSession(jid, (messageId) =>
            registerMessageIdMapping(messageId, streamingSessionJid),
          ),
        registerSession: registerStreamingSession,
      },
    );
    return agentStreamingSession;
  };

  // Track idle timer
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { agentId, chatJid },
        'Agent conversation idle timeout, closing stdin',
      );
      queue.closeStdin(virtualJid);
    }, getSystemSettings().idleTimeout);
  };

  let hadError = false;
  let lastError = '';
  let lastAgentReplyMsgId: string | undefined;
  let lastAgentReplyText: string | undefined;
  let savedAgentPartialReply = false;
  const lastProcessed = messagesForAgent[messagesForAgent.length - 1]!;
  let activeTurnCursor: MessageCursor = {
    timestamp: lastProcessed.timestamp,
    id: lastProcessed.id,
  };
  let cursorLifecycleRecorded = false;
  let agentCursorCommitBlockedReason: string | null = null;
  let queuedDeferredSourceMessages = false;
  const activeStreamingTurnKey = buildStreamingTurnStateKey(chatJid, agentId);
  const streamingSnapshotKey = resolveStreamingSnapshotKey(chatJid, agentId);
  const blockAgentCursorCommit = (reason: string): void => {
    agentCursorCommitBlockedReason ??= reason;
  };
  const commitCursor = (): void => {
    if (agentCursorCommitBlockedReason) {
      logger.warn(
        {
          chatJid,
          agentId,
          virtualChatJid,
          reason: agentCursorCommitBlockedReason,
        },
        'Skipping conversation agent cursor commit until IM delivery succeeds',
      );
      return;
    }
    if (!cursorLifecycleRecorded) {
      recordLifecycleForMessages({
        messages: messagesForAgent,
        stage: 'cursor_committed',
        details: { agentId, cursor: activeTurnCursor },
      });
      cursorLifecycleRecorded = true;
    }
    advanceCursors(virtualChatJid, activeTurnCursor);
    if (clearActiveStreamingTurns([activeStreamingTurnKey])) {
      saveState();
    }
    if (hasDeferredSourceMessages && !queuedDeferredSourceMessages) {
      queuedDeferredSourceMessages = true;
      queue.closeStdin(virtualJid);
      queue.enqueueTask(
        virtualJid,
        `agent-deferred:${agentId}:${activeTurnCursor.id}`,
        async () => {
          await processAgentConversation(chatJid, agentId);
        },
      );
    }
  };
  const isCurrentTurnCommitted = (): boolean => {
    const committed = lastCommittedCursor[virtualChatJid];
    return !!committed && !isCursorAfter(activeTurnCursor, committed);
  };

  // Get or use agent-specific session
  const sessionId = getSession(effectiveGroup.folder, agentId) || undefined;
  let currentAgentSessionId = sessionId;
  let currentAgentRuntimeIdentity: RuntimeIdentity | null =
    resolveEffectiveRuntimeIdentity(effectiveGroup, {
      ...getOpenAiRuntimeIdentityOptions(),
    });
  const agentConversationStartedAt = Date.now();
  let activeAgentTurnStartedAt = agentConversationStartedAt;

  const wrappedOnOutput = async (output: AgentProcessOutput) => {
    // Track session
    if (output.newSessionId && output.status !== 'error') {
      setSession(effectiveGroup.folder, output.newSessionId, agentId);
      currentAgentSessionId = output.newSessionId;
    }
    currentAgentRuntimeIdentity = mergeRuntimeIdentity(
      currentAgentRuntimeIdentity,
      output.streamEvent?.runtimeIdentity || output.runtimeIdentity,
    );

    // Stream events
    if (output.status === 'stream' && output.streamEvent) {
      const streamEvent = currentAgentRuntimeIdentity
        ? {
            ...output.streamEvent,
            runtimeIdentity: currentAgentRuntimeIdentity,
          }
        : output.streamEvent;
      const eventCursorId = streamEvent.messageCursor?.id?.trim();
      if (
        eventCursorId &&
        activeTurnCursor.id &&
        eventCursorId !== activeTurnCursor.id
      ) {
        logger.warn(
          {
            chatJid,
            agentId,
            eventCursorId,
            activeCursorId: activeTurnCursor.id,
            eventType: streamEvent.eventType,
            turnId: streamEvent.turnId,
          },
          'Suppressing stale conversation-agent stream event for previous message cursor',
        );
        return;
      }
      const turnBoundary = applyStreamingTurnBoundary(
        {
          turnId: agentStreamingEventTurnId,
          messageCursorId: agentStreamingMessageCursorId,
          startedAtMs: activeAgentTurnStartedAt,
          presentationText: agentStreamingPresentationText,
          thinkingText: agentStreamingThinking,
          interrupted: agentStreamInterrupted,
        },
        streamEvent,
      );
      if (turnBoundary.turnChanged) {
        agentStreamingPresentationText =
          turnBoundary.nextState.presentationText;
        agentStreamingThinking = turnBoundary.nextState.thinkingText;
        agentStreamInterrupted = turnBoundary.nextState.interrupted;
        activeAgentTurnStartedAt =
          turnBoundary.nextState.startedAtMs ?? Date.now();
        agentStreamStartedLifecycleRecorded = false;
        if (streamingSessionJid) {
          if (agentStreamingSession) {
            if (agentStreamingSession.isActive()) {
              await agentStreamingSession
                .abort('新的回复已开始')
                .catch(() => {});
            } else {
              agentStreamingSession.dispose();
            }
            unregisterStreamingSession(streamingSessionJid);
          }
          agentStreamingSession = undefined;
          ensureAgentStreamingSessionAvailable();
        }
      }
      agentStreamingEventTurnId = turnBoundary.nextState.turnId;
      agentStreamingMessageCursorId = turnBoundary.nextState.messageCursorId;
      if (streamEvent.eventType === 'init' && streamEvent.messageCursor) {
        setActiveStreamingTurn(
          activeStreamingTurnKey,
          virtualChatJid,
          normalizeCursor(streamEvent.messageCursor),
          virtualChatJid,
          streamingSnapshotKey,
          {
            turnId: streamEvent.turnId,
            messageCursorId: streamEvent.messageCursor.id,
          },
        );
        activeTurnCursor = normalizeCursor(streamEvent.messageCursor);
        if (!agentStreamStartedLifecycleRecorded) {
          recordStreamStartedLifecycleForMessages({
            messages: messagesForAgent,
            streamEvent,
            details: {
              agentId,
              route: 'conversation_agent',
              streamingJid: streamingSessionJid,
            },
          });
          agentStreamStartedLifecycleRecorded = true;
        }
      }
      const streamEventWithFooterUsage = await enrichUsageStreamEventForFooter(
        streamEvent,
        currentAgentRuntimeIdentity,
        activeAgentTurnStartedAt,
      );
      broadcastStreamEvent(chatJid, streamEventWithFooterUsage, agentId);

      // ── 累积 text_delta 文本（中断时用于保存已输出内容）──
      if (streamEvent.eventType === 'text_delta' && streamEvent.text) {
        agentStreamingPresentationText = appendStreamPresentationText(
          agentStreamingPresentationText,
          streamEvent,
          currentAgentRuntimeIdentity,
        );
      }
      if (streamEvent.eventType === 'thinking_delta' && streamEvent.text) {
        agentStreamingThinking += streamEvent.text;
      }

      // ── Feed stream events into Feishu streaming card ──
      const activeAgentStreamingSession =
        ensureAgentStreamingSessionAvailable();
      if (activeAgentStreamingSession) {
        feedStreamEventToCard(
          activeAgentStreamingSession,
          streamEventWithFooterUsage,
          agentStreamingPresentationText,
        );
      }

      // ── 中断时立即保存已输出内容 ──
      if (
        streamEvent.eventType === 'status' &&
        streamEvent.statusText === 'interrupted'
      ) {
        agentStreamInterrupted = true;
        const provisionalUsage = buildProvisionalTokenUsage(
          activeAgentTurnStartedAt,
        );
        if (!isCurrentTurnCommitted()) {
          const interruptedText = decorateTaskReplyText(
            buildInterruptedReply(
              agentStreamingPresentationText.answerText,
              agentStreamingThinking,
              agentStreamingPresentationText.commentaryText,
            ),
            'interrupt_partial',
            virtualChatJid,
          );
          try {
            let streamingCardHandledIM = false;
            const activeAgentStreamingSession =
              ensureAgentStreamingSessionAvailable();
            if (activeAgentStreamingSession?.isActive()) {
              await patchStreamingSessionFooterUsage(
                activeAgentStreamingSession,
                currentAgentRuntimeIdentity,
                provisionalUsage,
              ).catch(() => {});
              syncTerminalPresentationTextToCard(
                activeAgentStreamingSession,
                agentStreamingPresentationText,
                undefined,
              );
              streamingCardHandledIM = await activeAgentStreamingSession
                .abort('已中断')
                .then(() => true)
                .catch(() => false);
            }
            const msgId = crypto.randomUUID();
            const timestamp = new Date().toISOString();
            const serializedTokenUsage = serializeAssistantTokenUsage(
              await enrichTokenUsageWithCurrentRuntimeRemaining(
                currentAgentRuntimeIdentity,
                provisionalUsage,
              ),
            );
            ensureChatExists(virtualChatJid);
            const persistedMsgId = storeMessageDirect(
              msgId,
              virtualChatJid,
              'cli-claw-agent',
              ASSISTANT_NAME,
              interruptedText,
              timestamp,
              true,
              {
                tokenUsage: serializedTokenUsage,
                meta: {
                  turnId: output.streamEvent.turnId || lastProcessed.id,
                  sessionId:
                    output.streamEvent.sessionId || currentAgentSessionId,
                  sourceKind: 'interrupt_partial',
                  finalizationReason: 'interrupted',
                  runtimeIdentity: currentAgentRuntimeIdentity,
                },
              },
            );
            broadcastNewMessage(
              virtualChatJid,
              {
                id: persistedMsgId,
                chat_jid: virtualChatJid,
                sender: 'cli-claw-agent',
                sender_name: ASSISTANT_NAME,
                content: interruptedText,
                timestamp,
                is_from_me: true,
                turn_id: output.streamEvent.turnId || lastProcessed.id,
                session_id:
                  output.streamEvent.sessionId || currentAgentSessionId,
                sdk_message_uuid: null,
                source_kind: 'interrupt_partial',
                finalization_reason: 'interrupted',
                runtime_identity: currentAgentRuntimeIdentity,
                token_usage: serializedTokenUsage,
              },
              agentId,
            );
            const replyImJid = resolveInterruptedPartialImJid(replySourceImJid);
            const staticImDeliverySucceeded =
              await sendInterruptedPartialToImIfNeeded({
                replyImJid,
                streamingCardHandledIm: streamingCardHandledIM,
                text: interruptedText,
                groupFolder: effectiveGroup.folder,
                lifecycleMessages: messagesForAgent,
                lifecycleDetails: {
                  agentId,
                  deliveryPoint: 'agent_status',
                },
              });
            if (
              !shouldCommitCursorAfterInterruptedPartialDelivery({
                replyImJid,
                streamingCardHandledIm: streamingCardHandledIM,
                staticImDeliverySucceeded,
              })
            ) {
              blockAgentCursorCommit('interrupted_partial_delivery_failed');
            }
            savedAgentPartialReply = true;
            commitCursor();
            agentStreamingEventTurnId = undefined;
            agentStreamingMessageCursorId = undefined;
          } catch (err) {
            logger.warn(
              { err, chatJid, agentId },
              'Failed to save interrupted agent text on status event',
            );
          }
        }
      }

      // Persist token usage for agent conversations
      if (
        streamEventWithFooterUsage.eventType === 'usage' &&
        streamEventWithFooterUsage.usage
      ) {
        try {
          updateLatestMessageTokenUsage(
            virtualChatJid,
            JSON.stringify(streamEventWithFooterUsage.usage),
            lastAgentReplyMsgId,
          );

          // Write to usage_records + usage_daily_summary
          // Sub-Agent 的 effectiveGroup 可能没有 created_by，从父群组继承
          writeUsageRecords({
            userId:
              effectiveGroup.created_by ||
              registeredGroups[chatJid]?.created_by ||
              'system',
            groupFolder: effectiveGroup.folder,
            agentId,
            messageId: lastAgentReplyMsgId,
            usage: streamEventWithFooterUsage.usage,
          });
        } catch (err) {
          logger.warn(
            { err, chatJid, agentId },
            'Failed to persist agent conversation token usage',
          );
        }
      }

      // Reset idle timer on stream events so long-running tool calls
      // don't get killed while the agent is actively working.
      resetIdleTimer();
      return;
    }

    // Agent reply
    if (output.result) {
      const raw =
        typeof output.result === 'string'
          ? output.result
          : JSON.stringify(output.result);
      let text = stripAgentInternalTags(raw);
      if (output.sourceKind === 'overflow_partial') {
        // Spawn agents are fire-and-forget: context compression is an internal
        // detail. Don't append the "上下文压缩中" suffix — it confuses users
        // seeing the Feishu card suddenly change to a warning.
        if (agent.kind !== 'spawn') {
          text = buildOverflowPartialReply(text);
        }
      }
      if (text) {
        const visibleReplyParts = resolveVisibleReplyParts(
          text,
          agentStreamingPresentationText,
          currentAgentRuntimeIdentity,
        );
        logOpenAiFinalVisibleReplyFields({
          virtualChatJid,
          agentId,
          turnId: output.turnId,
          sessionId: output.sessionId || currentAgentSessionId,
          sdkMessageUuid: output.sdkMessageUuid,
          sourceKind: output.sourceKind || 'sdk_final',
          finalizationReason: output.finalizationReason || 'completed',
          rawText: text,
          presentationText: agentStreamingPresentationText,
          runtimeIdentity: currentAgentRuntimeIdentity,
          visibleReplyParts,
          message: 'OpenAI agent final visible reply fields resolved',
        });
        if (visibleReplyParts.droppedPresentationAnswer) {
          logger.warn(
            {
              virtualChatJid,
              agentId,
              turnId: output.turnId,
              sessionId: output.sessionId || currentAgentSessionId,
              sdkMessageUuid: output.sdkMessageUuid,
              rawTextLen: text.length,
              presentationAnswerLen:
                agentStreamingPresentationText.answerText.length,
              presentationCommentaryLen:
                agentStreamingPresentationText.commentaryText.length,
              runtimeIdentity: currentAgentRuntimeIdentity,
              sourceKind: output.sourceKind || 'sdk_final',
              finalizationReason: output.finalizationReason || 'completed',
            },
            'Ignored agent presentation answer for final visible reply',
          );
        }
        const visibleText = decorateTaskReplyText(
          visibleReplyParts.visibleText,
          output.sourceKind || 'sdk_final',
          virtualChatJid,
        );
        const isFirstReply = !lastAgentReplyMsgId;
        const msgId = crypto.randomUUID();
        lastAgentReplyMsgId = msgId;
        lastAgentReplyText = visibleText;
        const timestamp = new Date().toISOString();
        ensureChatExists(virtualChatJid);
        const persistedMsgId = storeMessageDirect(
          msgId,
          virtualChatJid,
          'cli-claw-agent',
          ASSISTANT_NAME,
          visibleText,
          timestamp,
          true,
          {
            meta: {
              turnId: output.turnId || lastProcessed.id,
              sessionId: output.sessionId || currentAgentSessionId,
              sdkMessageUuid: output.sdkMessageUuid,
              sourceKind: output.sourceKind || 'sdk_final',
              finalizationReason: output.finalizationReason || 'completed',
              runtimeIdentity: currentAgentRuntimeIdentity,
            },
          },
        );
        recordLifecycleForMessages({
          messages: messagesForAgent,
          stage: 'finalized',
          details: {
            agentId,
            replyMessageId: persistedMsgId,
            sourceKind: output.sourceKind || 'sdk_final',
            finalizationReason: output.finalizationReason || 'completed',
          },
        });
        broadcastNewMessage(
          virtualChatJid,
          {
            id: persistedMsgId,
            chat_jid: virtualChatJid,
            sender: 'cli-claw-agent',
            sender_name: ASSISTANT_NAME,
            content: visibleText,
            timestamp,
            is_from_me: true,
            turn_id: output.turnId || lastProcessed.id,
            session_id: output.sessionId || currentAgentSessionId,
            sdk_message_uuid: output.sdkMessageUuid ?? null,
            source_kind: output.sourceKind || 'sdk_final',
            finalization_reason: output.finalizationReason || 'completed',
            runtime_identity: currentAgentRuntimeIdentity,
          },
          agentId,
        );

        const localImagePaths = extractLocalImImagePaths(
          visibleText,
          effectiveGroup.folder,
        );

        // ── Complete Feishu streaming card or fall back to static message ──
        let streamingCardHandledIM = false;
        const activeAgentStreamingSession =
          ensureAgentStreamingSessionAvailable();
        if (activeAgentStreamingSession?.isActive()) {
          try {
            activeAgentStreamingSession.setRuntimeIdentity(
              currentAgentRuntimeIdentity,
            );
            await patchStreamingSessionFooterUsage(
              activeAgentStreamingSession,
              currentAgentRuntimeIdentity,
              buildProvisionalTokenUsage(activeAgentTurnStartedAt),
            ).catch(() => {});
            syncTerminalPresentationTextToCard(
              activeAgentStreamingSession,
              agentStreamingPresentationText,
              visibleReplyParts.commentaryText,
            );
            if (output.finalizationReason === 'error') {
              await activeAgentStreamingSession.fail(visibleText);
            } else {
              await activeAgentStreamingSession.complete(visibleText);
            }
            streamingCardHandledIM = true;
            recordLifecycleForMessages({
              messages: messagesForAgent,
              stage: 'im_delivered',
              details: { agentId, delivery: 'streaming_card' },
            });
          } catch (err) {
            logger.warn(
              { err, chatJid, agentId },
              'Agent streaming card complete failed, falling back to static message',
            );
            await activeAgentStreamingSession
              .abort('回复已通过消息发送')
              .catch(() => {});
          }
        }

        // ── Rebuild streaming card after overflow_partial ──
        // The completed card was consumed; create a new one so post-compaction
        // tool-call progress remains visible on Feishu (#223).
        if (
          streamingCardHandledIM &&
          output.sourceKind === 'overflow_partial' &&
          streamingSessionJid
        ) {
          agentStreamingPresentationText =
            createEmptyStreamPresentationTextState();
          agentStreamingThinking = '';
          agentStreamingEventTurnId = undefined;
          agentStreamingMessageCursorId = undefined;
          unregisterStreamingSession(streamingSessionJid);
          agentStreamingSession = undefined;
          if (ensureAgentStreamingSessionAvailable()) {
            logger.debug(
              { chatJid, agentId, sourceKind: output.sourceKind },
              'Rebuilt streaming card after partial output',
            );
          }
        }

        if (replySourceImJid && !streamingCardHandledIM && isFirstReply) {
          // Only send the FIRST substantive reply to IM. Subsequent results
          // (SDK Task completions) are stored in DB but not spammed to IM.
          const imSent = await sendImWithRetry(
            replySourceImJid,
            visibleText,
            localImagePaths,
          );
          recordLifecycleForMessages({
            messages: messagesForAgent,
            stage: 'im_delivered',
            status: imSent ? 'ok' : 'error',
            reason: imSent ? null : 'send_failed_after_retries',
            details: { agentId, delivery: 'static_message' },
          });
          if (imSent) {
            logger.info(
              {
                chatJid,
                agentId,
                replySourceImJid,
                sourceKind: output.sourceKind,
                textLen: visibleText.length,
              },
              'Agent conversation: static IM message sent',
            );
          } else {
            logger.error(
              {
                chatJid,
                agentId,
                replySourceImJid,
                sourceKind: output.sourceKind,
              },
              'Agent conversation: IM send failed after all retries, message lost',
            );
          }
          if (
            !shouldCommitAgentConversationCursorAfterImDelivery({
              replySourceImJid,
              streamingCardHandledIm: streamingCardHandledIM,
              staticImDeliverySucceeded: imSent,
            })
          ) {
            blockAgentCursorCommit('routed_im_delivery_failed');
          }
        } else if (!replySourceImJid) {
          logger.debug(
            { chatJid, agentId, sourceKind: output.sourceKind },
            'Agent conversation: no replySourceImJid, skip IM delivery',
          );
        }

        // Optional mirror mode for linked IM channels
        for (const [imJid, g] of Object.entries(registeredGroups)) {
          if (g.target_agent_id !== agentId || imJid === replySourceImJid)
            continue;
          if (g.reply_policy !== 'mirror') continue;
          if (getChannelType(imJid))
            sendImWithFailTracking(imJid, visibleText, localImagePaths, {
              lifecycleMessages: messagesForAgent,
              lifecycleDetails: { agentId, delivery: 'mirror_message' },
            });
        }

        commitCursor();
        resetIdleTimer();

        // Spawn agents are fire-and-forget: close after first reply to free process slot.
        // Skip for overflow_partial — it is intermediate context
        // compression outputs, not the final result; closing now would kill the agent
        // before it finishes the actual task.
        if (
          agent.kind === 'spawn' &&
          text &&
          output.sourceKind !== 'overflow_partial'
        ) {
          logger.info(
            { agentId, chatJid },
            'Spawn agent replied, sending close signal',
          );
          queue.closeStdin(virtualChatJid);
        }
      }
    }

    if (output.status === 'error') {
      hadError = true;
      if (output.error) lastError = output.error;
    }
  };

  ipcWatcherManager?.watchGroup(effectiveGroup.folder);
  try {
    const agentType = normalizeAgentType(effectiveGroup.agentType);
    const selectedRunner = agentType;
    const effectiveRuntimeIdentity = resolveEffectiveRuntimeIdentity(
      effectiveGroup,
      {
        ...getOpenAiRuntimeIdentityOptions(),
      },
    );
    const runtimeBuildLogFields = getRuntimeBuildLogFields();

    logger.info(
      {
        requestedAgentType: agentType,
        effectiveAgentType: agentType,
        selectedRunner,
        chatJid,
        virtualJid,
        groupFolder: effectiveGroup.folder,
        agentId,
        agentName: agent.name,
        sessionId: sessionId || null,
        isHome,
        isAdminHome,
        messageCount: missedMessages.length,
        forwardedMessageCount: messagesForAgent.length,
        deferredMessageCount: Math.max(
          missedMessages.length - messagesForAgent.length,
          0,
        ),
        droppedInterruptedContextCount:
          missedMessagesBeforeInterruptedDrop.length - missedMessages.length,
        activeSourceJid: currentTurnSourceJid,
        ...runtimeBuildLogFields,
      },
      'Dispatching conversation agent run',
    );

    const onProcessCb = (proc: ChildProcess, identifier: string) => {
      recordLifecycleForMessages({
        messages: messagesForAgent,
        stage: 'runner_started',
        details: { agentId, identifier },
      });
      queue.registerProcess(
        virtualJid,
        proc,
        identifier,
        effectiveGroup.folder,
        identifier,
        agentId,
        undefined,
        currentTurnSourceJid,
      );
    };

    const agentInput: AgentProcessInput = {
      prompt,
      sessionId,
      turnId: lastProcessed.id,
      messageCursor: activeTurnCursor,
      groupFolder: effectiveGroup.folder,
      chatJid,
      agentType,
      model: effectiveRuntimeIdentity.model ?? null,
      reasoningEffort: effectiveRuntimeIdentity.reasoningEffort ?? null,
      speedTier: effectiveRuntimeIdentity.speedTier ?? null,
      isHome,
      isAdminHome,
      agentId,
      agentName: agent.name,
      images: imagesForAgent,
    };

    // Write tasks/groups snapshots
    const tasks = getAllTasks();
    writeTasksSnapshot(
      effectiveGroup.folder,
      isAdminHome,
      tasks.map((t) => ({
        id: t.id,
        groupFolder: t.group_folder,
        prompt: t.prompt,
        schedule_type: t.schedule_type,
        schedule_value: t.schedule_value,
        status: t.status,
        next_run: t.next_run,
      })),
    );
    const availableGroups = getAvailableGroups();
    writeGroupsSnapshot(
      effectiveGroup.folder,
      isAdminHome,
      availableGroups,
      new Set(Object.keys(registeredGroups)),
    );

    const output = await runAgentProcess(
      effectiveGroup,
      agentInput,
      onProcessCb,
      wrappedOnOutput,
    );

    // Finalize session
    if (output.newSessionId && output.status !== 'error') {
      setSession(effectiveGroup.folder, output.newSessionId, agentId);
    }

    // 不可恢复的转录错误（如超大图片/MIME 错配被固化在会话历史中）
    const errorForReset = [lastError, output.error].filter(Boolean).join(' ');
    if (
      (output.status === 'error' || hadError) &&
      errorForReset.includes('unrecoverable_transcript:')
    ) {
      const detail = (lastError || output.error || '').replace(
        /.*unrecoverable_transcript:\s*/,
        '',
      );
      logger.warn(
        { chatJid, agentId, folder: effectiveGroup.folder, error: detail },
        'Unrecoverable transcript error in conversation agent, auto-resetting session',
      );

      await clearSessionRuntimeFiles(effectiveGroup.folder, agentId);
      try {
        deleteSession(effectiveGroup.folder, agentId);
      } catch (err) {
        logger.error(
          { chatJid, agentId, folder: effectiveGroup.folder, err },
          'Failed to clear agent session state during auto-reset',
        );
      }

      sendSystemMessage(
        virtualChatJid,
        'context_reset',
        `会话已自动重置：${detail}`,
      );
      commitCursor();
    }

    // Only commit cursor if a reply was actually sent.  Without a reply the
    // messages haven't been "processed" — leaving the cursor behind lets the
    // recovery logic pick them up after a restart.
    if (lastAgentReplyMsgId) {
      commitCursor();
    }
  } catch (err) {
    hadError = true;
    logger.error({ agentId, chatJid, err }, 'Agent conversation error');
  } finally {
    if (idleTimer) clearTimeout(idleTimer);

    const hasAgentFinalReply = !!lastAgentReplyMsgId;
    const hasAgentAccumulatedText =
      !!agentStreamingPresentationText.answerText.trim() ||
      !!agentStreamingPresentationText.commentaryText.trim();
    const shouldSavePartialReply = (): boolean =>
      !savedAgentPartialReply &&
      shouldSaveAgentConversationPartialReply({
        currentTurnCommitted: isCurrentTurnCommitted(),
        hasFinalReply: hasAgentFinalReply,
        hasAccumulatedText: hasAgentAccumulatedText,
      });

    const wasInterrupted = agentStreamInterrupted && shouldSavePartialReply();

    // ── Streaming card cleanup ──
    const activeAgentStreamingSession = agentStreamingSession;
    let agentStreamingCardHandledInterruptedPartial = false;
    if (activeAgentStreamingSession) {
      if (activeAgentStreamingSession.isActive()) {
        syncTerminalPresentationTextToCard(
          activeAgentStreamingSession,
          agentStreamingPresentationText,
          undefined,
        );
        if (hadError) {
          agentStreamingCardHandledInterruptedPartial =
            await activeAgentStreamingSession
              .abort('处理出错')
              .then(() => true)
              .catch(() => false);
        } else if (wasInterrupted) {
          const provisionalUsage = buildProvisionalTokenUsage(
            activeAgentTurnStartedAt,
          );
          await patchStreamingSessionFooterUsage(
            activeAgentStreamingSession,
            currentAgentRuntimeIdentity,
            provisionalUsage,
          ).catch(() => {});
          agentStreamingCardHandledInterruptedPartial =
            await activeAgentStreamingSession
              .abort('已中断')
              .then(() => true)
              .catch(() => false);
        } else {
          const provisionalUsage = buildProvisionalTokenUsage(
            activeAgentTurnStartedAt,
          );
          await patchStreamingSessionFooterUsage(
            activeAgentStreamingSession,
            currentAgentRuntimeIdentity,
            provisionalUsage,
          ).catch(() => {});
          agentStreamingCardHandledInterruptedPartial =
            await activeAgentStreamingSession
              .abort('未收到最终正文')
              .then(() => true)
              .catch(() => {
                activeAgentStreamingSession.dispose();
                return false;
              });
        }
      }
      if (streamingSessionJid) {
        unregisterStreamingSession(streamingSessionJid);
      }
    }

    // ── 保存中断内容 ──
    if (wasInterrupted) {
      const provisionalUsage = buildProvisionalTokenUsage(
        activeAgentTurnStartedAt,
      );
      const interruptedText = decorateTaskReplyText(
        buildInterruptedReply(
          agentStreamingPresentationText.answerText,
          agentStreamingThinking,
          agentStreamingPresentationText.commentaryText,
        ),
        'interrupt_partial',
        virtualChatJid,
      );
      try {
        const msgId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const serializedTokenUsage = serializeAssistantTokenUsage(
          await enrichTokenUsageWithCurrentRuntimeRemaining(
            currentAgentRuntimeIdentity,
            provisionalUsage,
          ),
        );
        ensureChatExists(virtualChatJid);
        const persistedMsgId = storeMessageDirect(
          msgId,
          virtualChatJid,
          'cli-claw-agent',
          ASSISTANT_NAME,
          interruptedText,
          timestamp,
          true,
          {
            tokenUsage: serializedTokenUsage,
            meta: {
              turnId: lastProcessed.id,
              sessionId: currentAgentSessionId,
              sourceKind: 'interrupt_partial',
              finalizationReason: 'interrupted',
              runtimeIdentity: currentAgentRuntimeIdentity,
            },
          },
        );
        broadcastNewMessage(
          virtualChatJid,
          {
            id: persistedMsgId,
            chat_jid: virtualChatJid,
            sender: 'cli-claw-agent',
            sender_name: ASSISTANT_NAME,
            content: interruptedText,
            timestamp,
            is_from_me: true,
            turn_id: lastProcessed.id,
            session_id: currentAgentSessionId,
            sdk_message_uuid: null,
            source_kind: 'interrupt_partial',
            finalization_reason: 'interrupted',
            runtime_identity: currentAgentRuntimeIdentity,
            token_usage: serializedTokenUsage,
          },
          agentId,
        );
        const replyImJid = resolveInterruptedPartialImJid(replySourceImJid);
        const staticImDeliverySucceeded =
          await sendInterruptedPartialToImIfNeeded({
            replyImJid,
            streamingCardHandledIm: agentStreamingCardHandledInterruptedPartial,
            text: interruptedText,
            groupFolder: effectiveGroup.folder,
            lifecycleMessages: missedMessages,
            lifecycleDetails: {
              agentId,
              deliveryPoint: 'agent_finally_interrupted',
            },
          });
        if (
          !shouldCommitCursorAfterInterruptedPartialDelivery({
            replyImJid,
            streamingCardHandledIm: agentStreamingCardHandledInterruptedPartial,
            staticImDeliverySucceeded,
          })
        ) {
          blockAgentCursorCommit('interrupted_partial_delivery_failed');
        }
        savedAgentPartialReply = true;
        commitCursor();
        agentStreamingEventTurnId = undefined;
        agentStreamingMessageCursorId = undefined;
      } catch (err) {
        logger.warn(
          { err, chatJid, agentId },
          'Failed to save interrupted agent text',
        );
      }
    }

    // ── 兜底：进程异常退出导致累积文本未持久化 ──
    if (shouldSavePartialReply()) {
      try {
        const provisionalUsage = buildProvisionalTokenUsage(
          activeAgentTurnStartedAt,
        );
        const partialReply = decorateTaskReplyText(
          buildInterruptedReply(
            agentStreamingPresentationText.answerText,
            agentStreamingThinking,
            agentStreamingPresentationText.commentaryText,
          ),
          'interrupt_partial',
          virtualChatJid,
        );
        const msgId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const serializedTokenUsage = serializeAssistantTokenUsage(
          await enrichTokenUsageWithCurrentRuntimeRemaining(
            currentAgentRuntimeIdentity,
            provisionalUsage,
          ),
        );
        ensureChatExists(virtualChatJid);
        const persistedMsgId = storeMessageDirect(
          msgId,
          virtualChatJid,
          'cli-claw-agent',
          ASSISTANT_NAME,
          partialReply,
          timestamp,
          true,
          {
            tokenUsage: serializedTokenUsage,
            meta: {
              turnId: lastProcessed.id,
              sessionId: currentAgentSessionId,
              sourceKind: 'interrupt_partial',
              finalizationReason: 'error',
              runtimeIdentity: currentAgentRuntimeIdentity,
            },
          },
        );
        broadcastNewMessage(
          virtualChatJid,
          {
            id: persistedMsgId,
            chat_jid: virtualChatJid,
            sender: 'cli-claw-agent',
            sender_name: ASSISTANT_NAME,
            content: partialReply,
            timestamp,
            is_from_me: true,
            turn_id: lastProcessed.id,
            session_id: currentAgentSessionId,
            sdk_message_uuid: null,
            source_kind: 'interrupt_partial',
            finalization_reason: 'error',
            runtime_identity: currentAgentRuntimeIdentity,
            token_usage: serializedTokenUsage,
          },
          agentId,
        );
        // Fallback: send accumulated streaming text to IM when output.result is null
        // (agent-runner streams all text via text_delta, never sets result field)
        logger.info({
          chatJid,
          agentId,
          replySourceImJid,
          accLen:
            agentStreamingPresentationText.answerText.length +
            agentStreamingPresentationText.commentaryText.length,
          cursorCommitted: isCurrentTurnCommitted(),
        });
        const replyImJid = resolveInterruptedPartialImJid(replySourceImJid);
        if (replyImJid) {
          logger.info(
            { replySourceImJid: replyImJid, textLen: partialReply.length },
            'agent partial reply ready',
          );
        } else {
          logger.warn(
            { chatJid, agentId },
            'Partial reply: no replySourceImJid found, skipping IM send',
          );
        }
        const staticImDeliverySucceeded =
          await sendInterruptedPartialToImIfNeeded({
            replyImJid,
            streamingCardHandledIm: agentStreamingCardHandledInterruptedPartial,
            text: partialReply,
            groupFolder: effectiveGroup.folder,
            lifecycleMessages: missedMessages,
            lifecycleDetails: {
              agentId,
              deliveryPoint: 'agent_finally_error',
            },
          });
        if (replyImJid) {
          logger.info(
            { replySourceImJid: replyImJid, imSent: staticImDeliverySucceeded },
            'agent IM reply sent',
          );
        }
        if (
          !shouldCommitCursorAfterInterruptedPartialDelivery({
            replyImJid,
            streamingCardHandledIm: agentStreamingCardHandledInterruptedPartial,
            staticImDeliverySucceeded,
          })
        ) {
          blockAgentCursorCommit('interrupted_partial_delivery_failed');
        }
        savedAgentPartialReply = true;
        commitCursor();
        agentStreamingEventTurnId = undefined;
        agentStreamingMessageCursorId = undefined;
      } catch (err) {
        logger.warn(
          { err, chatJid, agentId },
          'Failed to save interrupted partial agent text',
        );
      }
    }

    // ── Spawn result injection: write final output back to the source chat ──
    if (
      agent.kind === 'spawn' &&
      agent.spawned_from_jid &&
      lastAgentReplyText
    ) {
      try {
        const resultText = lastAgentReplyText;
        const injectId = crypto.randomUUID();
        const injectTs = new Date().toISOString();
        ensureChatExists(agent.spawned_from_jid);
        storeMessageDirect(
          injectId,
          agent.spawned_from_jid,
          'cli-claw-agent',
          ASSISTANT_NAME,
          resultText,
          injectTs,
          true,
        );
        broadcastNewMessage(agent.spawned_from_jid, {
          id: injectId,
          chat_jid: agent.spawned_from_jid,
          sender: 'cli-claw-agent',
          sender_name: ASSISTANT_NAME,
          content: resultText,
          timestamp: injectTs,
          is_from_me: true,
        });
        logger.info(
          {
            agentId,
            spawned_from_jid: agent.spawned_from_jid,
            textLen: lastAgentReplyText.length,
          },
          'Spawn result injected back to source chat',
        );
      } catch (err) {
        logger.error(
          { agentId, err },
          'Failed to inject spawn result back to source chat',
        );
      }
    }

    // Process ended → set status back to idle (conversation agents persist).
    // Spawn agents are fire-and-forget: mark as completed (or error) so they
    // don't accumulate in the active agent list.
    // MUST be inside finally so status is reset even on unhandled exceptions (#227).
    const endStatus =
      agent.kind === 'spawn' ? (hadError ? 'error' : 'completed') : 'idle';
    updateAgentStatus(agentId, endStatus, hadError ? lastError : undefined);
    broadcastAgentStatus(
      chatJid,
      agentId,
      endStatus,
      agent.name,
      agent.prompt,
      hadError ? lastError : undefined,
    );
    if (clearActiveStreamingTurns([activeStreamingTurnKey])) {
      saveState();
    }

    activeImLifecycleMessages.delete(effectiveGroup.folder);
    ipcWatcherManager?.unwatchGroup(effectiveGroup.folder);
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info('cli-claw running');

  while (!shuttingDown) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newCursor } = getNewMessages(jids, globalMessageCursor);

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        globalMessageCursor = newCursor;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          let group = registeredGroups[chatJid];
          if (!group) {
            const dbGroup = getRegisteredGroup(chatJid);
            if (dbGroup) {
              registeredGroups[chatJid] = dbGroup;
              group = dbGroup;
            }
          }
          if (!group) continue;

          // Skip groups with target_agent_id — their messages are routed
          // to conversation agents at IM ingestion time (feishu.ts/telegram.ts)
          if (group.target_agent_id) continue;

          // Billing quota check before processing
          if (group.created_by) {
            const owner = getUserById(group.created_by);
            if (owner && owner.role !== 'admin') {
              const accessResult = checkBillingAccessFresh(
                group.created_by,
                owner.role,
              );
              if (!accessResult.allowed) {
                logger.info(
                  {
                    chatJid,
                    userId: group.created_by,
                    reason: accessResult.reason,
                    blockType: accessResult.blockType,
                    exceededWindow: accessResult.exceededWindow,
                  },
                  'Billing access denied, blocking message processing',
                );
                const sysMsg = formatBillingAccessDeniedMessage(accessResult);
                sendBillingDeniedMessage(chatJid, sysMsg);

                // Notify IM channel if the message came from an IM source
                const lastSourceJid =
                  groupMessages[groupMessages.length - 1]?.source_jid;
                const imSourceJid = lastSourceJid || chatJid;
                if (getChannelType(imSourceJid)) {
                  imManager
                    .sendMessage(imSourceJid, sysMsg)
                    .catch((err) =>
                      logger.warn(
                        { err, jid: imSourceJid },
                        'Failed to send quota exceeded notice to IM',
                      ),
                    );
                }

                // Advance cursor past these messages so they aren't re-processed
                const lastMsg = groupMessages[groupMessages.length - 1];
                setCursors(chatJid, {
                  timestamp: lastMsg.timestamp,
                  id: lastMsg.id,
                });
                continue;
              }
            }
          }

          const pendingMessages = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || EMPTY_CURSOR,
          );
          const activeRunnerCursor =
            lastAgentTimestamp[chatJid] || EMPTY_CURSOR;
          const filteredPending =
            dropMessagesAtOrBeforeLatestInterruptedPartial(
              chatJid,
              activeRunnerCursor,
              pendingMessages.length > 0 ? pendingMessages : groupMessages,
            );
          const messagesToSend =
            selectRecoverableRestartPendingMessages(filteredPending);
          const leadingSourceMessages = selectLeadingSourceTurnMessages(
            messagesToSend,
            chatJid,
          );
          if (leadingSourceMessages.length === 0) {
            logger.info(
              {
                chatJid,
                pendingCount: pendingMessages.length,
                fallbackCount: groupMessages.length,
              },
              'No current user messages available for active runner injection',
            );
            continue;
          }

          const messageLoopRuntimePolicy = resolvePrimaryRuntimeSessionPolicy({
            chatJid,
            folder: group.folder,
            messagesForAgent: leadingSourceMessages,
            sessions,
            loadSession: getSession,
          });
          if (!messageLoopRuntimePolicy.usePrimarySession) {
            if (messageLoopRuntimePolicy.ignorePreviousAssistantPromptSession) {
              clearPrimaryRuntimeSession(group.folder);
            }
            queue.enqueueMessageCheck(chatJid);
            recordLifecycleForMessages({
              messages: leadingSourceMessages,
              stage: 'queued',
              details: {
                route: 'message_loop',
                targetJid: chatJid,
                bypassedIpc: true,
                reason: messageLoopRuntimePolicy.reason,
              },
            });
            logger.warn(
              {
                chatJid,
                groupFolder: group.folder,
                reason: messageLoopRuntimePolicy.reason,
                ignoredSessionId:
                  messageLoopRuntimePolicy.currentPrimarySessionId ?? null,
                messageIds: leadingSourceMessages.map((message) => message.id),
              },
              'Bypassing active runner IPC for runtime session isolation',
            );
            continue;
          }

          // Home and non-home groups now share the same IPC injection path.
          // Reply routing is dynamically updated via activeRouteUpdaters when
          // the message is successfully injected, so we no longer need to kill
          // the process for home groups.

          const shared = !group.is_home && isGroupShared(group.folder);
          const compactedMessagesToSend = compactMessagesForAgent(
            leadingSourceMessages,
          );
          const formatted = formatMessages(compactedMessagesToSend, shared);

          const images = collectMessageImages(chatJid, compactedMessagesToSend);
          const imagesForAgent = images.length > 0 ? images : undefined;

          // Determine the IM source JID for route update on successful injection
          const lastSourceJidForRoute = resolveMessageSourceJid(
            leadingSourceMessages[0]!,
            chatJid,
          );

          const sendResult = queue.sendMessage(
            chatJid,
            formatted,
            imagesForAgent,
            () => {
              // IPC write succeeded — update reply route for the running agent
              activeRouteUpdaters.get(group.folder)?.(
                lastSourceJidForRoute,
                leadingSourceMessages,
              );
            },
            {
              timestamp:
                leadingSourceMessages[leadingSourceMessages.length - 1]!
                  .timestamp,
              id: leadingSourceMessages[leadingSourceMessages.length - 1]!.id,
            },
            lastSourceJidForRoute,
          );
          if (sendResult === 'sent') {
            recordLifecycleForMessages({
              messages: leadingSourceMessages,
              stage: 'queued',
              details: { route: 'ipc_injected', targetJid: chatJid },
            });
            logger.debug(
              {
                chatJid,
                count: messagesToSend.length,
                forwardedCount: compactedMessagesToSend.length,
                imageCount: images.length,
              },
              'Piped messages to active agent process',
            );
            const lastProcessed =
              leadingSourceMessages[leadingSourceMessages.length - 1];
            setLastAgentCursor(chatJid, {
              timestamp: lastProcessed.timestamp,
              id: lastProcessed.id,
            });
            queue.markIpcInjectedMessage(chatJid);
          } else {
            // no_active — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
            recordLifecycleForMessages({
              messages: leadingSourceMessages,
              stage: 'queued',
              details: { route: 'message_loop', targetJid: chatJid },
            });
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }

    stuckRunnerCheckCounter++;
    if (stuckRunnerCheckCounter >= STUCK_RUNNER_CHECK_INTERVAL_POLLS) {
      stuckRunnerCheckCounter = 0;
      recoverStuckPendingGroups();
    }

    await interruptibleSleep(POLL_INTERVAL);
  }
}

function recoverStuckPendingGroups(): void {
  const stuckGroups = queue.getStuckPendingGroups(STUCK_RUNNER_IDLE_MS);
  for (const { jid, idleMs } of stuckGroups) {
    logger.warn(
      { chatJid: jid, idleMs },
      'Runner has pending messages but no activity; restarting',
    );
    queue.restartGroup(jid).catch((err) => {
      logger.error(
        { chatJid: jid, err },
        'Failed to restart stuck runner with pending messages',
      );
    });
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 *
 * Uses `lastCommittedCursor` (updated only in commitCursor when an agent
 * actually finishes processing) rather than `lastAgentTimestamp` (which
 * advances when IPC injection succeeds).  This correctly detects messages
 * that were IPC-injected but never processed because the service was
 * killed before the agent could handle them.
 *
 * Pending messages resume against the saved runtime session. Cli Claw does not
 * inject DB history during recovery; continuity belongs to the runtime session.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceCursor = resolveStartupRecoveryCursor(chatJid, {
      accepted: lastAgentTimestamp,
      committed: lastCommittedCursor,
    });

    const pending = getMessagesSince(chatJid, sinceCursor);
    const recoverablePending = selectRecoverableRestartPendingMessages(pending);
    if (recoverablePending.length > 0) {
      logger.info(
        {
          group: group.name,
          pendingCount: recoverablePending.length,
          ignoredPendingCount: pending.length - recoverablePending.length,
        },
        'Recovery: found unprocessed messages',
      );
      recoveryGroups.add(chatJid);
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

export function recoverPendingMessagesForTests(): void {
  recoverPendingMessages();
}

/**
 * Startup recovery for conversation agents.
 * After restart, running conversation agents have dead processes.
 * Reset their status and re-trigger processing if they have pending messages.
 */
function recoverConversationAgents(): void {
  const agents = listActiveConversationAgents();
  if (agents.length === 0) return;

  logger.info(
    { count: agents.length },
    'Recovery: found active conversation agents from previous session',
  );

  for (const agent of agents) {
    try {
      const chatJid = agent.chat_jid;
      const agentId = agent.id;

      // Reset running → idle (process is dead)
      if (agent.status === 'running') {
        updateAgentStatus(agentId, 'idle');
        broadcastAgentStatus(
          chatJid,
          agentId,
          'idle',
          agent.name,
          agent.prompt,
          agent.result_summary ?? undefined,
          agent.kind,
        );
      }

      // Check for pending messages on the virtual JID
      const virtualChatJid = `${chatJid}#agent:${agentId}`;
      const sinceCursor = resolveConversationAgentRecoveryCursor(
        lastCommittedCursor,
        virtualChatJid,
      );
      if (!sinceCursor) {
        logger.info(
          { chatJid, agentId, virtualChatJid },
          'Recovery: skipping conversation agent without committed cursor',
        );
        continue;
      }
      const pending = getMessagesSince(virtualChatJid, sinceCursor);

      if (pending.length > 0) {
        logger.info(
          { agentId, agentName: agent.name, pendingCount: pending.length },
          'Recovery: re-triggering conversation agent with pending messages',
        );

        // Store a system notice so the user sees something in the chat
        const now = new Date().toISOString();
        const noticeId = `system-recover-${agentId}-${Date.now()}`;
        storeMessageDirect(
          noticeId,
          virtualChatJid,
          'system',
          ASSISTANT_NAME,
          '服务已重启，正在恢复上次未完成的任务...',
          now,
          true,
        );
        broadcastNewMessage(virtualChatJid, {
          id: noticeId,
          chat_jid: virtualChatJid,
          sender: 'system',
          sender_name: ASSISTANT_NAME,
          content: '服务已重启，正在恢复上次未完成的任务...',
          timestamp: now,
          is_from_me: true,
          source_jid: virtualChatJid,
        });

        // Enqueue the agent conversation for processing
        agentRecoveryVirtualJids.add(virtualChatJid);
        const taskId = `agent-recover:${agentId}:${Date.now()}`;
        queue.enqueueTask(virtualChatJid, taskId, async () => {
          await processAgentConversation(chatJid, agentId);
        });
      }
    } catch (err) {
      logger.error(
        { err, agentId: agent.id, groupFolder: agent.group_folder },
        'Recovery: failed to recover conversation agent, skipping',
      );
    }
  }
}

async function cleanupOrphanedAgentProcesses(): Promise<void> {
  // Kill orphaned agent-runner processes from previous runs.
  try {
    const { stdout: psOut } = await execFileAsync(
      'pgrep',
      ['-f', 'node.*container/agent-runner/dist/index\\.js'],
      { timeout: 5000 },
    );
    const pids = (typeof psOut === 'string' ? psOut : String(psOut))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((pid) => pid !== process.pid && !isNaN(pid));
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
    if (pids.length > 0) {
      logger.info(
        { count: pids.length, pids },
        'Killed orphaned agent-runner processes',
      );
    }
  } catch (err: any) {
    // pgrep exits 1 when no matches — that's fine
    if (err?.code !== 1) {
      logger.warn({ err }, 'Failed to clean up orphaned agent processes');
    }
  }
}

/**
 * Build the onNewChat callback for IM connections.
 * Feishu/Telegram chats auto-register to the user's home group folder.
 *
 * When the same IM app is transferred between users (e.g., admin disables
 * their channel and a member enables the same credentials), existing chats
 * are re-routed to the new user's home folder on first message receipt.
 *
 * In multi-bot setups where the same human talks to multiple bots (each owned
 * by a different cli-claw user), re-routing is skipped — the chat stays with
 * its original owner as long as that owner still has an active connection on
 * the **same channel type** (feishu/telegram/qq/wechat).
 */
function buildOnNewChat(
  userId: string,
  homeFolder: string,
): (chatJid: string, chatName: string) => void {
  return (chatJid, chatName) => {
    const existing = registeredGroups[chatJid];
    if (existing) {
      // Already owned by this user — nothing to do
      if (existing.created_by === userId) return;

      // Don't override groups with explicit IM routing configured.
      if (existing.target_agent_id || existing.target_main_jid) return;

      // Backfill missing created_by without changing folder binding.
      // Legacy IM groups may have NULL created_by after migration;
      // we should claim ownership but preserve the user's chosen folder.
      if (!existing.created_by) {
        existing.created_by = userId;
        setRegisteredGroup(chatJid, existing);
        registeredGroups[chatJid] = existing;
        logger.info(
          { chatJid, chatName, userId, folder: existing.folder },
          'Backfilled created_by for IM chat (preserved existing folder)',
        );
        return;
      }

      // Different user's connection now owns this IM app.
      // Two possible scenarios:
      //   1. Credential transfer: admin disables their Feishu channel, member
      //      enables the same appId → re-route chat to the new user.
      //   2. Multi-bot setup: same human talks to multiple bots, each owned by
      //      a different cli-claw user → do NOT re-route.
      //
      // Distinguish by checking whether the previous owner still has an active
      // connection on the SAME channel type.  Checking all channel types would
      // produce false positives (e.g., admin's Telegram is still online while
      // their Feishu app was transferred → skip re-route incorrectly).
      if (!existing.is_home) {
        const previousOwner = existing.created_by;
        const channelType = getChannelType(chatJid);
        const previousOwnerStillConnected = channelType
          ? imManager
              .getConnectedChannelTypes(previousOwner)
              .includes(channelType)
          : false;

        if (previousOwnerStillConnected) {
          // Multi-bot: previous owner still has the same channel type active
          logger.debug(
            {
              chatJid,
              chatName,
              userId,
              channelType,
              existingOwner: previousOwner,
              existingFolder: existing.folder,
            },
            'Skipped IM chat re-route (previous owner still connected on same channel type)',
          );
        } else {
          // Credential transfer: previous owner no longer connected on this channel
          const previousFolder = existing.folder;
          existing.folder = homeFolder;
          existing.created_by = userId;
          setRegisteredGroup(chatJid, existing);
          registeredGroups[chatJid] = existing;
          logger.info(
            {
              chatJid,
              chatName,
              userId,
              homeFolder,
              previousFolder,
              previousOwner,
              channelType,
            },
            'Re-routed IM chat to new user (IM credentials transferred)',
          );
        }
      }
      return;
    }
    registerGroup(chatJid, {
      name: chatName,
      folder: homeFolder,
      added_at: new Date().toISOString(),
      created_by: userId,
    });
    logger.info(
      { chatJid, chatName, userId, homeFolder },
      'Auto-registered IM chat',
    );
  };
}

/**
 * Build the onBotRemovedFromGroup callback.
 * When bot is removed from an IM group or the group is disbanded,
 * retire that IM source row while preserving workspace folders and history.
 */
function buildOnBotRemovedFromGroup(): (chatJid: string) => void {
  return (chatJid: string) => {
    if (!getChannelType(chatJid)) return;
    const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
    if (!group) return;

    const hadBinding = Boolean(group.target_agent_id || group.target_main_jid);
    if (hadBinding) {
      unbindImGroup(
        chatJid,
        'Auto-unbound IM group: bot removed or group disbanded',
      );
    }

    deleteRegisteredGroup(chatJid);
    delete registeredGroups[chatJid];
    imSendFailCounts.delete(chatJid);
    imHealthCheckFailCounts.delete(chatJid);
    logger.info(
      { chatJid, folder: group.folder, hadBinding },
      'Retired unavailable IM group source',
    );
  };
}

/**
 * Build Telegram-specific bot-added-to-group handler.
 * Auto-registers the group (via buildOnNewChat) then sends a welcome message
 * guiding the user to bind or create a workspace.
 */
function buildTelegramBotAddedHandler(
  userId: string,
  homeFolder: string,
): (chatJid: string, chatName: string) => void {
  const onNewChat = buildOnNewChat(userId, homeFolder);
  return (chatJid: string, chatName: string) => {
    onNewChat(chatJid, chatName);
    const welcome =
      `已加入「${chatName}」！当前绑定到默认工作区。\n\n` +
      `/new <名称> — 新建工作区并绑定此群\n` +
      `/bind <工作区> — 绑定到已有工作区\n` +
      `/list — 查看所有工作区\n\n` +
      `也可以直接发消息，我会在默认工作区回复。`;
    imManager
      .sendMessage(chatJid, welcome)
      .catch((err) =>
        logger.warn(
          { chatJid, err },
          'Failed to send Telegram group welcome message',
        ),
      );
  };
}

function buildIsChatAuthorized(userId: string): (jid: string) => boolean {
  return (jid) => {
    const group = registeredGroups[jid];
    return !!group && group.created_by === userId;
  };
}

function buildOnPairAttempt(
  userId: string,
): (jid: string, chatName: string, code: string) => Promise<boolean> {
  return async (jid, chatName, code) => {
    const result = verifyPairingCode(code);
    if (!result) return false;
    if (result.userId !== userId) return false;
    const pairingUserHome = getUserHomeGroup(result.userId);
    if (!pairingUserHome) return false;
    buildOnNewChat(result.userId, pairingUserHome.folder)(jid, chatName);
    return true;
  };
}

/**
 * Build callback that resolves an IM chatJid to a bound target JID.
 * Supports both conversation agent binding (target_agent_id) and
 * workspace main conversation binding (target_main_jid).
 * Returns null if the chatJid has no binding configured.
 */
function buildResolveEffectiveChatJid(): (
  chatJid: string,
) => { effectiveJid: string; agentId: string | null } | null {
  return (chatJid: string) => {
    const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
    if (!group) return null;

    // Agent binding takes priority
    if (group.target_agent_id) {
      const agent = getAgent(group.target_agent_id);
      if (!agent) return null;
      // Use the agent's actual chat_jid (the workspace's registered JID) as the
      // base for the virtual JID.  Previously we constructed web:${folder} which
      // doesn't match any registered group for non-main workspaces (folder ≠ JID).
      const effectiveJid = `${agent.chat_jid}#agent:${group.target_agent_id}`;
      return { effectiveJid, agentId: group.target_agent_id };
    }

    // Main conversation binding
    if (group.target_main_jid) {
      let effectiveJid = group.target_main_jid;
      // Legacy fallback: old bindings stored web:${folder} instead of actual JID.
      // Resolve to the real registered JID so messages are stored correctly.
      if (
        !registeredGroups[effectiveJid] &&
        !getRegisteredGroup(effectiveJid) &&
        effectiveJid.startsWith('web:')
      ) {
        const folder = effectiveJid.slice(4);
        const jids = getJidsByFolder(folder);
        for (const j of jids) {
          if (j.startsWith('web:')) {
            effectiveJid = j;
            break;
          }
        }
      }
      return { effectiveJid, agentId: null };
    }

    return null;
  };
}

/**
 * Build callback that triggers processAgentConversation when an IM message is routed to an agent.
 */
function buildOnAgentMessage(): (baseChatJid: string, agentId: string) => void {
  return (baseChatJid: string, agentId: string) => {
    const group =
      registeredGroups[baseChatJid] ?? getRegisteredGroup(baseChatJid);
    if (!group) {
      logger.warn({ baseChatJid, agentId });
      return;
    }

    // Use the agent's actual chat_jid (the workspace's registered JID) as the
    // base.  Previously we used web:${folder} which doesn't match any registered
    // group for non-main workspaces (their JID is web:{uuid}, not web:{folder}).
    const agent = getAgent(agentId);
    const homeChatJid = agent?.chat_jid || `web:${group.folder}`;
    const virtualChatJid = `${homeChatJid}#agent:${agentId}`;

    // Fetch pending messages
    const sinceCursor = lastAgentTimestamp[virtualChatJid] || EMPTY_CURSOR;
    const missedMessages = dropMessagesAtOrBeforeLatestInterruptedPartial(
      virtualChatJid,
      sinceCursor,
      getMessagesSince(virtualChatJid, sinceCursor),
    );

    // IM messages must force-restart the agent process so reply routing
    // (replySourceImJid) is recalculated from the latest batch.  This mirrors
    // the home-folder force-restart for the main conversation.
    const lastSourceJid = missedMessages[missedMessages.length - 1]?.source_jid;
    const isImSource =
      !!lastSourceJid && getChannelType(lastSourceJid) !== null;

    if (isImSource) {
      // Force close running process then enqueue fresh start.
      // Use a stable taskId so rapid-fire IM messages deduplicate into a
      // single queued restart instead of N separate restarts.
      logger.info({ virtualChatJid, taskId: `agent-im-restart:${agentId}` });
      queue.closeStdin(virtualChatJid);
      const taskId = `agent-im-restart:${agentId}`;
      logger.debug(
        { virtualChatJid, taskId },
        'Agent IM restart: closing stdin and enqueuing task',
      );
      queue.enqueueTask(virtualChatJid, taskId, async () => {
        logger.debug(
          { homeChatJid, agentId },
          'Agent IM restart: starting processAgentConversation',
        );
        logger.info(
          { homeChatJid, agentId, taskId },
          'sub-agent task IPC received',
        );
        try {
          await processAgentConversation(homeChatJid, agentId);
        } catch (err) {
          logger.error(
            { err, homeChatJid, agentId },
            'Agent IM restart: processAgentConversation failed',
          );
        }
      });
    } else {
      // Web-origin: try to pipe into running agent process
      logger.debug(
        {
          virtualChatJid,
          missedMessages: missedMessages.length,
          isImSource,
        },
        'Web-origin missed messages: attempting to pipe into running agent',
      );
      const messagesForAgent =
        missedMessages.length > 0
          ? selectLeadingSourceTurnMessages(missedMessages, virtualChatJid)
          : [];
      const formatted =
        missedMessages.length > 0
          ? formatMessages(messagesForAgent, false)
          : '';
      const images = collectMessageImages(virtualChatJid, messagesForAgent);
      const imagesForAgent = images.length > 0 ? images : undefined;
      const lastProcessed = messagesForAgent[messagesForAgent.length - 1];
      const currentTurnSourceJid = messagesForAgent[0]
        ? resolveMessageSourceJid(messagesForAgent[0], virtualChatJid)
        : virtualChatJid;

      const sendResult = formatted
        ? queue.sendMessage(
            virtualChatJid,
            formatted,
            imagesForAgent,
            undefined,
            lastProcessed
              ? {
                  timestamp: lastProcessed.timestamp,
                  id: lastProcessed.id,
                }
              : undefined,
            currentTurnSourceJid,
          )
        : 'no_active';
      if (sendResult === 'sent' && lastProcessed) {
        setLastAgentCursor(virtualChatJid, {
          timestamp: lastProcessed.timestamp,
          id: lastProcessed.id,
        });
        queue.markIpcInjectedMessage(virtualChatJid);
        if (messagesForAgent.length < missedMessages.length) {
          queue.enqueueTask(
            virtualChatJid,
            `agent-deferred:${agentId}:${lastProcessed.id}`,
            async () => {
              await processAgentConversation(homeChatJid, agentId);
            },
          );
        }
      }
      if (sendResult === 'no_active') {
        const taskId = `agent-conv:${agentId}:${Date.now()}`;
        queue.enqueueTask(virtualChatJid, taskId, async () => {
          await processAgentConversation(homeChatJid, agentId);
        });
      }
    }
    logger.info(
      {
        baseChatJid,
        homeChatJid,
        agentId,
        messageCount: missedMessages.length,
      },
      'IM message triggered agent conversation processing',
    );
  };
}

/**
 * Mention gating callback: when bot is NOT @mentioned in a group chat,
 * return true to process the message anyway, false to drop it.
 */
function shouldProcessGroupMessage(chatJid: string): boolean {
  const group = registeredGroups[chatJid] ?? getRegisteredGroup(chatJid);
  if (!group) return false;

  // activation_mode 直接存在 IM 群组自身的 registered_groups 记录上（绑定时设置），
  // 无需追溯 target_main_jid
  const mode = group.activation_mode ?? 'auto';

  switch (mode) {
    case 'always':
      return true; // 群聊不需要 @bot
    case 'when_mentioned':
      return false; // 必须 @bot
    case 'disabled':
      return false; // 忽略所有消息（在调用方处理 disabled 的 DM 忽略）
    case 'auto':
    default:
      // 兼容旧行为：require_mention defaults to false; if true → only process @mentions
      return group.require_mention !== true;
  }
}

/**
 * 飞书流式卡片按钮中断回调。
 * 仅由飞书卡片按钮触发，不涉及自动关键词检测。
 */
function handleCardInterrupt(chatJid: string): void {
  const interrupted = queue.interruptQuery(chatJid);
  if (interrupted) {
    logger.info({ chatJid }, 'Card interrupt: query interrupted');
  }

  const session = getStreamingSession(chatJid);
  if (session?.isActive()) {
    session.abort('用户中断').catch((err) => {
      logger.debug({ err, chatJid }, 'Failed to abort streaming card');
    });
  }
}

async function handleCardRuntimeUpdate(
  chatJid: string,
  update: {
    action: 'set_runtime_model' | 'set_runtime_effort' | 'set_runtime_speed';
    value: string;
  },
): Promise<string> {
  logger.info(
    {
      chatJid,
      action: update.action,
      value: update.value,
    },
    'Received Feishu runtime card update',
  );
  const result = await applyRuntimeWorkspaceSelection({
    chatJid,
    selection:
      update.action === 'set_runtime_model'
        ? 'model'
        : update.action === 'set_runtime_effort'
          ? 'effort'
          : 'speed',
    value: update.value,
    deps: {
      getGroup: (jid) => registeredGroups[jid] ?? getRegisteredGroup(jid),
      setGroup: (jid, group) => {
        setRegisteredGroup(jid, group);
        registeredGroups[jid] = group;
      },
      getSiblingJids: getJidsByFolder,
      getAgent,
      queue,
      getSessions: () => sessions,
    },
  });
  logger.info(
    {
      chatJid,
      action: update.action,
      value: update.value,
      handled: result.handled,
      reply: result.reply ?? null,
    },
    'Completed Feishu runtime card update',
  );

  return result.reply ?? '运行时更新失败，请稍后重试';
}

/**
 * Connect IM channels for a specific user via imManager.
 * Reads the user's IM config and connects if enabled.
 */
async function connectUserIMChannels(
  userId: string,
  homeFolder: string,
  feishuConfig?: FeishuConnectConfig | null,
  telegramConfig?: TelegramConnectConfig | null,
  qqConfig?: QQConnectConfig | null,
  wechatConfig?: WeChatConnectConfig | null,
  dingtalkConfig?: DingTalkConnectConfig | null,
  ignoreMessagesBefore?: number,
  startupBackfillIgnoreMessagesBefore?: number,
): Promise<{
  feishu: boolean;
  telegram: boolean;
  qq: boolean;
  wechat: boolean;
  dingtalk: boolean;
}> {
  const onNewChat = buildOnNewChat(userId, homeFolder);
  const resolveGroupFolder = (chatJid: string): string | undefined => {
    return resolveEffectiveFolder(chatJid);
  };
  const resolveEffectiveChatJid = buildResolveEffectiveChatJid();
  const onAgentMessage = buildOnAgentMessage();
  const onBotAddedToGroup = buildOnNewChat(userId, homeFolder); // reuse same logic: auto-register
  const onBotRemovedFromGroup = buildOnBotRemovedFromGroup();

  let feishu = false;
  let telegram = false;
  let qq = false;
  let wechat = false;
  let dingtalk = false;
  const startupBackfillChatIds = selectFeishuStartupBackfillChatIds(
    userId,
    getAllRegisteredGroups(),
  );

  if (
    feishuConfig &&
    feishuConfig.enabled !== false &&
    feishuConfig.appId &&
    feishuConfig.appSecret
  ) {
    feishu = await imManager.connectUserFeishu(
      userId,
      feishuConfig,
      onNewChat,
      {
        ignoreMessagesBefore,
        onCommand: handleCommand,
        resolveManagedCommandText: resolveManagedFeishuCommandText,
        resolveGroupFolder,
        resolveEffectiveChatJid,
        onAgentMessage,
        onBotAddedToGroup,
        onBotRemovedFromGroup,
        shouldProcessGroupMessage,
        onCardInterrupt: handleCardInterrupt,
        onCardRuntimeUpdate: handleCardRuntimeUpdate,
        startupBackfillChatIds,
        startupBackfillIgnoreMessagesBefore,
      },
    );
  }

  if (
    telegramConfig &&
    telegramConfig.enabled !== false &&
    telegramConfig.botToken
  ) {
    telegram = await imManager.connectUserTelegram(
      userId,
      telegramConfig,
      onNewChat,
      buildIsChatAuthorized(userId),
      buildOnPairAttempt(userId),
      {
        onCommand: handleCommand,
        ignoreMessagesBefore,
        resolveGroupFolder,
        resolveEffectiveChatJid,
        onAgentMessage,
        onBotAddedToGroup: buildTelegramBotAddedHandler(userId, homeFolder),
        onBotRemovedFromGroup,
      },
    );
  }

  if (
    qqConfig &&
    qqConfig.enabled !== false &&
    qqConfig.appId &&
    qqConfig.appSecret
  ) {
    qq = await imManager.connectUserQQ(
      userId,
      qqConfig,
      onNewChat,
      buildIsChatAuthorized(userId),
      buildOnPairAttempt(userId),
      {
        onCommand: handleCommand,
        resolveGroupFolder,
        resolveEffectiveChatJid,
        onAgentMessage,
      },
    );
  }

  if (
    wechatConfig &&
    wechatConfig.enabled !== false &&
    wechatConfig.botToken &&
    wechatConfig.ilinkBotId
  ) {
    wechat = await imManager.connectUserWeChat(
      userId,
      wechatConfig,
      onNewChat,
      {
        ignoreMessagesBefore,
        onCommand: handleCommand,
        resolveGroupFolder,
        resolveEffectiveChatJid,
        onAgentMessage,
      },
    );
  }

  if (
    dingtalkConfig &&
    dingtalkConfig.enabled !== false &&
    dingtalkConfig.clientId &&
    dingtalkConfig.clientSecret
  ) {
    dingtalk = await imManager.connectUserDingTalk(
      userId,
      dingtalkConfig,
      onNewChat,
      {
        ignoreMessagesBefore,
        onCommand: handleCommand,
        resolveGroupFolder,
        resolveEffectiveChatJid,
        onAgentMessage,
        onBotAddedToGroup,
        onBotRemovedFromGroup,
        shouldProcessGroupMessage,
      },
    );
  }

  return { feishu, telegram, qq, wechat, dingtalk };
}

export async function startCliClaw(
  options: {
    startupLaunchSpec?: StartupLaunchSpec;
  } = {},
): Promise<void> {
  const startupBackfillIgnoreMessagesBefore = Date.now();
  startupLaunchSpec =
    options.startupLaunchSpec || inferStartupLaunchSpecFromProcess();
  const launchdServiceName = resolveLaunchdServiceNameFromEnv();
  logger.info(
    {
      launchSource: startupLaunchSpec.source,
      launchRestartable: startupLaunchSpec.restartable,
      launchCommand: startupLaunchSpec.displayCommand,
      launchdServiceName,
    },
    'Resolved startup launch spec',
  );

  writeCurrentBackendRestartState({
    pid: process.pid,
    startedAt: getRuntimeBuildStatus().startedAt,
    appRoot: resolveAppPath(),
    port: WEB_PORT,
    launchSpec: startupLaunchSpec,
    launchdServiceName,
  });

  initDatabase();
  logger.info('Database initialized');

  // Clean up stale completed agents (task + spawn, older than 1 hour) to prevent DB bloat
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const cleaned = deleteCompletedAgents(oneHourAgo);
    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up stale completed agents');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up stale task agents');
  }

  // After process restart there cannot be truly running SDK tasks.
  // Mark all persisted running tasks as error to avoid stale "running" tabs.
  try {
    const marked = markAllRunningTaskAgentsAsError();
    if (marked > 0) {
      logger.warn(
        { marked },
        'Marked stale running task agents as error at startup',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to mark stale running tasks at startup');
  }

  // Spawn agents (from /sw) lose their in-memory task callbacks on restart.
  // Mark idle/running spawn agents as error so they don't render as "正在思考...".
  try {
    const marked = markStaleSpawnAgentsAsError();
    if (marked > 0) {
      logger.warn({ marked }, 'Marked stale spawn agents as error at startup');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to mark stale spawn agents at startup');
  }

  // WeChat iLink API domains bypass proxy (applied at startup, updated on config save)
  updateWeChatNoProxy(true);

  loadState();

  if (SELF_CHECK_MODE) {
    logger.info('CLI_CLAW_SELF_CHECK=1, skipping CLI launch cwd validation');
  } else {
    const launchCwdValidation = validateWorkspaceCwd(LAUNCH_CWD, {
      fieldLabel: 'CLI launch cwd',
    });
    if ('error' in launchCwdValidation) {
      logger.error(
        { launchCwd: LAUNCH_CWD, error: launchCwdValidation.error },
        'Invalid CLI launch cwd for workspace defaults',
      );
      throw new Error(launchCwdValidation.error);
    }
  }

  await cleanupStartupResidualRunners();

  // --- Channel reload helpers (hot-reload on config save) ---

  let feishuSyncInterval: ReturnType<typeof setInterval> | null = null;

  // Graceful shutdown handlers
  let shutdownInProgress = false;
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) {
      logger.warn('Force exit (second signal)');
      process.exit(1);
    }
    shutdownInProgress = true;
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received, cleaning up...');

    // Force exit after 30s if graceful shutdown hangs.
    // Must be longer than queue.shutdown() grace period (15s) plus container
    // force-stop time (~10s) to avoid killing the process while agents are
    // still shutting down gracefully.
    const forceExitTimer = setTimeout(() => {
      logger.warn('Graceful shutdown timed out, force exiting');
      process.exit(1);
    }, 30_000);
    forceExitTimer.unref();

    if (feishuSyncInterval) {
      clearInterval(feishuSyncInterval);
      feishuSyncInterval = null;
    }

    try {
      ipcWatcherManager?.closeAll();
    } catch (err) {
      logger.warn({ err }, 'Error closing IPC watchers');
    }

    // Stop periodic buffer, then persist streaming text to DB + clean buffer files.
    stopStreamingBuffer();
    await saveInterruptedStreamingMessages();

    // Run cleanup tasks concurrently with a tight timeout
    await Promise.allSettled([
      // Abort all active streaming cards before disconnecting IM,
      // so users see "服务维护中" instead of a stuck "生成中..." card.
      // Race with a 5s timeout to avoid a hung Feishu API blocking shutdown.
      Promise.race([
        abortAllStreamingSessions('服务维护中'),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]).catch((err) =>
        logger.warn({ err }, 'Error aborting streaming sessions'),
      ),
      imManager
        .disconnectAll()
        .catch((err) =>
          logger.warn({ err }, 'Error disconnecting IM connections'),
        ),
      shutdownWebServer().catch((err) =>
        logger.warn({ err }, 'Error shutting down web server'),
      ),
      queue
        .shutdown(15_000)
        .catch((err) => logger.warn({ err }, 'Error shutting down queue')),
    ]);

    clearTimeout(forceExitTimer);

    try {
      closeDatabase();
    } catch (err) {
      logger.warn({ err }, 'Error closing database');
    }

    logger.info('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Reload Feishu connection for a specific user (hot-reload on config save)
  const reloadFeishuConnection = async (config: {
    appId: string;
    appSecret: string;
    enabled?: boolean;
  }): Promise<boolean> => {
    // Find admin user's home folder (legacy global config routes to admin)
    const adminUsers = listUsers({
      status: 'active',
      role: 'admin',
      page: 1,
      pageSize: 1,
    }).users;
    const adminUser = adminUsers[0];
    if (!adminUser) {
      logger.warn('No admin user found for Feishu reload');
      return false;
    }

    // Disconnect existing admin Feishu connection
    await imManager.disconnectUserFeishu(adminUser.id);
    if (feishuSyncInterval) {
      clearInterval(feishuSyncInterval);
      feishuSyncInterval = null;
    }

    if (config.enabled !== false && config.appId && config.appSecret) {
      const homeGroup = getUserHomeGroup(adminUser.id);
      const homeFolder = homeGroup?.folder || MAIN_GROUP_FOLDER;
      const onNewChat = buildOnNewChat(adminUser.id, homeFolder);
      const connected = await imManager.connectUserFeishu(
        adminUser.id,
        config,
        onNewChat,
        {
          ignoreMessagesBefore: Date.now(),
          onCommand: handleCommand,
          onBotAddedToGroup: buildOnNewChat(adminUser.id, homeFolder),
          onBotRemovedFromGroup: buildOnBotRemovedFromGroup(),
          shouldProcessGroupMessage,
          onCardInterrupt: handleCardInterrupt,
        },
      );
      if (connected) {
        syncGroupMetadata().catch((err) =>
          logger.error({ err }, 'Group sync after Feishu reconnect failed'),
        );
        feishuSyncInterval = setInterval(() => {
          syncGroupMetadata().catch((err) =>
            logger.error({ err }, 'Periodic group sync failed'),
          );
        }, GROUP_SYNC_INTERVAL_MS);
      }
      return connected;
    }
    logger.info('Feishu channel disabled via hot-reload');
    return false;
  };

  const reloadTelegramConnection = async (config: {
    botToken: string;
    proxyUrl?: string;
    enabled?: boolean;
  }): Promise<boolean> => {
    // Find admin user
    const adminUsers = listUsers({
      status: 'active',
      role: 'admin',
      page: 1,
      pageSize: 1,
    }).users;
    const adminUser = adminUsers[0];
    if (!adminUser) {
      logger.warn('No admin user found for Telegram reload');
      return false;
    }

    await imManager.disconnectUserTelegram(adminUser.id);

    if (config.enabled !== false && config.botToken) {
      const homeGroup = getUserHomeGroup(adminUser.id);
      const homeFolder = homeGroup?.folder || MAIN_GROUP_FOLDER;
      const onNewChat = buildOnNewChat(adminUser.id, homeFolder);
      const connected = await imManager.connectUserTelegram(
        adminUser.id,
        config,
        onNewChat,
        buildIsChatAuthorized(adminUser.id),
        buildOnPairAttempt(adminUser.id),
        {
          onCommand: handleCommand,
          ignoreMessagesBefore: Date.now(),
          resolveGroupFolder: (chatJid) => resolveEffectiveFolder(chatJid),
          resolveEffectiveChatJid: buildResolveEffectiveChatJid(),
          onAgentMessage: buildOnAgentMessage(),
          onBotAddedToGroup: buildTelegramBotAddedHandler(
            adminUser.id,
            homeFolder,
          ),
          onBotRemovedFromGroup: buildOnBotRemovedFromGroup(),
        },
      );
      return connected;
    }
    logger.info('Telegram channel disabled via hot-reload');
    return false;
  };

  // Reload a per-user IM channel (hot-reload on user-im config save)
  const reloadUserIMConfig = async (
    userId: string,
    channel: 'feishu' | 'telegram' | 'qq' | 'wechat' | 'dingtalk',
  ): Promise<boolean> => {
    const homeGroup = getUserHomeGroup(userId);
    if (!homeGroup) {
      logger.warn(
        { userId, channel },
        'No home group found for user IM reload',
      );
      return false;
    }
    const homeFolder = homeGroup.folder;
    const onNewChat = buildOnNewChat(userId, homeFolder);
    const ignoreMessagesBefore = Date.now();

    if (channel === 'feishu') {
      await imManager.disconnectUserFeishu(userId);
      const config = getUserFeishuConfig(userId);
      if (
        config &&
        config.enabled !== false &&
        config.appId &&
        config.appSecret
      ) {
        const connected = await imManager.connectUserFeishu(
          userId,
          config,
          onNewChat,
          {
            ignoreMessagesBefore,
            onCommand: handleCommand,
            onBotAddedToGroup: buildOnNewChat(userId, homeFolder),
            onBotRemovedFromGroup: buildOnBotRemovedFromGroup(),
            shouldProcessGroupMessage,
            onCardInterrupt: handleCardInterrupt,
          },
        );
        logger.info(
          { userId, connected },
          'User Feishu connection hot-reloaded',
        );
        return connected;
      }
      logger.info({ userId }, 'User Feishu channel disabled via hot-reload');
      return false;
    } else if (channel === 'telegram') {
      await imManager.disconnectUserTelegram(userId);
      const config = getUserTelegramConfig(userId);
      const globalTelegramConfig = getTelegramProviderConfig();
      if (config && config.enabled !== false && config.botToken) {
        const connected = await imManager.connectUserTelegram(
          userId,
          {
            ...config,
            proxyUrl: config.proxyUrl || globalTelegramConfig.proxyUrl,
          },
          onNewChat,
          buildIsChatAuthorized(userId),
          buildOnPairAttempt(userId),
          {
            onCommand: handleCommand,
            ignoreMessagesBefore,
            resolveGroupFolder: (chatJid: string) =>
              resolveEffectiveFolder(chatJid),
            resolveEffectiveChatJid: buildResolveEffectiveChatJid(),
            onAgentMessage: buildOnAgentMessage(),
            onBotAddedToGroup: buildTelegramBotAddedHandler(userId, homeFolder),
            onBotRemovedFromGroup: buildOnBotRemovedFromGroup(),
          },
        );
        logger.info(
          { userId, connected },
          'User Telegram connection hot-reloaded',
        );
        return connected;
      }
      logger.info({ userId }, 'User Telegram channel disabled via hot-reload');
      return false;
    } else if (channel === 'qq') {
      await imManager.disconnectUserQQ(userId);
      const config = getUserQQConfig(userId);
      if (
        config &&
        config.enabled !== false &&
        config.appId &&
        config.appSecret
      ) {
        const connected = await imManager.connectUserQQ(
          userId,
          config,
          onNewChat,
          buildIsChatAuthorized(userId),
          buildOnPairAttempt(userId),
          {
            onCommand: handleCommand,
            resolveGroupFolder: (chatJid: string) =>
              resolveEffectiveFolder(chatJid),
            resolveEffectiveChatJid: buildResolveEffectiveChatJid(),
            onAgentMessage: buildOnAgentMessage(),
          },
        );
        logger.info({ userId, connected }, 'User QQ connection hot-reloaded');
        return connected;
      }
      logger.info({ userId }, 'User QQ channel disabled via hot-reload');
      return false;
    } else if (channel === 'dingtalk') {
      await imManager.disconnectUserDingTalk(userId);
      const config = getUserDingTalkConfig(userId);
      if (
        config &&
        config.enabled !== false &&
        config.clientId &&
        config.clientSecret
      ) {
        const connected = await imManager.connectUserDingTalk(
          userId,
          config,
          onNewChat,
          {
            ignoreMessagesBefore,
            onCommand: handleCommand,
            resolveGroupFolder: (chatJid: string) =>
              resolveEffectiveFolder(chatJid),
            resolveEffectiveChatJid: buildResolveEffectiveChatJid(),
            onAgentMessage: buildOnAgentMessage(),
            onBotAddedToGroup: buildOnNewChat(userId, homeFolder),
            onBotRemovedFromGroup: buildOnBotRemovedFromGroup(),
            shouldProcessGroupMessage,
          },
        );
        logger.info(
          { userId, connected },
          'User DingTalk connection hot-reloaded',
        );
        return connected;
      }
      logger.info({ userId }, 'User DingTalk channel disabled via hot-reload');
      return false;
    } else {
      // WeChat
      await imManager.disconnectUserWeChat(userId);
      const config = getUserWeChatConfig(userId);
      if (
        config &&
        config.enabled !== false &&
        config.botToken &&
        config.ilinkBotId
      ) {
        const connected = await imManager.connectUserWeChat(
          userId,
          {
            botToken: config.botToken,
            ilinkBotId: config.ilinkBotId,
            baseUrl: config.baseUrl,
            cdnBaseUrl: config.cdnBaseUrl,
            getUpdatesBuf: config.getUpdatesBuf,
          },
          onNewChat,
          {
            ignoreMessagesBefore: Date.now(),
            onCommand: handleCommand,
            resolveGroupFolder: (chatJid: string) =>
              resolveEffectiveFolder(chatJid),
            resolveEffectiveChatJid: buildResolveEffectiveChatJid(),
            onAgentMessage: buildOnAgentMessage(),
          },
        );
        logger.info(
          { userId, connected },
          'User WeChat connection hot-reloaded',
        );
        return connected;
      }
      logger.info({ userId }, 'User WeChat channel disabled via hot-reload');
      return false;
    }
  };

  // Start Web server early so frontend auth/API isn't blocked by Feishu readiness.
  startWebServer({
    queue,
    getRegisteredGroups: () => registeredGroups,
    getSessions: () => sessions,
    processGroupMessages,
    formatMessages,
    getLastAgentTimestamp: () => lastAgentTimestamp,
    advanceAcceptedCursor: setLastAgentCursor,
    setLastAgentTimestamp: setCursors,
    advanceGlobalCursor: (cursor: MessageCursor) => {
      if (isCursorAfter(cursor, globalMessageCursor)) {
        globalMessageCursor = cursor;
        saveState();
      }
    },
    reloadFeishuConnection,
    reloadTelegramConnection,
    reloadUserIMConfig,
    isFeishuConnected: () => imManager.isAnyFeishuConnected(),
    isTelegramConnected: () => imManager.isAnyTelegramConnected(),
    isUserFeishuConnected: (userId: string) =>
      imManager.isFeishuConnected(userId),
    isUserTelegramConnected: (userId: string) =>
      imManager.isTelegramConnected(userId),
    isUserQQConnected: (userId: string) => imManager.isQQConnected(userId),
    isUserWeChatConnected: (userId: string) =>
      imManager.isWeChatConnected(userId),
    isUserDingTalkConnected: (userId: string) =>
      imManager.isDingTalkConnected(userId),
    processAgentConversation,
    getFeishuChatInfo: (userId: string, chatId: string) =>
      imManager.getFeishuChatInfo(userId, chatId),
    clearImFailCounts: (jid: string) => {
      imHealthCheckFailCounts.delete(jid);
    },
    updateReplyRoute: (
      folder: string,
      sourceJid: string | null,
      lifecycleMessages?: NewMessage[],
    ) => {
      activeRouteUpdaters.get(folder)?.(sourceJid, lifecycleMessages);
    },
    shouldBypassActiveRuntimeIpc: ({ chatJid, groupFolder, messages }) => {
      const policy = resolvePrimaryRuntimeSessionPolicy({
        chatJid,
        folder: groupFolder,
        messagesForAgent: messages,
        sessions,
        loadSession: getSession,
      });
      if (!policy.usePrimarySession) {
        if (policy.ignorePreviousAssistantPromptSession) {
          clearPrimaryRuntimeSession(groupFolder);
        }
        return {
          bypass: true,
          reason: policy.reason,
          ignoredSessionId: policy.currentPrimarySessionId ?? null,
        };
      }
      return {
        bypass: false,
        reason: null,
        ignoredSessionId: null,
      };
    },
    handleSpawnCommand,
    handleWorkflowCommand: handleWorkflowSlashCommand,
  });

  // Clean expired sessions every hour
  setInterval(
    () => {
      try {
        const expiredIds = getExpiredSessionIds();
        for (const id of expiredIds) invalidateSessionCache(id);
        const deleted = deleteExpiredSessions();
        if (deleted > 0) {
          logger.info({ deleted }, 'Cleaned expired user sessions');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to clean expired sessions');
      }
    },
    60 * 60 * 1000,
  );

  // Periodically clean completed agents (task + spawn, every 10 minutes)
  setInterval(
    () => {
      try {
        const tenMinutesAgo = new Date(
          Date.now() - 10 * 60 * 1000,
        ).toISOString();
        const cleaned = deleteCompletedAgents(tenMinutesAgo);
        if (cleaned > 0) {
          logger.info(
            { cleaned },
            'Periodic cleanup: removed completed agents',
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Failed periodic task agent cleanup');
      }
    },
    10 * 60 * 1000,
  );

  // Billing: check expired subscriptions every hour
  setInterval(
    () => {
      checkAndExpireSubscriptions();
    },
    60 * 60 * 1000,
  );

  // Billing: reconcile monthly usage every 6 hours
  setInterval(
    () => {
      if (!isBillingEnabled()) return;
      try {
        const month = new Date().toISOString().slice(0, 7);
        // Reconcile all non-admin users with pagination
        let page = 1;
        const pageSize = 200;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const batch = listUsers({ status: 'active', pageSize, page });
          for (const u of batch.users) {
            if (u.role === 'admin') continue;
            reconcileMonthlyUsage(u.id, month);
          }
          if (batch.users.length < pageSize) break;
          page++;
        }
      } catch (err) {
        logger.error({ err }, 'Failed to run monthly usage reconciliation');
      }
    },
    6 * 60 * 60 * 1000,
  );

  // Billing: cleanup old daily_usage and billing_audit_log every 24 hours
  setInterval(
    () => {
      try {
        const deletedDaily = cleanupOldDailyUsage();
        const deletedAudit = cleanupOldBillingAuditLog();
        if (deletedDaily > 0 || deletedAudit > 0) {
          logger.info(
            { deletedDaily, deletedAudit },
            'Cleaned up old billing data',
          );
        }
      } catch (err) {
        logger.error({ err }, 'Failed to cleanup old billing data');
      }
    },
    24 * 60 * 60 * 1000,
  );

  // Skills auto-sync: periodically sync local skills to all admin users
  let skillAutoSyncTimer: ReturnType<typeof setInterval> | null = null;

  function startSkillAutoSync(): void {
    stopSkillAutoSync();
    const settings = getSystemSettings();
    if (!settings.skillAutoSyncEnabled) return;

    const intervalMs = settings.skillAutoSyncIntervalMinutes * 60 * 1000;
    logger.info(
      { intervalMinutes: settings.skillAutoSyncIntervalMinutes },
      'Starting skill auto-sync timer',
    );

    const runSync = async () => {
      const currentSettings = getSystemSettings();
      if (!currentSettings.skillAutoSyncEnabled) {
        stopSkillAutoSync();
        return;
      }

      try {
        const { users: adminUsers } = listUsers({
          role: 'admin',
          status: 'active',
        });
        for (const admin of adminUsers) {
          try {
            const result = await syncHostSkillsForUser(admin.id);
            const { added, updated, deleted } = result.stats;
            if (added > 0 || updated > 0 || deleted > 0) {
              logger.info(
                {
                  userId: admin.id,
                  username: admin.username,
                  ...result.stats,
                  total: result.total,
                },
                'Skill auto-sync completed with changes',
              );
            }
          } catch (err) {
            logger.warn(
              { err, userId: admin.id },
              'Skill auto-sync failed for user',
            );
          }
        }
      } catch (err) {
        logger.error({ err }, 'Skill auto-sync failed');
      }
    };

    // Run once immediately, then on interval
    void runSync();
    skillAutoSyncTimer = setInterval(() => void runSync(), intervalMs);
  }

  function stopSkillAutoSync(): void {
    if (skillAutoSyncTimer) {
      clearInterval(skillAutoSyncTimer);
      skillAutoSyncTimer = null;
    }
  }

  // Initial start + restart when settings change (check every 60s)
  const initSettings = getSystemSettings();
  let _lastSkillSyncEnabled: boolean = initSettings.skillAutoSyncEnabled;
  let _lastSkillSyncInterval: number =
    initSettings.skillAutoSyncIntervalMinutes;
  startSkillAutoSync();

  setInterval(() => {
    const settings = getSystemSettings();
    if (
      settings.skillAutoSyncEnabled !== _lastSkillSyncEnabled ||
      settings.skillAutoSyncIntervalMinutes !== _lastSkillSyncInterval
    ) {
      _lastSkillSyncEnabled = settings.skillAutoSyncEnabled;
      _lastSkillSyncInterval = settings.skillAutoSyncIntervalMinutes;
      startSkillAutoSync();
    }
  }, 60 * 1000);

  await cleanupOrphanedAgentProcesses();

  queue.setProcessMessagesFn(processGroupMessages);
  queue.setSerializationKeyResolver((groupJid: string) => {
    // Agent virtual JIDs: {chatJid}#agent:{agentId} → separate serialization key
    const agentSep = groupJid.indexOf('#agent:');
    if (agentSep >= 0) {
      const baseJid = groupJid.slice(0, agentSep);
      const agentId = groupJid.slice(agentSep + 7);
      const group = registeredGroups[baseJid];
      const folder = group?.folder || baseJid;
      return `${folder}#${agentId}`;
    }
    // Task virtual JIDs: {chatJid}#task:{taskId} → separate serialization key
    const taskSep = groupJid.indexOf('#task:');
    if (taskSep >= 0) {
      const baseJid = groupJid.slice(0, taskSep);
      const taskId = groupJid.slice(taskSep + 6);
      const group = registeredGroups[baseJid];
      return `${group?.folder || baseJid}#task:${taskId}`;
    }
    const group = registeredGroups[groupJid];
    return group?.folder || groupJid;
  });
  queue.setOnMaxRetriesExceeded((groupJid: string) => {
    const group = registeredGroups[groupJid];
    const name = group?.name || groupJid;
    const deadLetteredCount = recordDeadLetteredLifecycleForPendingMessages({
      chatJid: groupJid,
      cursor: lastAgentTimestamp[groupJid] || EMPTY_CURSOR,
      reason: 'max_retries_exceeded',
      details: { source: 'group_queue' },
    });
    if (deadLetteredCount > 0) {
      logger.warn(
        { groupJid, deadLetteredCount },
        'Recorded dead-lettered lifecycle events after queue max retries',
      );
    }
    sendSystemMessage(
      groupJid,
      'agent_max_retries',
      `${name} 处理失败，已达最大重试次数`,
    );
    setTyping(groupJid, false);
  });
  // Billing: user-level concurrent process limit
  queue.setUserConcurrentLimitChecker((groupJid: string) => {
    if (!isBillingEnabled()) return { allowed: true };
    const baseJid = stripVirtualJidSuffix(groupJid);
    const group = registeredGroups[baseJid];
    if (!group?.created_by) return { allowed: true };
    const owner = getUserById(group.created_by);
    if (!owner || owner.role === 'admin') return { allowed: true };
    const limit = getUserConcurrentProcessLimit(owner.id, owner.role);
    if (limit == null) return { allowed: true };
    // Count active processes for this user (including task virtual JIDs)
    let userActive = 0;
    for (const [jid, g] of Object.entries(registeredGroups)) {
      if (g.created_by !== owner.id) continue;
      if (queue.hasDirectActiveRunner(jid)) userActive++;
      userActive += queue.countActiveTaskRunners(jid);
    }
    return { allowed: userActive < limit };
  });
  // Recovery: when agent process exits with unconsumed IPC messages,
  // re-enqueue processAgentConversation to pick them up. See issue #240.
  queue.setOnUnconsumedAgentIpc((groupJid: string, agentId: string) => {
    // Extract base chat JID from virtual JID (e.g. web:main#agent:abc → web:main)
    const baseChatJid = groupJid.includes('#agent:')
      ? groupJid.split('#agent:')[0]
      : groupJid;
    const agent = getAgent(agentId);
    const homeChatJid = agent?.chat_jid || baseChatJid;
    const virtualChatJid = `${homeChatJid}#agent:${agentId}`;
    const taskId = `agent-ipc-recovery:${agentId}:${Date.now()}`;
    queue.enqueueTask(virtualChatJid, taskId, async () => {
      await processAgentConversation(homeChatJid, agentId);
    });
  });
  const schedulerDeps: import('./agent/scheduler/index.js').SchedulerDependencies =
    {
      registeredGroups: () => registeredGroups,
      getSessions: () => sessions,
      queue,
      onProcess: (
        groupJid,
        proc,
        processName,
        groupFolder,
        displayName,
        taskRunId,
      ) =>
        queue.registerProcess(
          groupJid,
          proc,
          processName,
          groupFolder,
          displayName,
          undefined, // agentId
          taskRunId,
        ),
      sendMessage,
      broadcastStreamEvent,
      onWorkspaceCreated: broadcastGroupCreated,
      assistantName: ASSISTANT_NAME,
    };
  startSchedulerLoop(schedulerDeps);

  // Inject triggerTaskRun into WebDeps (schedulerDeps must exist first)
  const webDeps = getWebDeps();
  if (webDeps) {
    webDeps.triggerTaskRun = (taskId: string) =>
      triggerTaskNow(taskId, schedulerDeps);
  }

  startIpcWatcher();
  recoverStreamingBuffer();
  startStreamingBuffer();

  if (SELF_CHECK_MODE) {
    logger.info('CLI_CLAW_SELF_CHECK=1, skipping IM channel connections');
    return;
  }

  // --- IM Connection Pool: connect per-user IM channels ---
  // Load global IM config (backward compat: used for admin if no per-user config exists)
  const globalFeishuConfig = getFeishuProviderConfigWithSource();
  const globalTelegramConfig = getTelegramProviderConfigWithSource();

  // Paginate through all active users (listUsers caps at 200 per page)
  let allActiveUsers: typeof listUsers extends (...args: any) => {
    users: infer U;
  }
    ? U
    : never = [];
  {
    let page = 1;
    while (true) {
      const result = listUsers({ status: 'active', page, pageSize: 200 });
      allActiveUsers = allActiveUsers.concat(result.users);
      if (allActiveUsers.length >= result.total) break;
      page++;
    }
  }

  // Register admin users for fallback IM routing
  for (const user of allActiveUsers) {
    if (user.role === 'admin') imManager.registerAdminUser(user.id);
  }

  let anyFeishuConnected = false;

  for (const user of allActiveUsers) {
    const homeGroup = getUserHomeGroup(user.id);
    if (!homeGroup) continue;

    // Per-user IM config takes precedence; fall back to global config for admin
    const userFeishu = getUserFeishuConfig(user.id);
    const userTelegram = getUserTelegramConfig(user.id);
    const userQQ = getUserQQConfig(user.id);
    const userWeChat = getUserWeChatConfig(user.id);
    const userDingTalk = getUserDingTalkConfig(user.id);

    // Determine effective Feishu config: per-user > global (admin only)
    let effectiveFeishu: FeishuConnectConfig | null = null;
    if (userFeishu && userFeishu.appId && userFeishu.appSecret) {
      effectiveFeishu = {
        appId: userFeishu.appId,
        appSecret: userFeishu.appSecret,
        enabled: userFeishu.enabled,
      };
    } else if (user.role === 'admin' && globalFeishuConfig.source !== 'none') {
      const gc = globalFeishuConfig.config;
      effectiveFeishu = {
        appId: gc.appId,
        appSecret: gc.appSecret,
        enabled: gc.enabled,
      };
    }

    // Determine effective Telegram config: per-user > global (admin only)
    let effectiveTelegram: TelegramConnectConfig | null = null;
    if (userTelegram && userTelegram.botToken) {
      effectiveTelegram = {
        botToken: userTelegram.botToken,
        proxyUrl: userTelegram.proxyUrl || globalTelegramConfig.config.proxyUrl,
        enabled: userTelegram.enabled,
      };
    } else if (
      user.role === 'admin' &&
      globalTelegramConfig.source !== 'none'
    ) {
      const gc = globalTelegramConfig.config;
      effectiveTelegram = {
        botToken: gc.botToken,
        proxyUrl: gc.proxyUrl,
        enabled: gc.enabled,
      };
    }

    // Determine effective QQ config: per-user only (no global fallback)
    let effectiveQQ: QQConnectConfig | null = null;
    if (userQQ && userQQ.appId && userQQ.appSecret) {
      effectiveQQ = {
        appId: userQQ.appId,
        appSecret: userQQ.appSecret,
        enabled: userQQ.enabled,
      };
    }

    // Determine effective WeChat config: per-user only (no global fallback)
    let effectiveWeChat: WeChatConnectConfig | null = null;
    if (userWeChat && userWeChat.botToken && userWeChat.ilinkBotId) {
      effectiveWeChat = {
        botToken: userWeChat.botToken,
        ilinkBotId: userWeChat.ilinkBotId,
        baseUrl: userWeChat.baseUrl,
        cdnBaseUrl: userWeChat.cdnBaseUrl,
        getUpdatesBuf: userWeChat.getUpdatesBuf,
        enabled: userWeChat.enabled,
      };
    }

    // Determine effective DingTalk config: per-user only (no global fallback)
    let effectiveDingTalk: DingTalkConnectConfig | null = null;
    if (userDingTalk && userDingTalk.clientId && userDingTalk.clientSecret) {
      effectiveDingTalk = {
        clientId: userDingTalk.clientId,
        clientSecret: userDingTalk.clientSecret,
        enabled: userDingTalk.enabled,
      };
    }

    if (
      !effectiveFeishu &&
      !effectiveTelegram &&
      !effectiveQQ &&
      !effectiveWeChat &&
      !effectiveDingTalk
    )
      continue;

    try {
      const result = await connectUserIMChannels(
        user.id,
        homeGroup.folder,
        effectiveFeishu,
        effectiveTelegram,
        effectiveQQ,
        effectiveWeChat,
        effectiveDingTalk,
        Date.now(),
        startupBackfillIgnoreMessagesBefore,
      );
      if (result.feishu) anyFeishuConnected = true;
      logger.info(
        {
          userId: user.id,
          feishu: result.feishu,
          telegram: result.telegram,
          qq: result.qq,
          wechat: result.wechat,
          dingtalk: result.dingtalk,
        },
        'User IM channels connected',
      );
    } catch (err) {
      logger.error(
        { userId: user.id, err },
        'Failed to connect user IM channels',
      );
    }
  }

  await notifyCompletedSelfRestartIntents();

  if (
    shouldStartStartupMessageRecovery({
      selfCheckMode: SELF_CHECK_MODE,
      imConnectionPhaseComplete: true,
    })
  ) {
    recoverPendingMessages();
    recoverConversationAgents();
    startMessageLoop();
  }

  // Start Feishu group sync if any connection is active
  if (anyFeishuConnected) {
    syncGroupMetadata().catch((err) =>
      logger.error({ err }, 'Initial group sync failed'),
    );
    feishuSyncInterval = setInterval(() => {
      syncGroupMetadata().catch((err) =>
        logger.error({ err }, 'Periodic group sync failed'),
      );
    }, GROUP_SYNC_INTERVAL_MS);
  } else if (
    globalFeishuConfig.config.enabled !== false &&
    globalFeishuConfig.source !== 'none'
  ) {
    logger.warn(
      'Feishu is not connected. Configure credentials in Settings to enable Feishu sync.',
    );
  }

  // Run health check once on startup to clean up orphaned bindings, then periodically
  void checkImBindingsHealth();
  const IM_BINDING_HEALTH_CHECK_INTERVAL = 30 * 60 * 1000; // 30 min
  setInterval(() => {
    void checkImBindingsHealth();
  }, IM_BINDING_HEALTH_CHECK_INTERVAL);
}

async function checkImBindingsHealth(): Promise<void> {
  const boundEntries: Array<{ jid: string; group: RegisteredGroup }> = [];
  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (group.target_agent_id || group.target_main_jid) {
      boundEntries.push({ jid, group });
    }
  }

  if (boundEntries.length === 0) return;
  logger.debug(
    { count: boundEntries.length },
    'Running IM binding health check',
  );

  for (const { jid, group } of boundEntries) {
    // Check for orphaned target_main_jid — target workspace no longer exists
    if (group.target_main_jid) {
      const targetGroup =
        registeredGroups[group.target_main_jid] ??
        getRegisteredGroup(group.target_main_jid);
      if (!targetGroup) {
        unbindImGroup(
          jid,
          `Orphaned main conversation binding: target ${group.target_main_jid} no longer exists`,
        );
        continue;
      }
    }

    // Check for orphaned target_agent_id — agent no longer exists
    if (group.target_agent_id) {
      const agent = getAgent(group.target_agent_id);
      if (!agent) {
        unbindImGroup(
          jid,
          `Orphaned agent binding: agent ${group.target_agent_id} no longer exists`,
        );
        continue;
      }
    }

    try {
      const info = await imManager.getChatInfo(jid);
      if (info === undefined) {
        // Channel doesn't support getChatInfo (e.g. Telegram, QQ) — skip reachability check
        continue;
      }
      if (info === null) {
        // Chat not reachable — could be temporary (connection down, API permission issue)
        const count = (imHealthCheckFailCounts.get(jid) ?? 0) + 1;
        imHealthCheckFailCounts.set(jid, count);
        if (count >= IM_HEALTH_CHECK_FAIL_THRESHOLD) {
          unbindImGroup(
            jid,
            'IM group not reachable after multiple checks, auto-unbinding',
          );
        } else {
          logger.debug(
            {
              jid,
              failCount: count,
              threshold: IM_HEALTH_CHECK_FAIL_THRESHOLD,
            },
            'IM health check failed, will retry before unbinding',
          );
        }
      } else {
        // Chat is reachable — reset failure counter
        imHealthCheckFailCounts.delete(jid);
      }
    } catch (err) {
      // API error — could be temporary, don't unbind on single failure
      logger.debug({ jid, err }, 'IM binding health check failed for group');
    }
  }
}

export const main = startCliClaw;

function isDirectExecution(moduleUrl: string): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  return moduleUrl === pathToFileURL(path.resolve(entryPath)).href;
}

if (isDirectExecution(import.meta.url)) {
  void startCliClaw().catch((err) => {
    logger.error({ err }, 'Failed to start cli-claw');
    process.exit(1);
  });
}
