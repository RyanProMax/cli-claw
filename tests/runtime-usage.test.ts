import { describe, expect, test, vi } from 'vitest';

const { getClaudeUsageSnapshotMock } = vi.hoisted(() => ({
  getClaudeUsageSnapshotMock: vi.fn(),
}));

vi.mock('../src/claude-oauth-usage.js', () => ({
  getClaudeUsageSnapshot: getClaudeUsageSnapshotMock,
}));

import {
  attachRuntimeUsageFooterMeta,
  getRuntimeUsageFooterMeta,
  getRuntimeUsageSnapshot,
  shouldShowRemainingUsageInFooter,
} from '../src/core/runtime/usage.ts';

describe('runtime usage helper', () => {
  test('keeps OpenAI and missing runtime usage unavailable without dropping existing metadata', async () => {
    await expect(
      getRuntimeUsageSnapshot({
        agentType: 'openai',
        model: 'gpt-5.4',
      }),
    ).resolves.toBeNull();

    await expect(getRuntimeUsageSnapshot(null)).resolves.toBeNull();
    await expect(
      getRuntimeUsageFooterMeta({
        agentType: 'openai',
        model: 'gpt-5.4',
      }),
    ).resolves.toBeNull();
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
    });
  });

  test('returns claude usage snapshot for claude runtimes', async () => {
    getClaudeUsageSnapshotMock.mockResolvedValue({
      provider: 'claude',
      available: true,
      source: 'Claude OAuth API',
      primaryUsagePct: 82,
      secondaryUsagePct: 36,
      primaryRemainingPct: 18,
      secondaryRemainingPct: 64,
    });

    await expect(
      getRuntimeUsageSnapshot({
        agentType: 'claude',
        model: 'claude-opus-4.1',
      }),
    ).resolves.toMatchObject({
      provider: 'claude',
      primaryUsagePct: 82,
      secondaryUsagePct: 36,
      primaryRemainingPct: 18,
      secondaryRemainingPct: 64,
    });
  });

  test('shows remaining footer whenever quota data is available', () => {
    expect(
      shouldShowRemainingUsageInFooter({
        provider: 'claude',
        available: true,
        source: 'test usage snapshot',
        primaryRemainingPct: 28,
        secondaryRemainingPct: 72,
      }),
    ).toBe(true);

    expect(
      shouldShowRemainingUsageInFooter({
        provider: 'claude',
        available: true,
        source: 'test usage snapshot',
        primaryRemainingPct: 42,
        secondaryRemainingPct: 9,
      }),
    ).toBe(true);

    expect(
      shouldShowRemainingUsageInFooter({
        provider: 'claude',
        available: true,
        source: 'test usage snapshot',
        primaryUsagePct: 72,
        secondaryUsagePct: 96,
      }),
    ).toBe(false);
  });
});
