import { describe, expect, test } from 'vitest';

import {
  buildProvisionalTokenUsage,
  normalizeFooterUsageForCurrentTurn,
  normalizeStreamingStatusText,
} from '../../../src/presentation/streaming-runtime-meta.ts';

describe('streaming runtime meta helpers', () => {
  test('hides internal usage_updated status text from user-facing cards', () => {
    expect(normalizeStreamingStatusText('usage_updated')).toBeNull();
    expect(normalizeStreamingStatusText('上下文压缩中')).toBe('上下文压缩中');
  });

  test('builds provisional token usage with elapsed time for interrupted replies', () => {
    const usage = buildProvisionalTokenUsage(Date.now() - 3_250);

    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    expect(usage.costUSD).toBe(0);
    expect(usage.numTurns).toBe(1);
    expect(usage.durationMs).toBeGreaterThanOrEqual(3_000);
  });

  test('normalizes footer usage duration to the current turn', () => {
    const usage = normalizeFooterUsageForCurrentTurn(
      {
        inputTokens: 120,
        outputTokens: 34,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0.01,
        durationMs: 600_000,
        numTurns: 9,
      },
      Date.now() - 2_500,
    );

    expect(usage.inputTokens).toBe(120);
    expect(usage.outputTokens).toBe(34);
    expect(usage.costUSD).toBe(0.01);
    expect(usage.numTurns).toBe(1);
    expect(usage.durationMs).toBeGreaterThanOrEqual(2_000);
    expect(usage.durationMs).toBeLessThan(10_000);
  });
});
