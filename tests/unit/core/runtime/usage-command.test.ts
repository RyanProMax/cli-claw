import { describe, expect, test } from 'vitest';

import { executeUsageCommand } from '../../../../src/core/runtime/usage-command.ts';

describe('executeUsageCommand', () => {
  test('renders usage windows when providers return quota data', async () => {
    const reply = await executeUsageCommand({
      getOpenAiUsage: async () => ({
        provider: 'openai',
        available: true,
        source: 'OpenAI',
        primaryRemainingPct: 42,
        secondaryRemainingPct: 75,
        primaryResetAt: '2026-05-17T10:00:00Z',
        secondaryResetAt: '2026-05-21T10:00:00Z',
      }),
      getClaudeUsage: async () => ({
        provider: 'claude',
        available: true,
        source: 'Claude OAuth API',
        primaryRemainingPct: 18,
        secondaryRemainingPct: 64,
        primaryResetAt: '2026-05-17T11:00:00Z',
        secondaryResetAt: '2026-05-21T11:00:00Z',
      }),
    });

    expect(reply).toContain('- 5h 剩余: 42%');
    expect(reply).toContain('- 7d 剩余: 75%');
    expect(reply).toContain('- 5h 重置时间: 2026-05-17T10:00:00Z');
    expect(reply).toContain('- 7d 重置时间: 2026-05-21T10:00:00Z');
    expect(reply).toContain('- 5h 剩余: 18%');
    expect(reply).toContain('- 7d 剩余: 64%');
    expect(reply).toContain('- 5h 重置时间: 2026-05-17T11:00:00Z');
    expect(reply).toContain('- 7d 重置时间: 2026-05-21T11:00:00Z');
    expect(reply).not.toContain('usage unavailable');
  });

  test('falls back to unavailable only when a provider cannot expose usage', async () => {
    const reply = await executeUsageCommand({
      getOpenAiUsage: async () => ({
        provider: 'openai',
        available: false,
        source: 'OpenAI',
        reason: 'OpenAI usage snapshot unavailable',
      }),
      getClaudeUsage: async () => ({
        provider: 'claude',
        available: false,
        source: 'Claude OAuth API',
        reason: 'Claude OAuth quota endpoint returned 403',
      }),
    });

    expect(reply).toContain('- 5h 剩余: unavailable');
    expect(reply).toContain('- 7d 剩余: unavailable');
    expect(reply).toContain('- 5h 重置时间: unknown');
    expect(reply).toContain('- 7d 重置时间: unknown');
    expect(reply).toContain('- 原因: OpenAI usage snapshot unavailable');
    expect(reply).toContain('- 原因: Claude OAuth quota endpoint returned 403');
  });
});
