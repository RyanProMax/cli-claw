import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../../../src/agent/runner/workspace-reset.ts', () => ({
  resetWorkspaceRuntimeState: async (
    deps: {
      queue: {
        stopGroup: (jid: string, opts: { force: boolean }) => Promise<unknown>;
      };
    },
    jid: string,
  ) => {
    await deps.queue.stopGroup(jid, { force: true });
  },
}));

const getOpenAiRuntimeDefaultsMock = vi.hoisted(() =>
  vi.fn(() => ({ model: null, reasoningEffort: null, speedTier: null })),
);
const getAvailableRuntimeModelPresetsMock = vi.hoisted(() =>
  vi.fn((agentType: 'openai', options?: { currentModel?: string | null }) => {
    const presets = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2'];
    const currentModel = options?.currentModel?.trim();
    if (
      !currentModel ||
      presets.some(
        (value) => value.toLowerCase() === currentModel.toLowerCase(),
      )
    ) {
      return presets;
    }
    return [currentModel, ...presets];
  }),
);
const getAvailableRuntimeModelCatalogMock = vi.hoisted(() =>
  vi.fn((agentType: 'openai', options?: { currentModel?: string | null }) => ({
    options: getAvailableRuntimeModelPresetsMock(agentType, options).map(
      (value: string) => ({ value, label: value }),
    ),
    source: 'preset',
  })),
);
const normalizeAvailableRuntimeModelPresetMock = vi.hoisted(() =>
  vi.fn(
    (
      agentType: 'openai',
      rawValue: string,
      options?: { currentModel?: string | null },
    ) => {
      const normalized = rawValue.trim().toLowerCase();
      return (
        getAvailableRuntimeModelPresetsMock(agentType, options).find(
          (value: string) => value.toLowerCase() === normalized,
        ) ?? null
      );
    },
  ),
);

vi.mock('../../../../src/core/runtime/config.js', () => ({
  getOpenAiRuntimeDefaults: getOpenAiRuntimeDefaultsMock,
}));
vi.mock('../../../../src/core/runtime/model-options.js', () => ({
  getAvailableRuntimeModelCatalog: getAvailableRuntimeModelCatalogMock,
  getAvailableRuntimeModelPresets: getAvailableRuntimeModelPresetsMock,
  normalizeAvailableRuntimeModelPreset:
    normalizeAvailableRuntimeModelPresetMock,
}));

import {
  applyRuntimeWorkspaceSelection,
  buildRuntimeStatusReply,
  executeRuntimeWorkspaceCommand,
  resolveRuntimeWorkspaceTarget,
} from '../../../../src/core/runtime/command-handler.ts';
import type { RegisteredGroup } from '../../../../src/domain/types.ts';

function createDeps(groups: Record<string, RegisteredGroup>) {
  const setGroup = vi.fn((jid: string, group: RegisteredGroup) => {
    groups[jid] = group;
  });
  const stopGroup = vi.fn().mockResolvedValue(undefined);

  return {
    groups,
    setGroup,
    stopGroup,
    deps: {
      getGroup: (jid: string) => groups[jid],
      setGroup,
      getSiblingJids: (folder: string) =>
        Object.keys(groups).filter((jid) => groups[jid]?.folder === folder),
      getAgent: (agentId: string) =>
        agentId === 'agent-1'
          ? { id: agentId, chat_jid: 'web:proj-home', name: 'Planner' }
          : undefined,
      queue: {
        stopGroup,
      },
      getSessions: () => ({ proj: 'session-1' }),
    },
  };
}

describe('runtime command handler', () => {
  beforeEach(() => {
    getOpenAiRuntimeDefaultsMock.mockReturnValue({
      model: null,
      reasoningEffort: null,
      speedTier: null,
    });
    getAvailableRuntimeModelPresetsMock.mockImplementation(
      (agentType: 'openai', options?: { currentModel?: string | null }) => {
        const presets = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2'];
        const currentModel = options?.currentModel?.trim();
        if (
          !currentModel ||
          presets.some(
            (value) => value.toLowerCase() === currentModel.toLowerCase(),
          )
        ) {
          return presets;
        }
        return [currentModel, ...presets];
      },
    );
    getAvailableRuntimeModelCatalogMock.mockImplementation(
      (agentType: 'openai', options?: { currentModel?: string | null }) => ({
        options: getAvailableRuntimeModelPresetsMock(agentType, options).map(
          (value: string) => ({ value, label: value }),
        ),
        source: 'preset',
      }),
    );
    normalizeAvailableRuntimeModelPresetMock.mockImplementation(
      (
        agentType: 'openai',
        rawValue: string,
        options?: { currentModel?: string | null },
      ) => {
        const normalized = rawValue.trim().toLowerCase();
        return (
          getAvailableRuntimeModelPresetsMock(agentType, options).find(
            (value: string) => value.toLowerCase() === normalized,
          ) ?? null
        );
      },
    );
  });

  test('resolves IM chats to their home workspace runtime target', () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
      },
      'feishu:room': {
        name: 'Project Room',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
      },
    });

    const target = resolveRuntimeWorkspaceTarget('feishu:room', deps);

    expect(target?.workspaceJid).toBe('web:proj-home');
    expect(target?.effectiveGroup.agentType).toBe('openai');
  });

  test('updates workspace model presets through the shared selection helper', async () => {
    const { deps, groups, setGroup, stopGroup } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'medium',
      },
      'feishu:room': {
        name: 'Project Room',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
      },
    });

    const result = await applyRuntimeWorkspaceSelection({
      chatJid: 'feishu:room',
      selection: 'model',
      value: 'gpt-5.4',
      deps,
    });

    expect(result).toEqual({
      handled: true,
      reply: '已将当前工作区模型切换为 gpt-5.4',
    });
    expect(setGroup).toHaveBeenCalledWith(
      'web:proj-home',
      expect.objectContaining({ model: 'gpt-5.4' }),
    );
    expect(groups['web:proj-home']?.model).toBe('gpt-5.4');
    expect(stopGroup).toHaveBeenCalledWith('web:proj-home', { force: true });
  });

  test('updates the effective runtime owner so status reflects model changes for inherited workspaces', async () => {
    const { deps, groups, setGroup, stopGroup } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
      'web:proj-child': {
        name: 'Child Workspace',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: false,
        agentType: 'openai',
      },
    });

    const before = resolveRuntimeWorkspaceTarget('web:proj-child', deps);
    expect(before).not.toBeNull();
    expect(buildRuntimeStatusReply(before!)).toContain('🧠 当前模型: gpt-5.4');

    const result = await applyRuntimeWorkspaceSelection({
      chatJid: 'web:proj-child',
      selection: 'model',
      value: 'gpt-5.2',
      deps,
    });

    const after = resolveRuntimeWorkspaceTarget('web:proj-child', deps);
    expect(after).not.toBeNull();

    expect(result).toEqual({
      handled: true,
      reply: '已将当前工作区模型切换为 gpt-5.2',
    });
    expect(buildRuntimeStatusReply(after!)).toContain('🧠 当前模型: gpt-5.2');
    expect(setGroup).toHaveBeenCalledWith(
      'web:proj-home',
      expect.objectContaining({ model: 'gpt-5.2' }),
    );
    expect(groups['web:proj-home']?.model).toBe('gpt-5.2');
    expect(stopGroup).toHaveBeenCalledWith('web:proj-home', { force: true });
  });

  test('returns combined OpenAI configuration help for bare /openai', async () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        model: 'gpt-5.4-mini',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'web',
      chatJid: 'web:proj-home',
      commandText: '/openai',
      deps,
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('OpenAI 配置：');
    expect(result.reply).toContain('当前模型：gpt-5.4-mini');
    expect(result.reply).toContain('可用模型：gpt-5.4, gpt-5.4-mini, gpt-5.2');
    expect(result.reply).toContain('当前思考强度：medium');
    expect(result.reply).toContain('可用思考强度：low, medium, high, xhigh');
    expect(result.reply).toContain('当前速度：standard (1x)');
    expect(result.reply).toContain('可用速度：standard (1x), fast (2x)');
  });

  test('surfaces dynamically discovered openai models in bare /openai replies', async () => {
    getAvailableRuntimeModelPresetsMock.mockImplementation(
      (agentType: 'openai', options?: { currentModel?: string | null }) => {
        const presets = ['gpt-5.4', 'gpt-5.5', 'gpt-5.5-pro'];
        const currentModel = options?.currentModel?.trim();
        return currentModel &&
          !presets.some(
            (value) => value.toLowerCase() === currentModel.toLowerCase(),
          )
          ? [currentModel, ...presets]
          : presets;
      },
    );

    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        model: 'gpt-5.4-mini',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'web',
      chatJid: 'web:proj-home',
      commandText: '/openai',
      deps,
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain(
      '可用模型：gpt-5.4-mini, gpt-5.4, gpt-5.5, gpt-5.5-pro',
    );
  });

  test('returns command-only help without embedding runtime status lines', async () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'im',
      chatJid: 'web:proj-home',
      commandText: '/help',
      deps,
    });

    expect(result.handled).toBe(true);
    expect(result.reply).not.toContain('可用命令：');
    expect(result.reply).toContain('Agent 命令：');
    expect(result.reply).not.toContain('当前模型:');
    expect(result.reply).not.toContain('当前 runtime:');
  });

  test('does not handle removed standalone runtime setting commands', async () => {
    const { deps, setGroup } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        model: 'gpt-5.4-mini',
      },
    });

    for (const commandText of ['/model', '/effort', '/speed']) {
      const result = await executeRuntimeWorkspaceCommand({
        entrypoint: 'web',
        chatJid: 'web:proj-home',
        commandText,
        deps,
      });

      expect(result).toEqual({ handled: false, reply: null });
    }
    expect(setGroup).not.toHaveBeenCalled();
  });

  test('accepts dynamically discovered openai models when applying a selection', async () => {
    getAvailableRuntimeModelPresetsMock.mockImplementation(
      (agentType: 'openai', options?: { currentModel?: string | null }) => {
        const presets = ['gpt-5.4', 'gpt-5.5', 'gpt-5.5-pro'];
        const currentModel = options?.currentModel?.trim();
        return currentModel &&
          !presets.some(
            (value) => value.toLowerCase() === currentModel.toLowerCase(),
          )
          ? [currentModel, ...presets]
          : presets;
      },
    );

    const { deps, groups } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
    });

    const result = await applyRuntimeWorkspaceSelection({
      chatJid: 'web:proj-home',
      selection: 'model',
      value: 'gpt-5.5-pro',
      deps,
    });

    expect(result).toEqual({
      handled: true,
      reply: '已将当前工作区模型切换为 gpt-5.5-pro',
    });
    expect(groups['web:proj-home']?.model).toBe('gpt-5.5-pro');
  });

  test('rejects the parameterized /openai form and points users to the picker', async () => {
    const { deps, setGroup } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'web',
      chatJid: 'web:proj-home',
      commandText: '/openai gpt-5.4',
      deps,
    });

    expect(result).toEqual({
      handled: true,
      reply: '请直接输入 /openai 打开 OpenAI 配置选择器',
    });
    expect(setGroup).not.toHaveBeenCalled();
  });

  test('ignores removed Claude configuration command', async () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'web',
      chatJid: 'web:proj-home',
      commandText: '/claude',
      deps,
    });

    expect(result).toEqual({
      handled: false,
      reply: null,
    });
  });

  test('builds runtime status with concrete fallback defaults when workspace settings are unset', () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
      },
    });

    const target = resolveRuntimeWorkspaceTarget('web:proj-home', deps);
    expect(target).not.toBeNull();

    expect(buildRuntimeStatusReply(target!)).toContain('🤖 Agent');
    expect(buildRuntimeStatusReply(target!)).toContain('🤖 当前 Agent: openai');
    expect(buildRuntimeStatusReply(target!)).toContain('🧠 当前模型: gpt-5.4');
    expect(buildRuntimeStatusReply(target!)).toContain(
      '⚙️ 当前推理强度: medium',
    );
    expect(buildRuntimeStatusReply(target!)).toContain(
      '🚀 当前速度: standard (1x)',
    );
    expect(buildRuntimeStatusReply(target!)).not.toContain('当前 runtime:');
    expect(buildRuntimeStatusReply(target!)).not.toContain('模型预设:');
  });

  test('uses OpenAI runtime fallback when workspace settings are unset', () => {
    getOpenAiRuntimeDefaultsMock.mockReturnValue({
      model: 'gpt-5.4-mini',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
    });
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
      },
    });

    const target = resolveRuntimeWorkspaceTarget('web:proj-home', deps);

    expect(target).not.toBeNull();
    expect(buildRuntimeStatusReply(target!)).toContain(
      '🧠 当前模型: gpt-5.4-mini',
    );
    expect(buildRuntimeStatusReply(target!)).toContain(
      '⚙️ 当前推理强度: xhigh',
    );
    expect(buildRuntimeStatusReply(target!)).toContain(
      '🚀 当前速度: fast (2x)',
    );
  });

  test('exposes one effective runtime identity for status, picker cards, and dispatch fallback', () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-12T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        reasoningEffort: 'high',
      },
    });

    const target = resolveRuntimeWorkspaceTarget('web:proj-home', deps);

    expect(target?.effectiveRuntimeIdentity).toEqual({
      agentType: 'openai',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      speedTier: 'standard',
      supportsReasoningEffort: true,
    });
    expect(buildRuntimeStatusReply(target!)).toContain('⚙️ 当前推理强度: high');
  });

  test('updates workspace speed presets through the shared selection helper', async () => {
    const { deps, groups, setGroup, stopGroup } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'openai',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
        speedTier: 'standard',
      },
    });

    const result = await applyRuntimeWorkspaceSelection({
      chatJid: 'web:proj-home',
      selection: 'speed',
      value: 'fast',
      deps,
    });

    expect(result).toEqual({
      handled: true,
      reply: '已将当前工作区速度切换为 fast',
    });
    expect(setGroup).toHaveBeenCalledWith(
      'web:proj-home',
      expect.objectContaining({ speedTier: 'fast' }),
    );
    expect(groups['web:proj-home']?.speedTier).toBe('fast');
    expect(stopGroup).toHaveBeenCalledWith('web:proj-home', { force: true });
  });
});
