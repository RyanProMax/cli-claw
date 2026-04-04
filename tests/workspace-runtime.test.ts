import { describe, expect, test } from 'vitest';

import {
  normalizeWorkspaceRuntimeSelection,
} from '../web/src/lib/workspace-runtime.js';

describe('normalizeWorkspaceRuntimeSelection', () => {
  test('forces Codex to host mode', () => {
    expect(
      normalizeWorkspaceRuntimeSelection({
        agentType: 'codex',
        executionMode: 'container',
      }),
    ).toEqual({
      agentType: 'codex',
      executionMode: 'host',
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
