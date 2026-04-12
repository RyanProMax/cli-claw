export interface CompactableMessage {
  id?: string;
  sender?: string;
  sender_name?: string;
  content: string;
  timestamp?: string;
  is_from_me?: boolean;
}

export interface CompactMessageOptions {
  maxMessages?: number;
  maxTotalChars?: number;
  maxCharsPerMessage?: number;
}

const DEFAULT_MAX_MESSAGES = 12;
const DEFAULT_MAX_TOTAL_CHARS = 8_000;
const DEFAULT_MAX_CHARS_PER_MESSAGE = 1_200;

function positiveInt(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function cleanContent(content: string): string {
  return content
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function truncateContent(content: string, maxChars: number): string {
  const cleaned = cleanContent(content);
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}…`;
}

export function compactMessagesForAgent<T extends CompactableMessage>(
  messages: T[],
  options: CompactMessageOptions = {},
): T[] {
  const maxMessages = positiveInt(options.maxMessages, DEFAULT_MAX_MESSAGES);
  const maxTotalChars = positiveInt(
    options.maxTotalChars,
    DEFAULT_MAX_TOTAL_CHARS,
  );
  const maxCharsPerMessage = positiveInt(
    options.maxCharsPerMessage,
    DEFAULT_MAX_CHARS_PER_MESSAGE,
  );
  const perMessageLimit = Math.min(maxCharsPerMessage, maxTotalChars);

  const selected: T[] = [];
  let totalChars = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (selected.length >= maxMessages) break;

    const compactContent = truncateContent(
      messages[i].content,
      perMessageLimit,
    );
    const nextTotal = totalChars + compactContent.length;
    if (selected.length > 0 && nextTotal > maxTotalChars) break;

    selected.push({
      ...messages[i],
      content: compactContent,
    });
    totalChars = nextTotal;
  }

  return selected.reverse();
}

export function buildRecoveryContext(
  messages: CompactableMessage[],
  options: CompactMessageOptions = {},
): string {
  const maxMessages = positiveInt(options.maxMessages, 6);
  const maxCharsPerMessage = positiveInt(options.maxCharsPerMessage, 160);
  const compacted = compactMessagesForAgent(messages, {
    maxMessages,
    maxCharsPerMessage,
    maxTotalChars: maxMessages * (maxCharsPerMessage + 1),
  });

  if (compacted.length === 0) return '';

  const lines = compacted.map((message) => {
    const role = message.is_from_me
      ? 'assistant'
      : message.sender_name || message.sender || 'user';
    return `[${role}] ${message.content}`;
  });

  return [
    '<system_context>',
    '服务刚重启，当前为新会话。以下是压缩后的最近对话记录，仅供恢复上下文：',
    '',
    ...lines,
    '</system_context>',
  ].join('\n');
}
