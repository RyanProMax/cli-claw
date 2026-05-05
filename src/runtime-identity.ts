import type { RuntimeIdentity } from './types.js';

function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeRuntimeIdentity(
  identity?: RuntimeIdentity | null,
): RuntimeIdentity | null {
  if (!identity) return null;

  const model = normalizeText(identity.model);
  const reasoningEffort = normalizeText(identity.reasoningEffort);
  const speedTier = normalizeText(identity.speedTier);
  const supportsReasoningEffort =
    typeof identity.supportsReasoningEffort === 'boolean'
      ? identity.supportsReasoningEffort
      : null;

  return {
    agentType: identity.agentType,
    model: model ?? null,
    reasoningEffort: reasoningEffort ?? null,
    speedTier:
      speedTier ?? (identity.agentType === 'codex' ? 'standard' : null),
    supportsReasoningEffort,
  };
}

export function serializeRuntimeIdentity(
  identity?: RuntimeIdentity | null,
): string | null {
  const normalized = normalizeRuntimeIdentity(identity);
  if (!normalized) return null;
  return JSON.stringify(normalized);
}

export function parseRuntimeIdentity(
  value?: string | RuntimeIdentity | null,
): RuntimeIdentity | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return normalizeRuntimeIdentity(
        JSON.parse(value) as RuntimeIdentity | null,
      );
    } catch {
      return null;
    }
  }
  return normalizeRuntimeIdentity(value);
}

export function formatRuntimeIdentityFooter(
  identity?: RuntimeIdentity | null,
): string | null {
  const normalized = normalizeRuntimeIdentity(identity);
  if (!normalized?.model) return null;
  const speedTier =
    normalized.agentType === 'codex'
      ? normalized.speedTier === 'fast'
        ? 'fast (2x)'
        : normalized.speedTier && normalized.speedTier !== 'standard'
          ? normalized.speedTier
          : 'standard (1x)'
      : null;
  if (normalized.reasoningEffort) {
    return [normalized.model, normalized.reasoningEffort, speedTier]
      .filter(Boolean)
      .join(' | ');
  }
  if (normalized.supportsReasoningEffort === false) {
    return normalized.model;
  }
  return speedTier ? `${normalized.model} | ${speedTier}` : null;
}
