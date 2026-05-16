import { describe, expect, test } from 'vitest';

import {
  normalizeWorkspaceRuntimeSelection,
} from '../../../web/src/lib/workspace-runtime.js';

describe('normalizeWorkspaceRuntimeSelection', () => {
  test('preserves OpenAI container mode', () => {
    expect(
      normalizeWorkspaceRuntimeSelection({
        agentType: 'openai',
        executionMode: 'container',
      }),
    ).toEqual({
      agentType: 'openai',
      executionMode: 'container',
    });
  });

  test('preserves Claude container mode', () => {
    expect(
      normalizeWorkspaceRuntimeSelection({
        agentType: 'claude',
        executionMode: 'container',
      }),
    ).toEqual({
      agentType: 'claude',
      executionMode: 'container',
    });
  });

  test('preserves Claude host mode', () => {
    expect(
      normalizeWorkspaceRuntimeSelection({
        agentType: 'claude',
        executionMode: 'host',
      }),
    ).toEqual({
      agentType: 'claude',
      executionMode: 'host',
    });
  });
});
