import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getOpenAiCodexUsageSnapshotMock } = vi.hoisted(() => ({
  getOpenAiCodexUsageSnapshotMock: vi.fn(),
}));

vi.mock('../../../../src/core/runtime/openai-codex-usage.js', () => ({
  getOpenAiCodexUsageSnapshot: getOpenAiCodexUsageSnapshotMock,
}));

import {
  attachRuntimeUsageFooterMeta,
  getRuntimeUsageFooterMeta,
  getRuntimeUsageSnapshot,
  shouldShowRemainingUsageInFooter,
} from '../../../../src/core/runtime/usage.ts';

describe('runtime usage helper', () => {
  beforeEach(() => {
    getOpenAiCodexUsageSnapshotMock.mockReset();
  });

  test('returns OpenAI Codex usage and appends remaining quota to footer metadata', async () => {
    getOpenAiCodexUsageSnapshotMock.mockResolvedValue({
      provider: 'openai',
      available: true,
      source: 'Codex usage API',
      primaryUsagePct: 37,
      secondaryUsagePct: 12.5,
      primaryRemainingPct: 63,
      secondaryRemainingPct: 87.5,
    });

    await expect(
      getRuntimeUsageSnapshot({
        agentType: 'openai',
        model: 'gpt-5.4',
      }),
    ).resolves.toMatchObject({
      provider: 'openai',
      primaryRemainingPct: 63,
      secondaryRemainingPct: 87.5,
    });
    await expect(
      getRuntimeUsageFooterMeta({
        agentType: 'openai',
        model: 'gpt-5.4',
      }),
    ).resolves.toEqual({
      primaryRemainingPct: 63,
      secondaryRemainingPct: 87.5,
    });
    await expect(
      attachRuntimeUsageFooterMeta(
        {
          agentType: 'openai',
          model: 'gpt-5.4',
        },
        {
          durationMs: 5_200,
          inputTokens: 100,
        },
      ),
    ).resolves.toEqual({
      durationMs: 5_200,
      inputTokens: 100,
      primaryRemainingPct: 63,
      secondaryRemainingPct: 87.5,
    });
  });

  test('keeps missing runtime usage unavailable without dropping existing metadata', async () => {
    await expect(getRuntimeUsageSnapshot(null)).resolves.toBeNull();
    await expect(getRuntimeUsageFooterMeta(null)).resolves.toBeNull();
    await expect(
      attachRuntimeUsageFooterMeta(null, {
        durationMs: 5_200,
        inputTokens: 100,
      }),
    ).resolves.toEqual({
      durationMs: 5_200,
      inputTokens: 100,
    });
  });

  test('shows remaining footer whenever quota data is available', () => {
    expect(
      shouldShowRemainingUsageInFooter({
        provider: 'openai',
        available: true,
        source: 'test usage snapshot',
        primaryRemainingPct: 28,
        secondaryRemainingPct: 72,
      }),
    ).toBe(true);

    expect(
      shouldShowRemainingUsageInFooter({
        provider: 'openai',
        available: true,
        source: 'test usage snapshot',
        primaryRemainingPct: 42,
        secondaryRemainingPct: 9,
      }),
    ).toBe(true);

    expect(
      shouldShowRemainingUsageInFooter({
        provider: 'openai',
        available: true,
        source: 'test usage snapshot',
        primaryUsagePct: 72,
        secondaryUsagePct: 96,
      }),
    ).toBe(false);
  });
});
