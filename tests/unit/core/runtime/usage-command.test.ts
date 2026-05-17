import { describe, expect, test } from 'vitest';

import { executeUsageCommand } from '../../../../src/core/runtime/usage-command.ts';

describe('executeUsageCommand', () => {
  test('renders usage windows as unavailable even when providers return quota data', async () => {
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

    expect(reply).toContain('- 5h 剩余: unavailable');
    expect(reply).toContain('- 7d 剩余: unavailable');
    expect(reply).toContain('- 5h 重置时间: unknown');
    expect(reply).toContain('- 7d 重置时间: unknown');
    expect(reply).not.toContain('42%');
    expect(reply).not.toContain('75%');
    expect(reply).not.toContain('18%');
    expect(reply).not.toContain('64%');
  });
});
