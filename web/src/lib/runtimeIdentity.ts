export interface RuntimeIdentity {
  agentType?: 'claude' | 'codex' | string;
  model?: string | null;
  reasoningEffort?: string | null;
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
  if (reasoningEffort) return `${model} | ${reasoningEffort}`;
  if (identity.supportsReasoningEffort === false) return model;
  return null;
}
