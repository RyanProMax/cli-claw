import { describe, expect, test } from 'vitest';

import {
  formatRuntimeIdentityFooter as formatBackendRuntimeIdentityFooter,
  mergeRuntimeIdentity,
  parseRuntimeIdentity,
  serializeRuntimeIdentity,
} from '../../../../src/core/runtime/identity.ts';
import { formatRuntimeIdentityFooter as formatWebRuntimeIdentityFooter } from '../../../../web/src/lib/runtimeIdentity.ts';

describe('runtime identity helpers', () => {
  test('formats model and reasoning effort when both are exact', () => {
    const identity = {
      agentType: 'openai' as const,
      model: 'GPT-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };

    expect(formatBackendRuntimeIdentityFooter(identity)).toBe(
      'GPT-5.4 | xhigh | standard (1x)',
    );
    expect(formatWebRuntimeIdentityFooter(identity)).toBe(
      'GPT-5.4 | xhigh | standard (1x)',
    );
  });

  test('shows model only when reasoning effort is not applicable', () => {
    const identity = {
      agentType: 'legacy' as const,
      model: 'legacy-model',
      supportsReasoningEffort: false,
    };

    expect(formatBackendRuntimeIdentityFooter(identity)).toBe('legacy-model');
    expect(formatWebRuntimeIdentityFooter(identity)).toBe('legacy-model');
  });

  test('shows OpenAI speed tier when reasoning effort is missing', () => {
    const identity = {
      agentType: 'openai' as const,
      model: 'GPT-5.4',
    };

    expect(formatBackendRuntimeIdentityFooter(identity)).toBe(
      'GPT-5.4 | standard (1x)',
    );
    expect(formatWebRuntimeIdentityFooter(identity)).toBe(
      'GPT-5.4 | standard (1x)',
    );
  });

  test('serializes and parses normalized runtime identity payloads', () => {
    const serialized = serializeRuntimeIdentity({
      agentType: 'openai',
      model: ' GPT-5.4 ',
      reasoningEffort: ' xhigh ',
      speedTier: ' fast ',
      supportsReasoningEffort: true,
    });

    expect(serialized).toBeTruthy();
    expect(parseRuntimeIdentity(serialized)).toEqual({
      agentType: 'openai',
      model: 'GPT-5.4',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
      supportsReasoningEffort: true,
    });
  });

  test('parses historical codex runtime identity as OpenAI', () => {
    expect(
      parseRuntimeIdentity(
        JSON.stringify({
          agentType: 'codex',
          model: 'gpt-5.5',
          reasoningEffort: 'medium',
        }),
      ),
    ).toEqual({
      agentType: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      speedTier: 'standard',
      supportsReasoningEffort: null,
    });

    expect(
      formatWebRuntimeIdentityFooter({
        agentType: 'codex',
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
      }),
    ).toBe('gpt-5.5 | medium | standard (1x)');
  });

  test('preserves existing OpenAI speed when runtime update omits speed tier', () => {
    expect(
      mergeRuntimeIdentity(
        {
          agentType: 'openai',
          model: 'gpt-5.5',
          reasoningEffort: 'xhigh',
          speedTier: 'fast',
          supportsReasoningEffort: true,
        },
        {
          agentType: 'openai',
          model: 'gpt-5.5',
          reasoningEffort: 'xhigh',
          speedTier: null,
          supportsReasoningEffort: true,
        },
      ),
    ).toEqual({
      agentType: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
      supportsReasoningEffort: true,
    });
  });
});
