import { describe, expect, test } from 'vitest';

import {
  formatRuntimeIdentityFooter as formatBackendRuntimeIdentityFooter,
  mergeRuntimeIdentity,
  parseRuntimeIdentity,
  serializeRuntimeIdentity,
} from '../src/runtime-identity.ts';
import { formatRuntimeIdentityFooter as formatWebRuntimeIdentityFooter } from '../web/src/lib/runtimeIdentity.ts';

describe('runtime identity helpers', () => {
  test('formats model and reasoning effort when both are exact', () => {
    const identity = {
      agentType: 'codex' as const,
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
      agentType: 'claude' as const,
      model: 'claude-opus-4.1',
      supportsReasoningEffort: false,
    };

    expect(formatBackendRuntimeIdentityFooter(identity)).toBe('claude-opus-4.1');
    expect(formatWebRuntimeIdentityFooter(identity)).toBe('claude-opus-4.1');
  });

  test('shows Codex speed tier when reasoning effort is missing', () => {
    const identity = {
      agentType: 'codex' as const,
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
      agentType: 'codex',
      model: ' GPT-5.4 ',
      reasoningEffort: ' xhigh ',
      speedTier: ' fast ',
      supportsReasoningEffort: true,
    });

    expect(serialized).toBeTruthy();
    expect(parseRuntimeIdentity(serialized)).toEqual({
      agentType: 'codex',
      model: 'GPT-5.4',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
      supportsReasoningEffort: true,
    });
  });

  test('preserves existing Codex speed when runtime update omits speed tier', () => {
    expect(
      mergeRuntimeIdentity(
        {
          agentType: 'codex',
          model: 'gpt-5.5',
          reasoningEffort: 'xhigh',
          speedTier: 'fast',
          supportsReasoningEffort: true,
        },
        {
          agentType: 'codex',
          model: 'gpt-5.5',
          reasoningEffort: 'xhigh',
          speedTier: null,
          supportsReasoningEffort: true,
        },
      ),
    ).toEqual({
      agentType: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
      supportsReasoningEffort: true,
    });
  });
});
