import { getChannelFromJid } from './channel-prefixes.js';
import { recordImMessageLifecycleEvent } from './db.js';
import type {
  ImMessageLifecycleStage,
  ImMessageLifecycleStatus,
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
