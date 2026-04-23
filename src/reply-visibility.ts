interface ReplyVisibilityPresentationText {
  answerText?: string;
  commentaryText?: string;
}

interface ReplyVisibilityRuntimeIdentity {
  agentType?: string | null;
}

function normalizeReplyText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

export function resolveVisibleReplyText(
  rawText: string,
  presentationText?: ReplyVisibilityPresentationText,
  runtimeIdentity?: ReplyVisibilityRuntimeIdentity | null,
): string {
  const commentaryText = normalizeReplyText(presentationText?.commentaryText);
  const shouldApplyCodexVisibility =
    runtimeIdentity?.agentType === 'codex' ||
    (!runtimeIdentity?.agentType && Boolean(commentaryText));

  if (!shouldApplyCodexVisibility) {
    return rawText;
  }

  const answerText = normalizeReplyText(presentationText?.answerText);
  if (answerText) {
    return answerText;
  }

  const normalizedRawText = normalizeReplyText(rawText);
  if (
    !normalizedRawText ||
    !commentaryText ||
    normalizedRawText === commentaryText ||
    !normalizedRawText.startsWith(commentaryText)
  ) {
    return rawText;
  }

  const stripped = normalizedRawText
    .slice(commentaryText.length)
    .replace(/^\n+/, '')
    .trim();
  return stripped || rawText;
}
