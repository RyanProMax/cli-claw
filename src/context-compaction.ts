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

export interface RecentTurnMessageOptions {
  maxInterMessageGapMs?: number;
}

const DEFAULT_MAX_MESSAGES = 12;
const DEFAULT_MAX_TOTAL_CHARS = 8_000;
const DEFAULT_MAX_CHARS_PER_MESSAGE = 1_200;
const DEFAULT_MAX_INTER_MESSAGE_GAP_MS = 2 * 60 * 60 * 1000;

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

function timestampToMs(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

export function selectRecentTurnMessages<T extends CompactableMessage>(
  messages: T[],
  options: RecentTurnMessageOptions = {},
): T[] {
  if (messages.length <= 1) return messages.slice();

  const maxInterMessageGapMs = positiveInt(
    options.maxInterMessageGapMs,
    DEFAULT_MAX_INTER_MESSAGE_GAP_MS,
  );
  let startIndex = messages.length - 1;

  for (let i = messages.length - 1; i > 0; i -= 1) {
    const newer = timestampToMs(messages[i].timestamp);
    const older = timestampToMs(messages[i - 1].timestamp);

    if (newer === null || older === null) {
      startIndex = i - 1;
      continue;
    }

    if (newer - older > maxInterMessageGapMs) break;
    startIndex = i - 1;
  }

  return messages.slice(startIndex);
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
