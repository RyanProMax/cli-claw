interface MessageHistoryCursorSource {
  id: string;
  chat_jid: string;
  timestamp: string;
}

export function setHistoryCursorParams(
  params: URLSearchParams,
  prefix: 'before' | 'after',
  message?: MessageHistoryCursorSource | null,
): void {
  if (!message) return;
  params.set(prefix, message.timestamp);
  params.set(`${prefix}_id`, message.id);
  params.set(`${prefix}_chat_jid`, message.chat_jid);
}
