import {
  getEnabledProviders,
  getProviders,
  parseOAuthUsageBucket,
} from './runtime-config.js';
import type {
  CachedOAuthUsage,
  OAuthUsageResponse,
  UnifiedProvider,
} from './runtime-config.js';
import type { UsageProviderResult } from './usage-command.js';

const OAUTH_USAGE_API = 'https://api.anthropic.com/api/oauth/usage';
const USAGE_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const usageCache = new Map<string, CachedOAuthUsage>();
const inFlightUsageRequests = new Map<string, Promise<CachedOAuthUsage>>();

const cleanupInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of usageCache) {
      if (now - entry.fetchedAt >= USAGE_CACHE_TTL_MS) {
        usageCache.delete(key);
      }
    }
  },
  5 * 60_000,
);
cleanupInterval.unref?.();

export async function fetchOAuthUsage(
  providerId: string,
): Promise<CachedOAuthUsage> {
  const cached = usageCache.get(providerId);
  if (cached && Date.now() - cached.fetchedAt < USAGE_CACHE_TTL_MS) {
    return cached;
  }

  // Deduplicate concurrent requests for the same provider.
  const inFlight = inFlightUsageRequests.get(providerId);
  if (inFlight) return inFlight;

  const providers = getProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) {
    throw new Error('Provider not found');
  }
  if (!provider.claudeOAuthCredentials) {
    throw new Error('Provider has no OAuth credentials');
  }

  const requestPromise = (async () => {
    try {
      const resp = await fetch(OAUTH_USAGE_API, {
        headers: {
          Authorization: `Bearer ${provider.claudeOAuthCredentials!.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
      });

      if (!resp.ok) {
        // Return stale cache if available, otherwise throw.
        if (cached) {
          const stale: CachedOAuthUsage = {
            ...cached,
            error: `HTTP ${resp.status}`,
          };
          usageCache.set(providerId, stale);
          return stale;
        }
        throw new Error(`Usage API returned ${resp.status}`);
      }

      const raw = (await resp.json()) as Record<string, unknown>;
      const data: OAuthUsageResponse = {
        five_hour: parseOAuthUsageBucket(raw.five_hour),
        seven_day: parseOAuthUsageBucket(raw.seven_day),
        seven_day_opus: parseOAuthUsageBucket(raw.seven_day_opus),
        seven_day_sonnet: parseOAuthUsageBucket(raw.seven_day_sonnet),
      };

      const result: CachedOAuthUsage = { data, fetchedAt: Date.now() };
      usageCache.set(providerId, result);
      return result;
    } finally {
      inFlightUsageRequests.delete(providerId);
    }
  })();

  inFlightUsageRequests.set(providerId, requestPromise);
  return requestPromise;
}

interface ClaudeUsageDeps {
  getEnabledProviders?: () => UnifiedProvider[];
  fetchOAuthUsage?: (providerId: string) => Promise<CachedOAuthUsage>;
}

function remainingPct(utilization: number): number {
  return Math.max(0, 100 - utilization);
}

function stringifyError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  return 'Claude OAuth usage fetch failed';
}

export async function getClaudeUsageSnapshot(
  deps: ClaudeUsageDeps = {},
): Promise<UsageProviderResult> {
  const providers = (deps.getEnabledProviders ?? getEnabledProviders)();
  const provider = providers.find((item) => item.claudeOAuthCredentials);
  if (!provider) {
    return {
      provider: 'claude',
      available: false,
      reason: '未启用 Claude OAuth provider',
      source: 'Claude OAuth API',
    };
  }

  try {
    const usage = await (deps.fetchOAuthUsage ?? fetchOAuthUsage)(provider.id);
    const fiveHour = usage.data.five_hour;
    const sevenDay = usage.data.seven_day;
    if (!fiveHour || !sevenDay) {
      return {
        provider: 'claude',
        available: false,
        reason: 'Claude OAuth usage bucket 缺失',
        source: 'Claude OAuth API',
      };
    }

    return {
      provider: 'claude',
      available: true,
      source: 'Claude OAuth API',
      primaryRemainingPct: remainingPct(fiveHour.utilization),
      secondaryRemainingPct: remainingPct(sevenDay.utilization),
      primaryResetAt: fiveHour.resets_at,
      secondaryResetAt: sevenDay.resets_at,
    };
  } catch (error) {
    return {
      provider: 'claude',
      available: false,
      reason: stringifyError(error),
      source: 'Claude OAuth API',
    };
  }
}
