import type { UsageProviderResult } from '../../core/runtime/usage-command.js';

export interface ScheduledTaskUsageGuardOptions {
  minRemainingPct: number;
  nowMs: number;
  unavailableRetryMs: number;
}

export interface ScheduledTaskUsageGuardDecision {
  allowed: boolean;
  deferUntil?: string;
  reason?: string;
  lowBuckets: string[];
}

interface UsageBucket {
  label: '5h' | '7d';
  remainingPct?: number;
  resetAt?: unknown;
}

function parseResetMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value;
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatPct(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

export function evaluateScheduledTaskUsageGuard(
  snapshot: UsageProviderResult | null | undefined,
  options: ScheduledTaskUsageGuardOptions,
): ScheduledTaskUsageGuardDecision {
  if (!snapshot?.available) {
    return {
      allowed: false,
      deferUntil: new Date(
        options.nowMs + options.unavailableRetryMs,
      ).toISOString(),
      reason: `OpenAI usage guard unavailable for scheduled task: ${
        snapshot?.reason ?? 'usage snapshot unavailable'
      }`,
      lowBuckets: [],
    };
  }

  const buckets: UsageBucket[] = [
    {
      label: '5h',
      remainingPct: snapshot.primaryRemainingPct,
      resetAt: snapshot.primaryResetAt,
    },
    {
      label: '7d',
      remainingPct: snapshot.secondaryRemainingPct,
      resetAt: snapshot.secondaryResetAt,
    },
  ];
  const missingBuckets = buckets.filter(
    (bucket) =>
      typeof bucket.remainingPct !== 'number' ||
      !Number.isFinite(bucket.remainingPct),
  );
  if (missingBuckets.length > 0) {
    return {
      allowed: false,
      deferUntil: new Date(
        options.nowMs + options.unavailableRetryMs,
      ).toISOString(),
      reason: `OpenAI usage guard unavailable for scheduled task: missing ${missingBuckets
        .map((bucket) => bucket.label)
        .join('/')} remaining usage`,
      lowBuckets: [],
    };
  }

  const lowBuckets = buckets.filter(
    (bucket) =>
      typeof bucket.remainingPct === 'number' &&
      Number.isFinite(bucket.remainingPct) &&
      bucket.remainingPct < options.minRemainingPct,
  );

  if (lowBuckets.length === 0) {
    return { allowed: true, lowBuckets: [] };
  }

  const resetTimes = lowBuckets
    .map((bucket) => parseResetMs(bucket.resetAt))
    .filter((value): value is number => value !== null);
  const rawDeferMs =
    resetTimes.length > 0
      ? Math.max(...resetTimes)
      : options.nowMs + options.unavailableRetryMs;
  const deferMs =
    rawDeferMs > options.nowMs
      ? rawDeferMs
      : options.nowMs + options.unavailableRetryMs;
  const reason = lowBuckets
    .map(
      (bucket) =>
        `${bucket.label} remaining ${formatPct(bucket.remainingPct!)}% < ${
          options.minRemainingPct
        }%`,
    )
    .join('; ');

  return {
    allowed: false,
    deferUntil: new Date(deferMs).toISOString(),
    reason: `OpenAI usage guard deferred scheduled task: ${reason}`,
    lowBuckets: lowBuckets.map((bucket) => bucket.label),
  };
}
