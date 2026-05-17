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

  test('maps legacy Claude container mode to OpenAI', () => {
    expect(
      normalizeWorkspaceRuntimeSelection({
        agentType: 'claude',
        executionMode: 'container',
      }),
    ).toEqual({
      agentType: 'openai',
      executionMode: 'container',
    });
  });

  test('maps legacy Claude host mode to OpenAI', () => {
    expect(
      normalizeWorkspaceRuntimeSelection({
        agentType: 'claude',
        executionMode: 'host',
      }),
    ).toEqual({
      agentType: 'openai',
      executionMode: 'host',
    });
  });
});
