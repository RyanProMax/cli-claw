import { describe, expect, test, vi } from 'vitest';

const { getCodexUsageSnapshotMock, getClaudeUsageSnapshotMock } = vi.hoisted(
  () => ({
    getCodexUsageSnapshotMock: vi.fn(),
    getClaudeUsageSnapshotMock: vi.fn(),
  }),
);

vi.mock('../src/usage-command.js', () => ({
  getCodexUsageSnapshot: getCodexUsageSnapshotMock,
}));

vi.mock('../src/claude-oauth-usage.js', () => ({
  getClaudeUsageSnapshot: getClaudeUsageSnapshotMock,
}));

import {
  attachRuntimeUsageFooterMeta,
  getRuntimeUsageFooterMeta,
  getRuntimeUsageSnapshot,
  shouldShowRemainingUsageInFooter,
} from '../src/runtime-usage.ts';

describe('runtime usage helper', () => {
  test('returns codex usage snapshot for codex runtimes', async () => {
    getCodexUsageSnapshotMock.mockReturnValue({
      provider: 'codex',
      available: true,
      source: 'local ~/.codex/sessions',
      primaryUsagePct: 72,
      secondaryUsagePct: 28,
      primaryRemainingPct: 28,
      secondaryRemainingPct: 72,
    });

    await expect(
      getRuntimeUsageSnapshot({
        agentType: 'codex',
        model: 'gpt-5.4',
      }),
    ).resolves.toMatchObject({
      provider: 'codex',
      primaryUsagePct: 72,
      secondaryUsagePct: 28,
      primaryRemainingPct: 28,
      secondaryRemainingPct: 72,
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

  test('returns null when runtime identity is missing', async () => {
    await expect(getRuntimeUsageSnapshot(null)).resolves.toBeNull();
  });

  test('builds footer metadata only when snapshot is available', async () => {
    getCodexUsageSnapshotMock.mockReturnValue({
      provider: 'codex',
      available: true,
      source: 'local ~/.codex/sessions',
      primaryUsagePct: 72,
      secondaryUsagePct: 28,
      primaryRemainingPct: 28,
      secondaryRemainingPct: 72,
    });

    await expect(
      getRuntimeUsageFooterMeta({
        agentType: 'codex',
        model: 'gpt-5.4',
      }),
    ).resolves.toEqual({
      primaryUsagePct: 72,
      secondaryUsagePct: 28,
      primaryRemainingPct: 28,
      secondaryRemainingPct: 72,
    });
  });

  test('merges current remaining usage into existing token usage metadata', async () => {
    getCodexUsageSnapshotMock.mockReturnValue({
      provider: 'codex',
      available: true,
      source: 'local ~/.codex/sessions',
      primaryUsagePct: 72,
      secondaryUsagePct: 28,
      primaryRemainingPct: 28,
      secondaryRemainingPct: 72,
    });

    await expect(
      attachRuntimeUsageFooterMeta(
        {
          agentType: 'codex',
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
      primaryUsagePct: 72,
      secondaryUsagePct: 28,
      primaryRemainingPct: 28,
      secondaryRemainingPct: 72,
    });
  });

  test('shows remaining footer whenever quota data is available', () => {
    expect(
      shouldShowRemainingUsageInFooter({
        provider: 'codex',
        available: true,
        source: 'local ~/.codex/sessions',
        primaryRemainingPct: 28,
        secondaryRemainingPct: 72,
      }),
    ).toBe(true);

    expect(
      shouldShowRemainingUsageInFooter({
        provider: 'codex',
        available: true,
        source: 'local ~/.codex/sessions',
        primaryRemainingPct: 42,
        secondaryRemainingPct: 9,
      }),
    ).toBe(true);
  });
});
