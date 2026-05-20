import { describe, expect, test } from 'vitest';

import { evaluateScheduledTaskUsageGuard } from '../../../../src/agent/scheduler/usage-guard.ts';

const NOW_MS = Date.parse('2026-05-20T15:00:00.000Z');

describe('scheduled task usage guard', () => {
  test('defers when the 5h usage bucket remaining quota is below the threshold', () => {
    const decision = evaluateScheduledTaskUsageGuard(
      {
        provider: 'openai',
        available: true,
        source: 'test',
        primaryRemainingPct: 29,
        secondaryRemainingPct: 80,
        primaryResetAt: '2026-05-20T17:00:00.000Z',
        secondaryResetAt: '2026-05-24T00:00:00.000Z',
      },
      { nowMs: NOW_MS, minRemainingPct: 30, unavailableRetryMs: 30 * 60_000 },
    );

    expect(decision).toEqual({
      allowed: false,
      deferUntil: '2026-05-20T17:00:00.000Z',
      reason:
        'OpenAI usage guard deferred scheduled task: 5h remaining 29% < 30%',
      lowBuckets: ['5h'],
    });
  });

  test('defers when the 7d usage bucket remaining quota is below the threshold', () => {
    const decision = evaluateScheduledTaskUsageGuard(
      {
        provider: 'openai',
        available: true,
        source: 'test',
        primaryRemainingPct: 80,
        secondaryRemainingPct: 29,
        primaryResetAt: '2026-05-20T17:00:00.000Z',
        secondaryResetAt: '2026-05-24T00:00:00.000Z',
      },
      { nowMs: NOW_MS, minRemainingPct: 30, unavailableRetryMs: 30 * 60_000 },
    );

    expect(decision).toEqual({
      allowed: false,
      deferUntil: '2026-05-24T00:00:00.000Z',
      reason:
        'OpenAI usage guard deferred scheduled task: 7d remaining 29% < 30%',
      lowBuckets: ['7d'],
    });
  });

  test('defers conservatively when usage is unavailable', () => {
    const decision = evaluateScheduledTaskUsageGuard(
      {
        provider: 'openai',
        available: false,
        source: 'test',
        reason: 'Codex CLI login is required',
      },
      { nowMs: NOW_MS, minRemainingPct: 30, unavailableRetryMs: 30 * 60_000 },
    );

    expect(decision).toEqual({
      allowed: false,
      deferUntil: '2026-05-20T15:30:00.000Z',
      reason:
        'OpenAI usage guard unavailable for scheduled task: Codex CLI login is required',
      lowBuckets: [],
    });
  });

  test('defers conservatively when an available usage snapshot lacks bucket percentages', () => {
    const decision = evaluateScheduledTaskUsageGuard(
      {
        provider: 'openai',
        available: true,
        source: 'test',
        primaryRemainingPct: 80,
      },
      { nowMs: NOW_MS, minRemainingPct: 30, unavailableRetryMs: 30 * 60_000 },
    );

    expect(decision).toEqual({
      allowed: false,
      deferUntil: '2026-05-20T15:30:00.000Z',
      reason:
        'OpenAI usage guard unavailable for scheduled task: missing 7d remaining usage',
      lowBuckets: [],
    });
  });

  test('allows scheduled tasks when both usage buckets are above the threshold', () => {
    const decision = evaluateScheduledTaskUsageGuard(
      {
        provider: 'openai',
        available: true,
        source: 'test',
        primaryRemainingPct: 31,
        secondaryRemainingPct: 30,
      },
      { nowMs: NOW_MS, minRemainingPct: 30, unavailableRetryMs: 30 * 60_000 },
    );

    expect(decision).toEqual({ allowed: true, lowBuckets: [] });
  });
});
