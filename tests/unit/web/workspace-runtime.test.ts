import { describe, expect, test } from 'vitest';

import {
  normalizeWorkspaceRuntimeSelection,
} from '../../../web/src/lib/workspace-runtime.js';

describe('normalizeWorkspaceRuntimeSelection', () => {
  test('keeps OpenAI as the only runtime selection', () => {
    expect(
      normalizeWorkspaceRuntimeSelection({
        agentType: 'openai',
      }),
    ).toEqual({
      agentType: 'openai',
    });
  });

  test('maps unknown runtime input to OpenAI', () => {
    expect(
      normalizeWorkspaceRuntimeSelection({
        agentType: 'unknown',
      } as never),
    ).toEqual({
      agentType: 'openai',
    });
  });
});
