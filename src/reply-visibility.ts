interface ReplyVisibilityPresentationText {
  answerText?: string;
  commentaryText?: string;
}

interface ReplyVisibilityRuntimeIdentity {
  agentType?: string | null;
}

export interface ResolvedVisibleReplyParts {
  visibleText: string;
  commentaryText: string;
  droppedPresentationAnswer?: boolean;
}

const INTERNAL_CONTEXT_SUPPRESSED_REPLY =
  '内部上下文已拦截。请重新发送当前请求。';

const INTERNAL_XML_BLOCK_PATTERNS: RegExp[] = [
  /<reply-policy>[\s\S]*?<\/reply-policy>\s*/gi,
  /<messages>[\s\S]*?<\/messages>\s*/gi,
  /<user-message>[\s\S]*?<\/user-message>\s*/gi,
  /<system_context>[\s\S]*?<\/system_context>\s*/gi,
  /<environment_context>[\s\S]*?<\/environment_context>\s*/gi,
];

const INTERNAL_CONTEXT_MARKERS: RegExp[] = [
  /<message\s+sender=/i,
  /Knowledge cutoff:/i,
  /Current date:/i,
  /Need continue from interrupted state/i,
  /Important current conclusion:/i,
  /Relevant code just inspected:/i,
  /Potential fix direction:/i,
  /Final response should/i,
  /Current user asks:/i,
  /The user(?:'s)? latest question:/i,
];

function containsInternalContextMarker(value: string): boolean {
  return INTERNAL_CONTEXT_MARKERS.some((pattern) => pattern.test(value));
}

function looksLikeInternalSummaryLine(line: string): boolean {
  const normalized = line.trim();
  return /^(Need continue from|Important current conclusion|Relevant code just inspected|Potential fix direction|Current user asks|The user(?:'s)? latest question|Final response should|Need not run|No code changes yet|Current uncommitted status)/i.test(
    normalized,
  );
}

function looksLikeVisibleAnswerStart(
  line: string,
  afterInternalSummary = false,
): boolean {
  const normalized = line.trim();
  if (!normalized) return false;
  if (looksLikeInternalSummaryLine(normalized)) return false;
  if (afterInternalSummary && /^[-*]\s+/.test(normalized)) return false;
  return /^(#{1,6}\s+\S|\*\*[^*]+\*\*|[-*]\s+|\d+\.\s+|[\u4e00-\u9fffA-Za-z0-9].*[：:])/.test(
    normalized,
  );
}

function stripLeadingInternalSummary(value: string): string {
  const lines = value.split('\n');
  const firstContentIndex = lines.findIndex((line) => line.trim());
  if (firstContentIndex < 0) return value;
  if (!looksLikeInternalSummaryLine(lines[firstContentIndex]!)) return value;

  const answerStartIndex = lines.findIndex(
    (line, index) =>
      index > firstContentIndex && looksLikeVisibleAnswerStart(line, true),
  );
  if (answerStartIndex < 0) return '';
  return lines.slice(answerStartIndex).join('\n').trim();
}

function sanitizeInternalContextLeak(value: string): string {
  let sanitized = value;
  for (const pattern of INTERNAL_XML_BLOCK_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  sanitized = stripLeadingInternalSummary(sanitized).trim();

  if (!containsInternalContextMarker(value)) return sanitized || value;
  if (!sanitized || containsInternalContextMarker(sanitized)) {
    return INTERNAL_CONTEXT_SUPPRESSED_REPLY;
  }
  return sanitized;
}

function normalizeReplyText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function startsLikeProcessCommentary(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  return /^(我(先|会|按|来|继续|已经|正在|把)|先|接下来|当前|正在|已|I(?:'ll| will| am|’ll)\b)/i.test(
    normalized,
  );
}

function looksLikeProcessCommentaryPrefix(prefix: string): boolean {
  const normalized = prefix.trim();
  if (normalized.length > 500) return false;
  return startsLikeProcessCommentary(normalized);
}

function splitLeadingCodexCommentary(
  rawText: string,
): ResolvedVisibleReplyParts | null {
  const normalizedRawText = normalizeReplyText(rawText);
  if (!normalizedRawText) return null;

  const headingMatch =
    /(^|\n|[。！？.!?]\s*)((?:#{1,6}\s+\S)|(?:\*\*(?:\/research｜|港股 IPO 池｜)[^*\n]+\*\*))/u.exec(
      normalizedRawText,
    );
  if (!headingMatch || headingMatch.index === 0) return null;

  const bodyStart = headingMatch.index + headingMatch[1].length;
  const commentaryText = normalizedRawText.slice(0, bodyStart).trim();
  const visibleText = normalizedRawText.slice(bodyStart).trim();
  if (!commentaryText || !visibleText) return null;
  if (!looksLikeProcessCommentaryPrefix(commentaryText)) return null;

  return { visibleText, commentaryText };
}

export function resolveVisibleReplyParts(
  rawText: string,
  presentationText?: ReplyVisibilityPresentationText,
  runtimeIdentity?: ReplyVisibilityRuntimeIdentity | null,
): ResolvedVisibleReplyParts {
  const sanitizedRawText = sanitizeInternalContextLeak(rawText);
  const presentationCommentaryText = normalizeReplyText(
    presentationText?.commentaryText,
  );
  const shouldApplyCodexVisibility =
    runtimeIdentity?.agentType === 'codex' ||
    (!runtimeIdentity?.agentType && Boolean(presentationCommentaryText));

  if (!shouldApplyCodexVisibility) {
    return {
      visibleText: sanitizedRawText,
      commentaryText: presentationCommentaryText,
    };
  }

  const answerText = normalizeReplyText(presentationText?.answerText);
  const normalizedRawText = normalizeReplyText(sanitizedRawText);
  const droppedPresentationAnswer = Boolean(answerText);
  const commentaryText = presentationCommentaryText;

  const inferred = splitLeadingCodexCommentary(sanitizedRawText);
  if (inferred) return inferred;

  if (
    normalizedRawText &&
    commentaryText &&
    normalizedRawText === commentaryText
  ) {
    if (startsLikeProcessCommentary(commentaryText)) {
      return {
        visibleText: '',
        commentaryText,
        droppedPresentationAnswer,
      };
    }
    return {
      visibleText: sanitizedRawText,
      commentaryText: '',
      droppedPresentationAnswer,
    };
  }

  if (
    normalizedRawText &&
    commentaryText &&
    normalizedRawText !== commentaryText &&
    normalizedRawText.startsWith(commentaryText)
  ) {
    const stripped = normalizedRawText
      .slice(commentaryText.length)
      .replace(/^\n+/, '')
      .trim();
    if (stripped) {
      return { visibleText: stripped, commentaryText };
    }
  }

  return {
    visibleText: sanitizedRawText,
    commentaryText,
    droppedPresentationAnswer,
  };
}

export function resolveVisibleReplyText(
  rawText: string,
  presentationText?: ReplyVisibilityPresentationText,
  runtimeIdentity?: ReplyVisibilityRuntimeIdentity | null,
): string {
  return resolveVisibleReplyParts(rawText, presentationText, runtimeIdentity)
    .visibleText;
}
