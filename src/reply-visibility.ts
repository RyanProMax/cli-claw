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
}

function normalizeReplyText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function looksLikeProcessCommentaryPrefix(prefix: string): boolean {
  const normalized = prefix.trim();
  if (!normalized || normalized.length > 500) return false;
  return /^(我(先|会|按|来|继续|已经|正在|把)|先|接下来|当前|正在|已|I(?:'ll| will| am|’ll)\b)/i.test(
    normalized,
  );
}

function splitLeadingCodexCommentary(
  rawText: string,
): ResolvedVisibleReplyParts | null {
  const normalizedRawText = normalizeReplyText(rawText);
  if (!normalizedRawText) return null;

  const headingMatch = /(^|\n|[。！？.!?]\s*)(#{1,6}\s+\S)/.exec(
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
  const commentaryText = normalizeReplyText(presentationText?.commentaryText);
  const shouldApplyCodexVisibility =
    runtimeIdentity?.agentType === 'codex' ||
    (!runtimeIdentity?.agentType && Boolean(commentaryText));

  if (!shouldApplyCodexVisibility) {
    return { visibleText: rawText, commentaryText };
  }

  const answerText = normalizeReplyText(presentationText?.answerText);
  if (commentaryText && answerText) {
    return { visibleText: answerText, commentaryText };
  }

  const normalizedRawText = normalizeReplyText(rawText);
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

  const inferred = splitLeadingCodexCommentary(rawText);
  if (inferred) return inferred;

  if (answerText) {
    return { visibleText: answerText, commentaryText };
  }

  return { visibleText: rawText, commentaryText };
}

export function resolveVisibleReplyText(
  rawText: string,
  presentationText?: ReplyVisibilityPresentationText,
  runtimeIdentity?: ReplyVisibilityRuntimeIdentity | null,
): string {
  return resolveVisibleReplyParts(rawText, presentationText, runtimeIdentity)
    .visibleText;
}
