import { getChannelFromJid } from './channel-prefixes.js';
import { getMessagesSince, recordImMessageLifecycleEvent } from './db.js';
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
