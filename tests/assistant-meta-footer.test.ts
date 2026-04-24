import { describe, expect, test } from 'vitest';

import { appendAssistantMetaFooter } from '../src/assistant-meta-footer.ts';
import { formatAssistantCardFooter as formatBackendAssistantCardFooter } from '../src/assistant-meta-footer.ts';
import { formatAssistantMetaFooter as formatBackendAssistantMetaFooter } from '../src/assistant-meta-footer.ts';
import { formatAssistantCardFooter as formatWebAssistantCardFooter } from '../web/src/lib/assistantMetaFooter.ts';
import { formatAssistantMetaFooter as formatWebAssistantMetaFooter } from '../web/src/lib/assistantMetaFooter.ts';

describe('assistant meta footer', () => {
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
    ).toBe('5.2s | Codex | GPT-5.4 | xhigh');
    expect(
      formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('5.2s | Codex | GPT-5.4 | xhigh');
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
    ).toBe('2.0s | Claude | claude-opus-4.1');
    expect(
      formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('2.0s | Claude | claude-opus-4.1');
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
    ).toBe('4.5s | Codex | GPT-5.4');
    expect(
      formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('4.5s | Codex | GPT-5.4');
  });

  test('appends remaining usage only when the current primary window is below 30%', () => {
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
    ).toBe('5.2s | Codex | gpt-5.4 | xhigh | 28%(5h) | 72%(week)');
    expect(
      formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('5.2s | Codex | gpt-5.4 | xhigh | 28%(5h) | 72%(week)');
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
    ).toBe('5.2s | Codex | gpt-5.4 | xhigh');
    expect(formatWebAssistantCardFooter({ runtimeIdentity, tokenUsage })).toBe(
      '5.2s | Codex | gpt-5.4 | xhigh',
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
    ).toBe('Hello from assistant\n\n4.5s | Codex | GPT-5.4 | xhigh');
  });

  test('keeps original text when no footer parts are available', () => {
    expect(appendAssistantMetaFooter('Hello from assistant', {})).toBe(
      'Hello from assistant',
    );
  });
});
