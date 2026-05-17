/**
 * Shared types for cli-claw Agent Runner.
 *
 * These types are used across the OpenAI/Codex agent runner.
 */

// Streaming event types (canonical source: shared/stream-event.ts)
export type { StreamEventType, StreamEvent } from './stream-event.types.js';
import type {
  StreamEvent,
  StreamRuntimeIdentity,
} from './stream-event.types.js';

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  turnId?: string;
  messageCursor?: { timestamp: string; id?: string };
  groupFolder: string;
  chatJid: string;
  agentType?: 'openai';
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
  /** @deprecated Use isHome + isAdminHome instead. Kept for backward compatibility with older host processes. */
  isMain?: boolean;
  /** Whether this is the user's home container (admin or member). */
  isHome?: boolean;
  /** Whether this is the admin's home container (full privileges). */
  isAdminHome?: boolean;
  isScheduledTask?: boolean;
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
  runtimeIdentity?: StreamRuntimeIdentity | null;
  streamEvent?: StreamEvent;
  turnId?: string;
  sessionId?: string;
  sdkMessageUuid?: string;
  sourceKind?:
    | 'sdk_final'
    | 'sdk_send_message'
    | 'interrupt_partial'
    | 'overflow_partial'
    | 'legacy';
  finalizationReason?: 'completed' | 'interrupted' | 'error';
}

export type ImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';
