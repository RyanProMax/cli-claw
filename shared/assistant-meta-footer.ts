export interface AssistantFooterRuntimeIdentity {
  agentType?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  supportsReasoningEffort?: boolean | null;
}

export interface AssistantFooterModelUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUSD?: number | null;
}

export interface AssistantFooterTokenUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  costUSD?: number | null;
  durationMs?: number | null;
  numTurns?: number | null;
  modelUsage?: Record<string, AssistantFooterModelUsage> | null;
}

export interface AssistantMetaFooterInput {
  runtimeIdentity?: AssistantFooterRuntimeIdentity | null;
  tokenUsage?: AssistantFooterTokenUsage | string | null;
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function parseAssistantTokenUsage(
  tokenUsage?: AssistantFooterTokenUsage | string | null,
): AssistantFooterTokenUsage | null {
  if (!tokenUsage) return null;
  if (typeof tokenUsage === 'string') {
    try {
      return JSON.parse(tokenUsage) as AssistantFooterTokenUsage;
    } catch {
      return null;
    }
  }
  return tokenUsage;
}

function getTotalTokens(usage: AssistantFooterTokenUsage | null): number | null {
  if (!usage) return null;

  const rootInput = normalizeNumber(usage.inputTokens);
  const rootOutput = normalizeNumber(usage.outputTokens);
  if (rootInput !== null || rootOutput !== null) {
    return Math.max(0, (rootInput || 0) + (rootOutput || 0));
  }

  if (!usage.modelUsage || typeof usage.modelUsage !== 'object') return null;

  let total = 0;
  let sawAny = false;
  for (const modelUsage of Object.values(usage.modelUsage)) {
    const input = normalizeNumber(modelUsage?.inputTokens);
    const output = normalizeNumber(modelUsage?.outputTokens);
    if (input !== null || output !== null) {
      total += (input || 0) + (output || 0);
      sawAny = true;
    }
  }

  return sawAny ? total : null;
}

export function getAssistantMetaFooterParts(
  input: AssistantMetaFooterInput,
): string[] {
  const parts: string[] = [];
  const runtimeIdentity = input.runtimeIdentity ?? null;
  const tokenUsage = parseAssistantTokenUsage(input.tokenUsage);

  const durationMs = normalizeNumber(tokenUsage?.durationMs);
  if (durationMs !== null && durationMs > 0) {
    parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  }

  const model = normalizeText(runtimeIdentity?.model);
  if (model) {
    parts.push(model);
  }

  const reasoningEffort = normalizeText(runtimeIdentity?.reasoningEffort);
  if (reasoningEffort) {
    parts.push(reasoningEffort);
  }

  const totalTokens = getTotalTokens(tokenUsage);
  if (totalTokens !== null && totalTokens > 0) {
    parts.push(`${formatCompactNumber(totalTokens)} tokens`);
  }

  const costUSD = normalizeNumber(tokenUsage?.costUSD);
  if (costUSD !== null && costUSD > 0) {
    parts.push(`$${costUSD.toFixed(4)}`);
  }

  return parts;
}

export function formatAssistantMetaFooter(
  input: AssistantMetaFooterInput,
): string | null {
  const parts = getAssistantMetaFooterParts(input);
  return parts.length > 0 ? parts.join(' | ') : null;
}
