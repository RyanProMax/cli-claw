import { describe, expect, test } from 'vitest';

import {
  buildEffectiveGroupFromHomeSibling,
  hasRuntimeBoundaryChange,
  normalizeAgentType,
  resolveEffectiveRuntimeIdentity,
  validateGroupRuntimeUpdate,
} from '../src/core/runtime/group-runtime.js';

describe('normalizeAgentType', () => {
  test('maps historical codex rows and empty values to OpenAI', () => {
    expect(normalizeAgentType('codex')).toBe('openai');
    expect(normalizeAgentType(null)).toBe('openai');
    expect(normalizeAgentType(undefined)).toBe('openai');
  });

  test('preserves explicit Claude rows', () => {
    expect(normalizeAgentType('claude')).toBe('claude');
  });
});

describe('validateGroupRuntimeUpdate', () => {
  test('allows home workspaces to change agent when execution mode stays the same', () => {
    expect(
      validateGroupRuntimeUpdate({
        isHome: true,
        currentExecutionMode: 'host',
        nextAgentType: 'openai',
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

  test('allows OpenAI container execution mode', () => {
    expect(
      validateGroupRuntimeUpdate({
        isHome: false,
        currentExecutionMode: 'container',
        nextAgentType: 'openai',
        nextExecutionMode: 'container',
      }),
    ).toBeNull();
  });
});

describe('hasRuntimeBoundaryChange', () => {
  test('returns true when agent type changes', () => {
    expect(
      hasRuntimeBoundaryChange({
        currentAgentType: 'claude',
        currentExecutionMode: 'host',
        nextAgentType: 'openai',
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
  test('inherits openai host runtime from the sibling home workspace', () => {
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
          agentType: 'openai',
          executionMode: 'host',
          customCwd: '/srv/main',
          created_by: 'admin-1',
          is_home: true,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        agentType: 'openai',
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
          agentType: 'openai',
          executionMode: 'host',
          created_by: 'admin-1',
          is_home: true,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        created_by: 'member-1',
        agentType: 'openai',
        executionMode: 'host',
        is_home: true,
      }),
    );
  });
});

describe('resolveEffectiveRuntimeIdentity', () => {
  test('materializes OpenAI defaults before dispatch so runner config cannot drift from status', () => {
    expect(
      resolveEffectiveRuntimeIdentity({
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-12T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        executionMode: 'host',
      }),
    ).toEqual({
      agentType: 'openai',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      speedTier: 'standard',
      supportsReasoningEffort: true,
    });
  });

  test('uses caller-supplied OpenAI runtime fallback defaults when workspace runtime is unset', () => {
    expect(
      resolveEffectiveRuntimeIdentity(
        {
          name: 'Project Home',
          folder: 'proj',
          added_at: '2026-04-12T00:00:00.000Z',
          is_home: true,
          agentType: 'openai',
          executionMode: 'host',
        },
        {
          openAiModel: 'gpt-5.4',
          openAiReasoningEffort: 'xhigh',
          openAiSpeedTier: 'fast',
        },
      ),
    ).toEqual({
      agentType: 'openai',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
      supportsReasoningEffort: true,
    });
  });

  test('uses the explicit workspace effort as the effective OpenAI effort', () => {
    expect(
      resolveEffectiveRuntimeIdentity({
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-12T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        executionMode: 'host',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'high',
        speedTier: 'fast',
      }),
    ).toEqual({
      agentType: 'openai',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'high',
      speedTier: 'fast',
      supportsReasoningEffort: true,
    });
  });
});
