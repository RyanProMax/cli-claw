export interface RuntimeIdentity {
  agentType?: 'openai' | string;
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
  supportsReasoningEffort?: boolean | null;
}

function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function formatRuntimeIdentityFooter(
  identity?: RuntimeIdentity | null,
): string | null {
  if (!identity) return null;
  const model = normalizeText(identity.model);
  if (!model) return null;
  const reasoningEffort = normalizeText(identity.reasoningEffort);
  const agentType = identity.agentType === 'codex' ? 'openai' : identity.agentType;
  const speedTier =
    agentType === 'openai'
      ? identity.speedTier === 'fast'
        ? 'fast (2x)'
        : identity.speedTier && identity.speedTier !== 'standard'
          ? identity.speedTier
          : 'standard (1x)'
      : null;
  if (reasoningEffort) {
    return [model, reasoningEffort, speedTier].filter(Boolean).join(' | ');
  }
  if (identity.supportsReasoningEffort === false) return model;
  return speedTier ? `${model} | ${speedTier}` : null;
}
