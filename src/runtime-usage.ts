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
  'primaryRemainingPct' | 'secondaryRemainingPct'
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

export function shouldPauseAutopilotForUsage(
  snapshot?: UsageProviderResult | null,
): boolean {
  if (!snapshot?.available) return false;
  const remaining = snapshot.primaryRemainingPct;
  return typeof remaining === 'number' && Number.isFinite(remaining)
    ? remaining < 20
    : false;
}

export function shouldShowRemainingUsageInFooter(
  snapshot?: UsageProviderResult | null,
): boolean {
  if (!snapshot?.available) return false;
  const remaining = snapshot.primaryRemainingPct;
  return typeof remaining === 'number' && Number.isFinite(remaining)
    ? remaining < 30
    : false;
}
