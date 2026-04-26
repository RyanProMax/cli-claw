import { getChannelFromJid } from './channel-prefixes.js';
import { getMessagesSince, recordImMessageLifecycleEvent } from './db.js';
import type { StreamEvent } from './stream-event.types.js';
import type {
  ImMessageLifecycleStage,
  ImMessageLifecycleStatus,
  MessageCursor,
  NewMessage,
} from './types.js';

export interface RecordLifecycleForMessagesOptions {
  messages: NewMessage[];
  stage: ImMessageLifecycleStage;
  status?: ImMessageLifecycleStatus;
  reason?: string | null;
  details?: Record<string, unknown> | null;
}

export function recordLifecycleForMessages({
  messages,
  stage,
  status = 'ok',
  reason = null,
  details = null,
}: RecordLifecycleForMessagesOptions): number {
  let recorded = 0;
  for (const message of messages) {
    const sourceJid = message.source_jid || message.chat_jid;
    const provider = getChannelFromJid(sourceJid);
    if (provider !== 'feishu') continue;

    try {
      recordImMessageLifecycleEvent({
        provider,
        chatJid: message.chat_jid,
        sourceJid,
        messageId: message.id,
        stage,
        status,
        reason,
        details,
      });
      recorded++;
    } catch {
      continue;
    }
  }
  return recorded;
}

export interface RecordDeadLetteredLifecycleForPendingMessagesOptions {
  chatJid: string;
  cursor: MessageCursor;
  reason: string;
  details?: Record<string, unknown> | null;
  getPendingMessages?: (chatJid: string, cursor: MessageCursor) => NewMessage[];
}

export function recordDeadLetteredLifecycleForPendingMessages({
  chatJid,
  cursor,
  reason,
  details = null,
  getPendingMessages = getMessagesSince,
}: RecordDeadLetteredLifecycleForPendingMessagesOptions): number {
  let messages: NewMessage[];
  try {
    messages = getPendingMessages(chatJid, cursor);
  } catch {
    return 0;
  }

  return recordLifecycleForMessages({
    messages,
    stage: 'dead_lettered',
    status: 'error',
    reason,
    details,
  });
}

export interface RecordStreamStartedLifecycleForMessagesOptions {
  messages: NewMessage[];
  streamEvent: Pick<
    StreamEvent,
    'eventType' | 'turnId' | 'sessionId' | 'messageCursor'
  >;
  details?: Record<string, unknown> | null;
}

export function recordStreamStartedLifecycleForMessages({
  messages,
  streamEvent,
  details = null,
}: RecordStreamStartedLifecycleForMessagesOptions): number {
  if (streamEvent.eventType !== 'init') return 0;
  const cursor = streamEvent.messageCursor
    ? {
        timestamp: streamEvent.messageCursor.timestamp,
        id: streamEvent.messageCursor.id ?? '',
      }
    : undefined;

  return recordLifecycleForMessages({
    messages,
    stage: 'stream_started',
    details: {
      ...(details ?? {}),
      turnId: streamEvent.turnId,
      sessionId: streamEvent.sessionId,
      ...(cursor ? { cursor } : {}),
    },
  });
}

export type DirectImDeliveryKind = 'direct_image' | 'direct_file';

export interface RecordDirectImDeliveryLifecycleForMessagesOptions {
  messages: NewMessage[];
  delivery: DirectImDeliveryKind;
  targetJid?: string | null;
  sent: boolean | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
}

export function recordDirectImDeliveryLifecycleForMessages({
  messages,
  delivery,
  targetJid = null,
  sent,
  reason,
  details = null,
}: RecordDirectImDeliveryLifecycleForMessagesOptions): number {
  const status: ImMessageLifecycleStatus =
    sent === null ? 'skipped' : sent ? 'ok' : 'error';
  const resolvedReason =
    reason ??
    (sent === null ? 'no_im_route' : sent ? null : 'send_failed_after_retries');

  return recordLifecycleForMessages({
    messages,
    stage: 'im_delivered',
    status,
    reason: resolvedReason,
    details: {
      delivery,
      ...(targetJid ? { targetJid } : {}),
      ...(details ?? {}),
    },
  });
}
