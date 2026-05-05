import { getClaudeUsageSnapshot } from './claude-oauth-usage.js';
import {
  parseAssistantTokenUsage,
  type AssistantFooterTokenUsage,
} from './assistant-meta-footer.js';
import type { RuntimeIdentity } from './types.js';
import {
  getCodexUsageSnapshot,
  type UsageProviderResult,
} from './usage-command.js';

export type RuntimeUsageFooterMeta = Pick<
  AssistantFooterTokenUsage,
  | 'primaryUsagePct'
  | 'secondaryUsagePct'
  | 'primaryRemainingPct'
  | 'secondaryRemainingPct'
>;

export async function getRuntimeUsageSnapshot(
  runtimeIdentity?: Pick<RuntimeIdentity, 'agentType'> | null,
): Promise<UsageProviderResult | null> {
  if (!runtimeIdentity?.agentType) return null;
  if (runtimeIdentity.agentType === 'codex') {
    return getCodexUsageSnapshot();
  }
  return getClaudeUsageSnapshot();
}

export async function getRuntimeUsageFooterMeta(
  runtimeIdentity?: Pick<RuntimeIdentity, 'agentType'> | null,
): Promise<RuntimeUsageFooterMeta | null> {
  const snapshot = await getRuntimeUsageSnapshot(runtimeIdentity);
  if (!snapshot?.available) return null;

  return {
    primaryUsagePct: snapshot.primaryUsagePct ?? null,
    secondaryUsagePct: snapshot.secondaryUsagePct ?? null,
    primaryRemainingPct: snapshot.primaryRemainingPct ?? null,
    secondaryRemainingPct: snapshot.secondaryRemainingPct ?? null,
  };
}

export async function attachRuntimeUsageFooterMeta(
  runtimeIdentity: Pick<RuntimeIdentity, 'agentType'> | null | undefined,
  tokenUsage?: AssistantFooterTokenUsage | string | null,
): Promise<AssistantFooterTokenUsage | null> {
  const parsed = parseAssistantTokenUsage(tokenUsage) ?? {};
  const footerMeta = await getRuntimeUsageFooterMeta(runtimeIdentity);
  if (!footerMeta) {
    return Object.keys(parsed).length > 0 ? parsed : null;
  }
  return {
    ...parsed,
    ...footerMeta,
  };
}

function isUsageLow(snapshot?: UsageProviderResult | null): boolean {
  if (!snapshot?.available) return false;
  const primaryRemaining = snapshot.primaryRemainingPct;
  const secondaryRemaining = snapshot.secondaryRemainingPct;
  const primaryLow =
    typeof primaryRemaining === 'number' && Number.isFinite(primaryRemaining)
      ? primaryRemaining < 20
      : false;
  const secondaryLow =
    typeof secondaryRemaining === 'number' &&
    Number.isFinite(secondaryRemaining)
      ? secondaryRemaining < 10
      : false;
  return primaryLow || secondaryLow;
}

export function shouldShowRemainingUsageInFooter(
  snapshot?: UsageProviderResult | null,
): boolean {
  if (!snapshot?.available) return false;
  return isUsageLow(snapshot);
}
