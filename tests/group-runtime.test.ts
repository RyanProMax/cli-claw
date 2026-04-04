import { describe, expect, test } from 'vitest';

import { validateGroupRuntimeUpdate } from '../src/group-runtime.js';

describe('validateGroupRuntimeUpdate', () => {
  test('allows home workspaces to change agent when execution mode stays the same', () => {
    expect(
      validateGroupRuntimeUpdate({
        isHome: true,
        currentExecutionMode: 'host',
        nextAgentType: 'codex',
        nextExecutionMode: 'host',
      }),
    ).toBeNull();
  });

  test('rejects execution mode changes for home workspaces', () => {
    expect(
      validateGroupRuntimeUpdate({
        isHome: true,
        currentExecutionMode: 'host',
        nextAgentType: 'claude',
        nextExecutionMode: 'container',
      }),
    ).toBe('Cannot change execution mode of home containers');
  });

  test('still enforces codex host-mode requirement', () => {
    expect(
      validateGroupRuntimeUpdate({
        isHome: false,
        currentExecutionMode: 'container',
        nextAgentType: 'codex',
        nextExecutionMode: 'container',
      }),
    ).toBe('Codex only supports host execution mode');
  });
});
