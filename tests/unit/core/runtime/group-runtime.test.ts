import { describe, expect, test } from 'vitest';

import {
  buildEffectiveGroupFromHomeSibling,
  normalizeAgentType,
  resolveEffectiveRuntimeIdentity,
} from '../../../../src/core/runtime/group-runtime.js';

describe('normalizeAgentType', () => {
  test('maps historical codex rows and empty values to OpenAI', () => {
    expect(normalizeAgentType('codex')).toBe('openai');
    expect(normalizeAgentType(null)).toBe('openai');
    expect(normalizeAgentType(undefined)).toBe('openai');
  });

  test('maps legacy Claude rows to OpenAI', () => {
    expect(normalizeAgentType('claude')).toBe('openai');
  });
});

describe('buildEffectiveGroupFromHomeSibling', () => {
  test('inherits openai runtime settings and cwd from the sibling home workspace', () => {
    expect(
      buildEffectiveGroupFromHomeSibling(
        {
          name: 'Feishu Ops',
          folder: 'main',
          added_at: '2026-04-05T10:00:00.000Z',
          agentType: 'claude' as never,
          is_home: false,
          created_by: 'admin-1',
        },
        {
          name: 'Main',
          folder: 'main',
          added_at: '2026-04-05T09:00:00.000Z',
          agentType: 'openai',
          customCwd: '/srv/main',
          created_by: 'admin-1',
          is_home: true,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        agentType: 'openai',
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
          created_by: 'admin-1',
          is_home: true,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        created_by: 'member-1',
        agentType: 'openai',
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
