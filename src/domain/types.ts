import type { StreamEvent } from '../presentation/stream-event.types.js';

/**
 * Workspace cwd allowlist - Security configuration for local workspaces
 * Stored at config/mount-allowlist.json in the project root.
 */
export interface MountAllowlist {
  // Directories that can be used as workspace roots
  allowedRoots: AllowedRoot[];
  // Path components that should never be used as workspace roots (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // Retained for config shape compatibility; local workspace cwd validation ignores it.
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write workspace operations are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export type AgentType = 'openai';

export interface RuntimeIdentity {
  agentType: AgentType;
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
  supportsReasoningEffort?: boolean | null;
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  added_at: string;
  agentType?: AgentType; // 默认 'openai'
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
  customCwd?: string; // 工作区执行目录（绝对路径）
  created_by?: string | null;
  is_home?: boolean; // 主工作区标记
  target_agent_id?: string; // legacy: IM 消息路由到指定内部任务线程 agent slot
  target_main_jid?: string; // legacy: IM 消息路由到指定工作区主线（web:{folder}）
  reply_policy?: 'source_only' | 'mirror'; // IM 入口回复策略
  require_mention?: boolean; // 群聊是否需要 @机器人 才响应（默认 false）
  activation_mode?: 'auto' | 'always' | 'when_mentioned' | 'disabled'; // 消息门控模式（默认 'auto'，兼容 require_mention）
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  source_jid?: string;
  runtime_identity?: RuntimeIdentity | null;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  attachments?: string;
  token_usage?: string;
  turn_id?: string | null;
  session_id?: string | null;
  sdk_message_uuid?: string | null;
  source_kind?: MessageSourceKind | null;
  finalization_reason?: MessageFinalizationReason | null;
}

export type ImMessageLifecycleStage =
  | 'received'
  | 'skipped'
  | 'stored'
  | 'notified'
  | 'queued'
  | 'runner_started'
  | 'stream_started'
  | 'finalized'
  | 'im_delivered'
  | 'cursor_committed'
  | 'dead_lettered';

export type ImMessageLifecycleStatus = 'ok' | 'skipped' | 'error';

export interface ImMessageLifecycleEvent {
  id: number;
  provider: string;
  chat_jid: string;
  source_jid: string | null;
  message_id: string;
  stage: ImMessageLifecycleStage;
  status: ImMessageLifecycleStatus;
  reason: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface RecordImMessageLifecycleEventInput {
  provider: string;
  chatJid: string;
  sourceJid?: string | null;
  messageId: string;
  stage: ImMessageLifecycleStage;
  status?: ImMessageLifecycleStatus;
  reason?: string | null;
  details?: Record<string, unknown> | null;
  createdAt?: string;
}

export type MessageSourceKind =
  | 'sdk_final'
  | 'sdk_send_message'
  | 'interrupt_partial'
  | 'overflow_partial'
  | 'user_command'
  | 'assistant_prompt'
  | 'scheduled_task_prompt'
  | 'legacy';

export type MessageFinalizationReason =
  | 'completed'
  | 'interrupted'
  | 'error'
  | 'shutdown'
  | 'crash_recovery';

export interface MessageAttachment {
  type: 'image';
  data: string; // base64 编码的图片数据
  mimeType?: string; // 如 'image/png'、'image/jpeg'
}

export interface MessageCursor {
  timestamp: string;
  id: string;
}

export interface MessageHistoryCursor {
  timestamp: string;
  chat_jid?: string;
  id?: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'isolated';
  execution_type: 'workflow';
  script_command: string | null;
  workspace_jid?: string | null;
  workspace_folder?: string | null;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed' | 'parsing';
  created_at: string;
  created_by?: string | null;
  notify_channels?: string[] | null;
}

export interface AccessSession {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  last_active_at: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'running' | 'success' | 'error';
  result: string | null;
  error: string | null;
}

export interface WorkflowDefinitionCache {
  folder: string;
  workflow_id: string;
  source_path: string;
  definition_json: Record<string, unknown>;
  checksum: string | null;
  updated_at: string;
}

export interface WorkflowContext {
  id: string;
  folder: string;
  workflow_id: string;
  thread_id: string;
  runtime_agent_id: string;
  active_run_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type WorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export interface WorkflowRun {
  id: string;
  context_id: string;
  folder: string;
  workflow_id: string;
  thread_id: string;
  trigger_chat_jid: string;
  trigger_message_id: string | null;
  trigger_user_id: string | null;
  prompt: string;
  status: WorkflowRunStatus;
  result: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkflowRunStepStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped';

export interface WorkflowRunStep {
  id: string;
  run_id: string;
  node_id: string;
  role_id: string | null;
  status: WorkflowRunStepStatus;
  attempt: number;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ThreadKind = 'main' | 'task' | 'workflow';
export type ThreadStatus = 'active' | 'archived';

export interface Thread {
  id: string;
  workspace_jid: string;
  kind: ThreadKind;
  title: string;
  runtime_agent_id: string | null;
  source_run_id: string | null;
  status: ThreadStatus;
  created_at: string;
  updated_at: string;
  last_active_at: string;
  archived_at: string | null;
}

export interface ImEntryRoute {
  im_jid: string;
  default_workspace_jid: string | null;
  active_workspace_jid: string | null;
  active_thread_id: string | null;
  active_until: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

// --- Sub-Agent types ---

export type AgentStatus = 'idle' | 'running' | 'completed' | 'error';
export type AgentKind = 'task' | 'conversation' | 'spawn';

export interface SubAgent {
  id: string;
  group_folder: string;
  chat_jid: string;
  name: string;
  prompt: string;
  status: AgentStatus;
  kind: AgentKind;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  result_summary: string | null;
  last_im_jid: string | null;
  /** 发起 /spawn 命令的源会话 JID，用于完成后结果回注 */
  spawned_from_jid: string | null;
}

// WebSocket message types
export type WsMessageOut =
  | {
      type: 'new_message';
      chatJid: string;
      message: NewMessage & { is_from_me: boolean };
      agentId?: string;
      source?: string;
    }
  | {
      type: 'agent_reply';
      chatJid: string;
      text: string;
      timestamp: string;
      agentId?: string;
    }
  | { type: 'typing'; chatJid: string; isTyping: boolean; agentId?: string }
  | {
      type: 'status_update';
      activeProcesses: number;
      activeTotal: number;
      queueLength: number;
    }
  | {
      type: 'stream_event';
      chatJid: string;
      event: StreamEvent;
      agentId?: string;
    }
  | {
      type: 'agent_status';
      chatJid: string;
      agentId: string;
      status: AgentStatus;
      kind?: AgentKind;
      name: string;
      prompt: string;
      resultSummary?: string;
    }
  | {
      type: 'runner_state';
      chatJid: string;
      state: 'idle' | 'running';
    }
  | {
      type: 'task_state';
      chatJid: string;
      taskId: string;
      status: 'running' | 'completed' | 'error';
      name: string;
      prompt: string;
      resultSummary?: string;
      kind?: AgentKind;
    }
  | { type: 'group_created'; jid: string; folder: string; name: string }
  | { type: 'ws_error'; error: string; chatJid?: string }
  | {
      type: 'stream_snapshot';
      chatJid: string;
      snapshot: {
        partialText: string;
        commentaryText?: string;
        activeTools: Array<{
          toolName: string;
          toolUseId: string;
          startTime: number;
          toolInputSummary?: string;
          parentToolUseId?: string | null;
        }>;
        recentEvents: Array<{
          id: string;
          timestamp: number;
          text: string;
          kind: 'tool' | 'skill' | 'hook' | 'status';
        }>;
        todos?: Array<{ id: string; content: string; status: string }>;
        systemStatus: string | null;
        turnId?: string;
        sessionId?: string;
        runtimeIdentity?: RuntimeIdentity | null;
      };
    };

export type WsMessageIn = {
  type: 'send_message';
  chatJid: string;
  content: string;
  attachments?: MessageAttachment[];
  agentId?: string;
};

// --- Streaming event types (canonical source: shared/stream-event.ts) ---
export type { StreamEventType } from '../presentation/stream-event.types.js';
export type { StreamEvent };
