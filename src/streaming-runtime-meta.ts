import type { AssistantFooterTokenUsage } from './assistant-meta-footer.js';

export function normalizeStreamingStatusText(
  statusText?: string | null,
): string | null {
  if (typeof statusText !== 'string') return null;
  const trimmed = statusText.trim();
  if (!trimmed) return null;
  if (trimmed === 'usage_updated') return null;
  return trimmed;
}

export function buildProvisionalTokenUsage(
  startedAtMs: number,
): AssistantFooterTokenUsage {
  const durationMs = Math.max(0, Date.now() - startedAtMs);
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
    durationMs,
    numTurns: 1,
  };
}

export function serializeAssistantTokenUsage(
  tokenUsage?: AssistantFooterTokenUsage | string | null,
): string | undefined {
  if (!tokenUsage) return undefined;
  return typeof tokenUsage === 'string'
    ? tokenUsage
    : JSON.stringify(tokenUsage);
}
