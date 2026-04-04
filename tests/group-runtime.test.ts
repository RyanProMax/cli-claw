import { describe, expect, test } from 'vitest';

import {
  hasRuntimeBoundaryChange,
  validateGroupRuntimeUpdate,
} from '../src/group-runtime.js';

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

describe('hasRuntimeBoundaryChange', () => {
  test('returns true when agent type changes', () => {
    expect(
      hasRuntimeBoundaryChange({
        currentAgentType: 'claude',
        currentExecutionMode: 'host',
        nextAgentType: 'codex',
        nextExecutionMode: 'host',
      }),
    ).toBe(true);
  });

  test('returns true when execution mode changes', () => {
    expect(
      hasRuntimeBoundaryChange({
        currentAgentType: 'claude',
        currentExecutionMode: 'container',
        nextAgentType: 'claude',
        nextExecutionMode: 'host',
      }),
    ).toBe(true);
  });

  test('returns false when runtime boundary stays the same', () => {
    expect(
      hasRuntimeBoundaryChange({
        currentAgentType: 'claude',
        currentExecutionMode: 'host',
        nextAgentType: 'claude',
        nextExecutionMode: 'host',
      }),
    ).toBe(false);
  });
});
