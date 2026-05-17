import type { RuntimeIdentity } from '../../domain/types.js';
import { normalizeRuntimeId } from './runtime-registry.js';

function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAgentType(
  value: RuntimeIdentity['agentType'] | string,
): RuntimeIdentity['agentType'] {
  return normalizeRuntimeId(value);
}

export function normalizeRuntimeIdentity(
  identity?: RuntimeIdentity | null,
): RuntimeIdentity | null {
  if (!identity) return null;

  const agentType = normalizeAgentType(identity.agentType);
  const model = normalizeText(identity.model);
  const reasoningEffort = normalizeText(identity.reasoningEffort);
  const speedTier = normalizeText(identity.speedTier);
  const supportsReasoningEffort =
    typeof identity.supportsReasoningEffort === 'boolean'
      ? identity.supportsReasoningEffort
      : null;

  return {
    agentType,
    model: model ?? null,
    reasoningEffort: reasoningEffort ?? null,
    speedTier: speedTier ?? 'standard',
    supportsReasoningEffort,
  };
}

export function mergeRuntimeIdentity(
  base?: RuntimeIdentity | null,
  next?: RuntimeIdentity | null,
): RuntimeIdentity | null {
  if (!base) return normalizeRuntimeIdentity(next);
  if (!next) return normalizeRuntimeIdentity(base);

  const normalizedBase = normalizeRuntimeIdentity(base);
  if (!normalizedBase) return normalizeRuntimeIdentity(next);

  const nextModel = normalizeText(next.model);
  const nextReasoningEffort = normalizeText(next.reasoningEffort);
  const nextSpeedTier = normalizeText(next.speedTier);
  const agentType = next.agentType ?? normalizedBase.agentType;
  const sameAgentType = agentType === normalizedBase.agentType;
  const supportsReasoningEffort =
    typeof next.supportsReasoningEffort === 'boolean'
      ? next.supportsReasoningEffort
      : sameAgentType
        ? normalizedBase.supportsReasoningEffort
        : null;

  return normalizeRuntimeIdentity({
    agentType,
    model: nextModel ?? (sameAgentType ? normalizedBase.model : null),
    reasoningEffort:
      nextReasoningEffort ??
      (sameAgentType ? normalizedBase.reasoningEffort : null),
    speedTier:
      nextSpeedTier ?? (sameAgentType ? normalizedBase.speedTier : null),
    supportsReasoningEffort,
  });
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
    normalized.speedTier === 'fast'
      ? 'fast (2x)'
      : normalized.speedTier && normalized.speedTier !== 'standard'
        ? normalized.speedTier
        : 'standard (1x)';
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
