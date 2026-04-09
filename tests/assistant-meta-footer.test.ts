import { describe, expect, test } from 'vitest';

import { appendAssistantMetaFooter } from '../src/assistant-meta-footer.ts';
import { formatAssistantCardFooter as formatBackendAssistantCardFooter } from '../src/assistant-meta-footer.ts';
import { formatAssistantMetaFooter as formatBackendAssistantMetaFooter } from '../src/assistant-meta-footer.ts';
import { formatAssistantCardFooter as formatWebAssistantCardFooter } from '../web/src/lib/assistantMetaFooter.ts';
import { formatAssistantMetaFooter as formatWebAssistantMetaFooter } from '../web/src/lib/assistantMetaFooter.ts';

describe('assistant meta footer', () => {
  test('formats duration, model, reasoning effort, tokens, and cost in fixed order', () => {
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
    ).toBe('5.2s | GPT-5.4 | xhigh | 12.3K tokens | $0.0421');
    expect(
      formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('5.2s | GPT-5.4 | xhigh | 12.3K tokens | $0.0421');
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
    ).toBe('2.0s | claude-opus-4.1 | 2.5K tokens | $0.0100');
    expect(
      formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('2.0s | claude-opus-4.1 | 2.5K tokens | $0.0100');
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
    ).toBe('4.5s | GPT-5.4 | 1.2K tokens');
    expect(
      formatWebAssistantMetaFooter({ runtimeIdentity, tokenUsage }),
    ).toBe('4.5s | GPT-5.4 | 1.2K tokens');
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
    ).toBe('Hello from assistant\n\n4.5s | GPT-5.4 | xhigh | 1.2K tokens');
  });

  test('keeps original text when no footer parts are available', () => {
    expect(appendAssistantMetaFooter('Hello from assistant', {})).toBe(
      'Hello from assistant',
    );
  });
});
