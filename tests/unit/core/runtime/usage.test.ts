import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getOpenAiCodexUsageSnapshotMock } = vi.hoisted(() => ({
  getOpenAiCodexUsageSnapshotMock: vi.fn(),
}));

vi.mock('../../../../src/core/runtime/openai-codex-usage.js', () => ({
  getOpenAiCodexUsageSnapshot: getOpenAiCodexUsageSnapshotMock,
}));

import { getRuntimeUsageSnapshot } from '../../../../src/core/runtime/usage.ts';

describe('runtime usage helper', () => {
  beforeEach(() => {
    getOpenAiCodexUsageSnapshotMock.mockReset();
  });

  test('returns OpenAI Codex usage for scheduler guard callers', async () => {
    getOpenAiCodexUsageSnapshotMock.mockResolvedValue({
      provider: 'openai',
      available: true,
      source: 'Codex usage API',
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
  });

  test('returns null without a runtime identity', async () => {
    await expect(getRuntimeUsageSnapshot(null)).resolves.toBeNull();
  });
});
