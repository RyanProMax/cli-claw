/**
 * Canonical StreamEvent type definitions.
 *
 * This is the single source of truth.
 * Build step compiles this file to shared/dist/stream-event.{js,d.ts},
 * and each runtime consumes those types through thin local wrappers.
 */

export type StreamEventType =
  | 'text_delta' | 'thinking_delta'
  | 'tool_use_start' | 'tool_use_end' | 'tool_progress'
  | 'hook_started' | 'hook_progress' | 'hook_response'
  | 'task_start' | 'task_notification'
  | 'todo_update'
  | 'usage'
  | 'status' | 'init';

export interface StreamRuntimeIdentity {
  agentType: 'claude' | 'codex';
  model?: string | null;
  reasoningEffort?: string | null;
  supportsReasoningEffort?: boolean | null;
}

export interface StreamEvent {
  eventType: StreamEventType;
  /** Correlates all stream events for a single user turn. */
  turnId?: string;
  /** SDK session identifier if known. */
  sessionId?: string;
  /** SDK message uuid if known. */
  messageUuid?: string;
  /** Reserved — whether this event was synthesized locally rather than emitted directly by SDK semantics. */
  isSynthetic?: boolean;
  text?: string;
  toolName?: string;
  toolUseId?: string;
  parentToolUseId?: string | null;
  isNested?: boolean;
  skillName?: string;
  toolInputSummary?: string;
  elapsedSeconds?: number;
  hookName?: string;
  hookEvent?: string;
  hookOutcome?: string;
  statusText?: string;
  taskDescription?: string;
  taskId?: string;
  taskStatus?: string;
  taskSummary?: string;
  isBackground?: boolean;
  isTeammate?: boolean;
  runtimeIdentity?: StreamRuntimeIdentity | null;
  toolInput?: Record<string, unknown>;
  todos?: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  /** Token usage data emitted at query completion */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
    durationMs: number;
    numTurns: number;
    modelUsage?: Record<string, { inputTokens: number; outputTokens: number; costUSD: number }>;
  };
}
