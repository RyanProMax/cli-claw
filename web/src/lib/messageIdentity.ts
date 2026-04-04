import type { Message } from '../stores/chat';

export function getMessageIdentityKey(
  message: Pick<Message, 'chat_jid' | 'id'>,
): string {
  return `${message.chat_jid}::${message.id}`;
}

export function mergeMessagesChronologically(
  existing: Message[],
  incoming: Message[],
): Message[] {
  const byKey = new Map<string, Message>();

  for (const message of existing) {
    byKey.set(getMessageIdentityKey(message), message);
  }

  for (const message of incoming) {
    const key = getMessageIdentityKey(message);
    const old = byKey.get(key);
    if (
      !old ||
      old.content !== message.content ||
      old.timestamp !== message.timestamp ||
      old.attachments !== message.attachments ||
      old.source_jid !== message.source_jid ||
      old.token_usage !== message.token_usage ||
      JSON.stringify(old.runtime_identity ?? null) !==
        JSON.stringify(message.runtime_identity ?? null) ||
      old.turn_id !== message.turn_id ||
      old.session_id !== message.session_id ||
      old.sdk_message_uuid !== message.sdk_message_uuid ||
      old.source_kind !== message.source_kind ||
      old.finalization_reason !== message.finalization_reason
    ) {
      byKey.set(key, message);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.timestamp === b.timestamp) {
      return getMessageIdentityKey(a).localeCompare(getMessageIdentityKey(b));
    }
    return a.timestamp.localeCompare(b.timestamp);
  });
}
