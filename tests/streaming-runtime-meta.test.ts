import { describe, expect, test } from 'vitest';

import {
  buildProvisionalTokenUsage,
  normalizeStreamingStatusText,
} from '../src/streaming-runtime-meta.ts';

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
});
