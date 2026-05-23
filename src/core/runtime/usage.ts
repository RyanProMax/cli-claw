import { getAgentRuntime } from './runtime-registry.js';
import type { RuntimeIdentity } from '../../domain/types.js';

export interface UsageProviderResult {
  provider: 'openai';
  available: boolean;
  source: string;
  primaryUsagePct?: number;
  secondaryUsagePct?: number;
  primaryRemainingPct?: number;
  secondaryRemainingPct?: number;
  primaryResetAt?: unknown;
  secondaryResetAt?: unknown;
  reason?: string;
}

export async function getRuntimeUsageSnapshot(
  runtimeIdentity?: Pick<RuntimeIdentity, 'agentType'> | null,
): Promise<UsageProviderResult | null> {
  if (!runtimeIdentity?.agentType) return null;
  return getAgentRuntime(runtimeIdentity.agentType).usage();
}
