export interface AssistantFooterRuntimeIdentity {
  agentType?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
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
  primaryUsagePct?: number | null;
  secondaryUsagePct?: number | null;
  primaryRemainingPct?: number | null;
  secondaryRemainingPct?: number | null;
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

function formatAgentTypeLabel(agentType?: string | null): string | null {
  const normalized = normalizeText(agentType)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'codex') return 'Codex';
  if (normalized === 'claude') return 'Claude';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatSpeedTierLabel(
  runtimeIdentity?: AssistantFooterRuntimeIdentity | null,
): string | null {
  const agentType = normalizeText(runtimeIdentity?.agentType)?.toLowerCase();
  if (agentType !== 'codex') return null;

  const speedTier =
    normalizeText(runtimeIdentity?.speedTier)?.toLowerCase() ?? 'standard';
  if (speedTier === 'fast') return 'fast (2x)';
  if (speedTier === 'standard') return 'standard (1x)';
  return speedTier;
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

function shouldShowRemainingUsage(
  usage: AssistantFooterTokenUsage | null,
): boolean {
  const primaryRemainingPct = normalizeNumber(usage?.primaryRemainingPct);
  const secondaryRemainingPct = normalizeNumber(usage?.secondaryRemainingPct);
  return (
    (primaryRemainingPct !== null && primaryRemainingPct < 20) ||
    (secondaryRemainingPct !== null && secondaryRemainingPct < 10)
  );
}

function appendRemainingUsageParts(
  parts: string[],
  usage: AssistantFooterTokenUsage | null,
): void {
  if (!shouldShowRemainingUsage(usage)) return;

  const primaryRemainingPct = normalizeNumber(usage?.primaryRemainingPct);
  if (primaryRemainingPct !== null) {
    parts.push(`${Math.round(primaryRemainingPct)}% (5h)`);
  }

  const secondaryRemainingPct = normalizeNumber(usage?.secondaryRemainingPct);
  if (secondaryRemainingPct !== null) {
    parts.push(`${Math.round(secondaryRemainingPct)}% (7d)`);
  }
}

function appendCurrentUsageParts(
  parts: string[],
  usage: AssistantFooterTokenUsage | null,
): boolean {
  let appended = false;

  const primaryUsagePct = normalizeNumber(usage?.primaryUsagePct);
  if (primaryUsagePct !== null) {
    parts.push(`${Math.round(primaryUsagePct)}% (5h)`);
    appended = true;
  }

  const secondaryUsagePct = normalizeNumber(usage?.secondaryUsagePct);
  if (secondaryUsagePct !== null) {
    parts.push(`${Math.round(secondaryUsagePct)}% (7d)`);
    appended = true;
  }

  return appended;
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

  const agentType = formatAgentTypeLabel(runtimeIdentity?.agentType);
  if (agentType) {
    parts.push(agentType);
  }

  const model = normalizeText(runtimeIdentity?.model);
  if (model) {
    parts.push(model);
  }

  const reasoningEffort = normalizeText(runtimeIdentity?.reasoningEffort);
  if (reasoningEffort) {
    parts.push(reasoningEffort);
  }

  const speedTier = formatSpeedTierLabel(runtimeIdentity);
  if (speedTier) {
    parts.push(speedTier);
  }

  if (!appendCurrentUsageParts(parts, tokenUsage)) {
    appendRemainingUsageParts(parts, tokenUsage);
  }

  return parts;
}

export function getAssistantCardFooterParts(
  input: AssistantMetaFooterInput,
): string[] {
  const parts: string[] = [];
  const runtimeIdentity = input.runtimeIdentity ?? null;
  const tokenUsage = parseAssistantTokenUsage(input.tokenUsage);

  const durationMs = normalizeNumber(tokenUsage?.durationMs);
  if (durationMs !== null && durationMs > 0) {
    parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  }

  const agentType = formatAgentTypeLabel(runtimeIdentity?.agentType);
  if (agentType) {
    parts.push(agentType);
  }

  const model = normalizeText(runtimeIdentity?.model);
  if (model) {
    parts.push(model);
  }

  const reasoningEffort = normalizeText(runtimeIdentity?.reasoningEffort);
  if (reasoningEffort) {
    parts.push(reasoningEffort);
  }

  const speedTier = formatSpeedTierLabel(runtimeIdentity);
  if (speedTier) {
    parts.push(speedTier);
  }

  if (!appendCurrentUsageParts(parts, tokenUsage)) {
    appendRemainingUsageParts(parts, tokenUsage);
  }

  return parts;
}

export function formatAssistantMetaFooter(
  input: AssistantMetaFooterInput,
): string | null {
  const parts = getAssistantMetaFooterParts(input);
  return parts.length > 0 ? parts.join(' | ') : null;
}

export function formatAssistantCardFooter(
  input: AssistantMetaFooterInput,
): string | null {
  const parts = getAssistantCardFooterParts(input);
  return parts.length > 0 ? parts.join(' | ') : null;
}
