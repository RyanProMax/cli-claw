import { describe, expect, test, vi } from 'vitest';

vi.mock('../src/workspace-runtime-reset.ts', () => ({
  resetWorkspaceRuntimeState: async (
    deps: {
      queue: { stopGroup: (jid: string, opts: { force: boolean }) => Promise<unknown> };
    },
    jid: string,
  ) => {
    await deps.queue.stopGroup(jid, { force: true });
  },
}));

import {
  applyRuntimeWorkspaceSelection,
  buildRuntimeStatusReply,
  executeRuntimeWorkspaceCommand,
  resolveRuntimeWorkspaceTarget,
} from '../src/runtime-command-handler.ts';
import type { RegisteredGroup } from '../src/types.ts';

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
  test('resolves IM chats to their home workspace runtime target', () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'codex',
        executionMode: 'host',
      },
      'feishu:room': {
        name: 'Project Room',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
      },
    });

    const target = resolveRuntimeWorkspaceTarget('feishu:room', deps);

    expect(target?.workspaceJid).toBe('web:proj-home');
    expect(target?.effectiveGroup.agentType).toBe('codex');
  });

  test('updates workspace model presets through the shared selection helper', async () => {
    const { deps, groups, setGroup, stopGroup } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'codex',
        executionMode: 'host',
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
        agentType: 'codex',
        executionMode: 'host',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
      'web:proj-child': {
        name: 'Child Workspace',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: false,
        agentType: 'codex',
        executionMode: 'host',
      },
    });

    const before = resolveRuntimeWorkspaceTarget('web:proj-child', deps);
    expect(before).not.toBeNull();
    expect(buildRuntimeStatusReply(before!)).toContain('当前模型: gpt-5.4');

    const result = await applyRuntimeWorkspaceSelection({
      chatJid: 'web:proj-child',
      selection: 'model',
      value: 'gpt-5.3-codex',
      deps,
    });

    const after = resolveRuntimeWorkspaceTarget('web:proj-child', deps);
    expect(after).not.toBeNull();

    expect(result).toEqual({
      handled: true,
      reply: '已将当前工作区模型切换为 gpt-5.3-codex',
    });
    expect(buildRuntimeStatusReply(after!)).toContain(
      '当前模型: gpt-5.3-codex',
    );
    expect(setGroup).toHaveBeenCalledWith(
      'web:proj-home',
      expect.objectContaining({ model: 'gpt-5.3-codex' }),
    );
    expect(groups['web:proj-home']?.model).toBe('gpt-5.3-codex');
    expect(stopGroup).toHaveBeenCalledWith('web:proj-home', { force: true });
  });

  test('returns picker-oriented help for bare /model without exposing the old usage form', async () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'codex',
        executionMode: 'host',
        model: 'gpt-5.4-mini',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'web',
      chatJid: 'web:proj-home',
      commandText: '/model',
      deps,
    });

    expect(result).toEqual({
      handled: true,
      reply: '可用模型：gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.2',
    });
  });

  test('returns command-only help without embedding runtime status lines', async () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'codex',
        executionMode: 'host',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'im',
      chatJid: 'web:proj-home',
      commandText: '/help',
      deps,
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('可用命令：');
    expect(result.reply).not.toContain('当前模型:');
    expect(result.reply).not.toContain('当前 runtime:');
  });

  test('rejects the legacy parameterized /model form and points users to the picker', async () => {
    const { deps, setGroup } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'codex',
        executionMode: 'host',
        model: 'gpt-5.4-mini',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'web',
      chatJid: 'web:proj-home',
      commandText: '/model gpt-5.4',
      deps,
    });

    expect(result).toEqual({
      handled: true,
      reply: '请直接输入 /model 打开模型选择器',
    });
    expect(setGroup).not.toHaveBeenCalled();
  });

  test('returns a clear unsupported message for bare /effort on claude workspaces', async () => {
    const { deps, setGroup } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'claude',
        executionMode: 'host',
        model: 'sonnet',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'web',
      chatJid: 'web:proj-home',
      commandText: '/effort',
      deps,
    });

    expect(result).toEqual({
      handled: true,
      reply: 'claude 不支持 /effort，可继续使用 /model 切换模型',
    });
    expect(setGroup).not.toHaveBeenCalled();
  });

  test('rejects the legacy parameterized /effort form and points users to the picker', async () => {
    const { deps, setGroup } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'codex',
        executionMode: 'host',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'web',
      chatJid: 'web:proj-home',
      commandText: '/effort xhigh',
      deps,
    });

    expect(result).toEqual({
      handled: true,
      reply: '请直接输入 /effort 打开思考强度选择器',
    });
    expect(setGroup).not.toHaveBeenCalled();
  });

  test('returns picker-oriented help for bare /effort on codex workspaces', async () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'codex',
        executionMode: 'host',
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
    });

    const result = await executeRuntimeWorkspaceCommand({
      entrypoint: 'web',
      chatJid: 'web:proj-home',
      commandText: '/effort',
      deps,
    });

    expect(result).toEqual({
      handled: true,
      reply: '可用思考强度：low, medium, high, xhigh',
    });
  });

  test('builds runtime status with concrete fallback defaults when workspace settings are unset', () => {
    const { deps } = createDeps({
      'web:proj-home': {
        name: 'Project Home',
        folder: 'proj',
        added_at: '2026-04-05T00:00:00.000Z',
        is_home: true,
        agentType: 'codex',
        executionMode: 'host',
      },
    });

    const target = resolveRuntimeWorkspaceTarget('web:proj-home', deps);
    expect(target).not.toBeNull();

    expect(buildRuntimeStatusReply(target!)).toContain('当前模型: gpt-5.4');
    expect(buildRuntimeStatusReply(target!)).toContain('当前思考强度: medium');
    expect(buildRuntimeStatusReply(target!)).toContain(
      '模型预设: gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.2',
    );
  });
});
