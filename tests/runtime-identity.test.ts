import { describe, expect, test } from 'vitest';

import {
  formatRuntimeIdentityFooter as formatBackendRuntimeIdentityFooter,
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

    expect(formatBackendRuntimeIdentityFooter(identity)).toBe('GPT-5.4 | xhigh');
    expect(formatWebRuntimeIdentityFooter(identity)).toBe('GPT-5.4 | xhigh');
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

  test('hides footer when reasoning effort support is unknown and effort is missing', () => {
    const identity = {
      agentType: 'codex' as const,
      model: 'GPT-5.4',
    };

    expect(formatBackendRuntimeIdentityFooter(identity)).toBeNull();
    expect(formatWebRuntimeIdentityFooter(identity)).toBeNull();
  });

  test('serializes and parses normalized runtime identity payloads', () => {
    const serialized = serializeRuntimeIdentity({
      agentType: 'codex',
      model: ' GPT-5.4 ',
      reasoningEffort: ' xhigh ',
      supportsReasoningEffort: true,
    });

    expect(serialized).toBeTruthy();
    expect(parseRuntimeIdentity(serialized)).toEqual({
      agentType: 'codex',
      model: 'GPT-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    });
  });
});
