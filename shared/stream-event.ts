/**
 * Canonical StreamEvent type definitions.
 *
 * This is the single source of truth.
 * Build step compiles this file to shared/dist/stream-event.{js,d.ts},
 * and each runtime consumes those types through thin local wrappers.
 */

export type StreamEventType =
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_use_start'
  | 'tool_use_end'
  | 'tool_progress'
  | 'hook_started'
  | 'hook_progress'
  | 'hook_response'
  | 'task_start'
  | 'task_notification'
  | 'todo_update'
  | 'usage'
  | 'status'
  | 'init';

export interface StreamRuntimeIdentity {
  agentType: 'claude' | 'codex';
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
  supportsReasoningEffort?: boolean | null;
}

export interface StreamEvent {
  eventType: StreamEventType;
  /** Correlates all stream events for a single user turn. */
  turnId?: string;
  /** SDK session identifier if known. */
  sessionId?: string;
  /** Source-message cursor for an IPC-drained query turn, when known. */
  messageCursor?: { timestamp: string; id?: string };
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
  todos?: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
  /** Token usage data emitted at query completion */
  usage?: {
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
}

export interface StreamTextDeltaAccumulator {
  text: string;
  lastMessageUuid?: string;
}

function hasTrailingBlankBlock(text: string): boolean {
  return /\n\s*\n$/.test(text);
}

function getMessageBoundarySeparator(text: string): string {
  if (!text) return '';
  if (hasTrailingBlankBlock(text)) return '';
  if (text.endsWith('\n')) return '\n';
  return '\n\n';
}

/**
 * Append a streamed text delta while preserving intra-turn assistant message boundaries.
 *
 * Codex commentary can arrive as multiple assistant messages inside the same turn.
 * When the message UUID changes, keep a blank-line separator so downstream
 * renderers do not jam distinct updates together.
 */
export function appendStreamTextDelta(
  currentText: string,
  event: Pick<StreamEvent, 'text' | 'messageUuid'>,
  previousMessageUuid?: string,
): StreamTextDeltaAccumulator {
  const deltaText = event.text || '';
  if (!deltaText) {
    return {
      text: currentText,
      lastMessageUuid: previousMessageUuid,
    };
  }

  const nextMessageUuid = event.messageUuid || previousMessageUuid;
  const needsBoundary =
    !!currentText &&
    !!previousMessageUuid &&
    !!event.messageUuid &&
    previousMessageUuid !== event.messageUuid;

  return {
    text:
      currentText +
      (needsBoundary ? getMessageBoundarySeparator(currentText) : '') +
      deltaText,
    lastMessageUuid: nextMessageUuid,
  };
}
