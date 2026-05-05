import { describe, expect, test } from 'vitest';

import { appendAssistantMetaFooter } from '../src/assistant-meta-footer.ts';
import { formatAssistantCardFooter as formatBackendAssistantCardFooter } from '../src/assistant-meta-footer.ts';
import { formatAssistantMetaFooter as formatBackendAssistantMetaFooter } from '../src/assistant-meta-footer.ts';
import { formatAssistantCardFooter as formatWebAssistantCardFooter } from '../web/src/lib/assistantMetaFooter.ts';
import { formatAssistantMetaFooter as formatWebAssistantMetaFooter } from '../web/src/lib/assistantMetaFooter.ts';

describe('assistant meta footer', () => {
  test('formats duration compactly without zero hour or minute fields', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'GPT-5.4',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    };

    expect(
      formatBackendAssistantMetaFooter({
        runtimeIdentity,
        tokenUsage: { durationMs: 36_000 },
      }),
    ).toBe('36s | Codex | GPT-5.4 | high | standard (1x)');
    expect(
      formatBackendAssistantMetaFooter({
        runtimeIdentity,
        tokenUsage: { durationMs: 72_000 },
      }),
    ).toBe('1m12s | Codex | GPT-5.4 | high | standard (1x)');
    expect(
      formatBackendAssistantMetaFooter({
        runtimeIdentity,
        tokenUsage: { durationMs: 4_992_000 },
      }),
    ).toBe('1h23m12s | Codex | GPT-5.4 | high | standard (1x)');
    expect(
      formatWebAssistantMetaFooter({
        runtimeIdentity,
        tokenUsage: { durationMs: 4_992_000 },
      }),
    ).toBe('1h23m12s | Codex | GPT-5.4 | high | standard (1x)');
  });

  test('formats base footer with duration, agent type, model, and reasoning effort', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'GPT-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };
    const tokenUsage = {
      inputTokens: 12_300,
      outputTokens: 34,
      costUSD: 0.0421,
      durationMs: 5_200,
    };

    expect(
      formatBackendAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('5s | Codex | GPT-5.4 | xhigh | standard (1x)');
    expect(formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage })).toBe(
      '5s | Codex | GPT-5.4 | xhigh | standard (1x)',
    );
  });

  test('skips reasoning effort when it is not applicable for the runtime', () => {
    const runtimeIdentity = {
      agentType: 'claude' as const,
      model: 'claude-opus-4.1',
      supportsReasoningEffort: false,
    };
    const tokenUsage = {
      inputTokens: 2_000,
      outputTokens: 500,
      costUSD: 0.01,
      durationMs: 2_000,
    };

    expect(
      formatBackendAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('2s | Claude | claude-opus-4.1');
    expect(formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage })).toBe(
      '2s | Claude | claude-opus-4.1',
    );
  });

  test('hides reasoning effort when support is unknown and effort is missing', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'GPT-5.4',
    };
    const tokenUsage = {
      inputTokens: 1_000,
      outputTokens: 200,
      costUSD: 0,
      durationMs: 4_500,
    };

    expect(
      formatBackendAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('4s | Codex | GPT-5.4 | standard (1x)');
    expect(formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage })).toBe(
      '4s | Codex | GPT-5.4 | standard (1x)',
    );
  });

  test('does not show used token windows when remaining quota is missing', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };
    const tokenUsage = {
      durationMs: 5_200,
      primaryUsagePct: 72,
      secondaryUsagePct: 96,
    };

    expect(
      formatBackendAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('5s | Codex | gpt-5.4 | xhigh | standard (1x)');
    expect(formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage })).toBe(
      '5s | Codex | gpt-5.4 | xhigh | standard (1x)',
    );
  });

  test('appends remaining quota windows in the compact footer', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };
    const tokenUsage = {
      durationMs: 5_200,
      primaryUsagePct: 81,
      secondaryUsagePct: 28,
      primaryRemainingPct: 19,
      secondaryRemainingPct: 72,
    };

    expect(
      formatBackendAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe(
      '5s | Codex | gpt-5.4 | xhigh | standard (1x) | 19% (5h) | 72% (7d)',
    );
    expect(formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage })).toBe(
      '5s | Codex | gpt-5.4 | xhigh | standard (1x) | 19% (5h) | 72% (7d)',
    );
  });

  test('appends remaining quota even when only the week window is low', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };
    const tokenUsage = {
      durationMs: 5_200,
      primaryRemainingPct: 42,
      secondaryRemainingPct: 9,
    };

    expect(
      formatBackendAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('5s | Codex | gpt-5.4 | xhigh | standard (1x) | 42% (5h) | 9% (7d)');
    expect(formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage })).toBe(
      '5s | Codex | gpt-5.4 | xhigh | standard (1x) | 42% (5h) | 9% (7d)',
    );
  });

  test('shows healthy remaining quota windows instead of hiding them', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };
    const tokenUsage = {
      durationMs: 5_200,
      primaryRemainingPct: 28,
      secondaryRemainingPct: 72,
    };

    expect(
      formatBackendAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe(
      '5s | Codex | gpt-5.4 | xhigh | standard (1x) | 28% (5h) | 72% (7d)',
    );
    expect(formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage })).toBe(
      '5s | Codex | gpt-5.4 | xhigh | standard (1x) | 28% (5h) | 72% (7d)',
    );
  });

  test('formats compact card footer with duration, agent type, model, and effort only', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };
    const tokenUsage = {
      inputTokens: 12_300,
      outputTokens: 34,
      costUSD: 0.0421,
      durationMs: 5_200,
    };

    expect(
      formatBackendAssistantCardFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('5s | Codex | gpt-5.4 | xhigh | standard (1x)');
    expect(formatWebAssistantCardFooter({ runtimeIdentity, tokenUsage })).toBe(
      '5s | Codex | gpt-5.4 | xhigh | standard (1x)',
    );
  });

  test('appends footer below assistant text for IM channels', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'GPT-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };
    const tokenUsage = {
      inputTokens: 1_000,
      outputTokens: 200,
      durationMs: 4_500,
    };

    expect(
      appendAssistantMetaFooter('Hello from assistant', {
        runtimeIdentity,
        tokenUsage,
      }),
    ).toBe(
      'Hello from assistant\n\n4s | Codex | GPT-5.4 | xhigh | standard (1x)',
    );
  });

  test('formats fast Codex speed tier', () => {
    const runtimeIdentity = {
      agentType: 'codex' as const,
      model: 'GPT-5.4',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
      supportsReasoningEffort: true,
    };

    expect(
      formatBackendAssistantMetaFooter({
        runtimeIdentity,
        tokenUsage: { durationMs: 4_500 },
      }),
    ).toBe('4s | Codex | GPT-5.4 | xhigh | fast (2x)');
    expect(
      formatWebAssistantMetaFooter({
        runtimeIdentity,
        tokenUsage: { durationMs: 4_500 },
      }),
    ).toBe('4s | Codex | GPT-5.4 | xhigh | fast (2x)');
  });

  test('keeps original text when no footer parts are available', () => {
    expect(appendAssistantMetaFooter('Hello from assistant', {})).toBe(
      'Hello from assistant',
    );
  });
});
