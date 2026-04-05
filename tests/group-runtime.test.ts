import { describe, expect, test } from 'vitest';

import {
  buildEffectiveGroupFromHomeSibling,
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

describe('buildEffectiveGroupFromHomeSibling', () => {
  test('inherits codex host runtime from the sibling home workspace', () => {
    expect(
      buildEffectiveGroupFromHomeSibling(
        {
          name: 'Feishu Ops',
          folder: 'main',
          added_at: '2026-04-05T10:00:00.000Z',
          agentType: 'claude',
          executionMode: 'container',
          is_home: false,
          created_by: 'admin-1',
        },
        {
          name: 'Main',
          folder: 'main',
          added_at: '2026-04-05T09:00:00.000Z',
          agentType: 'codex',
          executionMode: 'host',
          customCwd: '/srv/main',
          created_by: 'admin-1',
          is_home: true,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        agentType: 'codex',
        executionMode: 'host',
        customCwd: '/srv/main',
        is_home: true,
        folder: 'main',
        name: 'Feishu Ops',
      }),
    );
  });

  test('keeps explicit IM owner while inheriting the home runtime', () => {
    expect(
      buildEffectiveGroupFromHomeSibling(
        {
          name: 'Feishu Ops',
          folder: 'main',
          added_at: '2026-04-05T10:00:00.000Z',
          created_by: 'member-1',
          is_home: false,
        },
        {
          name: 'Main',
          folder: 'main',
          added_at: '2026-04-05T09:00:00.000Z',
          agentType: 'codex',
          executionMode: 'host',
          created_by: 'admin-1',
          is_home: true,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        created_by: 'member-1',
        agentType: 'codex',
        executionMode: 'host',
        is_home: true,
      }),
    );
  });
});
