import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRegisteredGroup: vi.fn(),
  getAllRegisteredGroups: vi.fn(),
  getAllChats: vi.fn(),
  deleteMessage: vi.fn(),
  deleteGroupData: vi.fn(),
  deletePrimaryRuntimeSessions: vi.fn(),
  ensureChatExists: vi.fn(),
  getAgent: vi.fn(),
  getGroupsByTargetAgent: vi.fn(),
  getMessage: vi.fn(),
  getMessagesAfter: vi.fn(),
  getMessagesAfterMulti: vi.fn(),
  getMessagesPage: vi.fn(),
  getMessagesPageMulti: vi.fn(),
  storeMessageDirect: vi.fn(),
  setRegisteredGroup: vi.fn(),
  updateChatName: vi.fn(),
  getJidsByFolder: vi.fn(),
  listAgentsByJid: vi.fn(),
  deleteSession: vi.fn(),
  getWebDeps: vi.fn(),
  canModifyGroup: vi.fn(),
  stopGroup: vi.fn(),
  isRuntimeBuildStale: vi.fn(),
  getRuntimeBuildStatus: vi.fn(),
  broadcastNewMessage: vi.fn(),
  invalidateAllowedUserCache: vi.fn(),
  fsExistsSync: vi.fn(),
  fsReaddirSync: vi.fn(),
  fsRmSync: vi.fn(),
  materializeWorkspaceDefaultCwd: vi.fn(),
  resetWorkspaceAgentSessionState: vi.fn(),
  validateWorkspaceCwd: vi.fn(),
  resolveEffectiveWorkspaceCwd: vi.fn(),
  clearSessionJsonlFiles: vi.fn(),
  canDeleteGroup: vi.fn(),
  getOpenAiRuntimeDefaults: vi.fn(),
  getAvailableRuntimeModelOptions: vi.fn(),
  getAvailableRuntimeModelPresets: vi.fn(),
  normalizeAvailableRuntimeModelPreset: vi.fn(),
}));

vi.mock('../../../src/web/middleware/auth.js', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('sessionId', 'session-1');
    await next();
  },
}));

vi.mock('../../../src/core/app-root.js', () => ({
  APP_ROOT: '/repo/root',
  LAUNCH_CWD: '/launch/cwd',
  PACKAGE_ROOT: '/repo/root',
  resolveAppPath: (...segments: string[]) =>
    ['/repo/root', ...segments].join('/'),
  resolvePackagePath: (...segments: string[]) =>
    ['/repo/root', ...segments].join('/'),
  resolvePackageDependency: (specifier: string) =>
    `/repo/root/node_modules/${specifier}`,
}));

vi.mock('../../../src/storage/db.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/storage/db.js')
  >('../../../src/storage/db.js');
  return {
    ...actual,
    getRegisteredGroup: mocks.getRegisteredGroup,
    getAllRegisteredGroups: mocks.getAllRegisteredGroups,
    getAllChats: mocks.getAllChats,
    deleteMessage: mocks.deleteMessage,
    deleteGroupData: mocks.deleteGroupData,
    deletePrimaryRuntimeSessions: mocks.deletePrimaryRuntimeSessions,
    ensureChatExists: mocks.ensureChatExists,
    getAgent: mocks.getAgent,
    getGroupsByTargetAgent: mocks.getGroupsByTargetAgent,
    getMessage: mocks.getMessage,
    getMessagesAfter: mocks.getMessagesAfter,
    getMessagesAfterMulti: mocks.getMessagesAfterMulti,
    getMessagesPage: mocks.getMessagesPage,
    getMessagesPageMulti: mocks.getMessagesPageMulti,
    storeMessageDirect: mocks.storeMessageDirect,
    setRegisteredGroup: mocks.setRegisteredGroup,
    updateChatName: mocks.updateChatName,
    getJidsByFolder: mocks.getJidsByFolder,
    listAgentsByJid: mocks.listAgentsByJid,
    deleteSession: mocks.deleteSession,
  };
});

vi.mock('../../../src/storage/messages.js', () => ({
  deleteMessage: mocks.deleteMessage,
  ensureChatExists: mocks.ensureChatExists,
  getAllChats: mocks.getAllChats,
  getMessage: mocks.getMessage,
  getMessagesAfter: mocks.getMessagesAfter,
  getMessagesAfterMulti: mocks.getMessagesAfterMulti,
  getMessagesPage: mocks.getMessagesPage,
  getMessagesPageMulti: mocks.getMessagesPageMulti,
  storeMessageDirect: mocks.storeMessageDirect,
  updateChatName: mocks.updateChatName,
}));

vi.mock('../../../src/storage/workspaces.js', () => ({
  deleteGroupData: mocks.deleteGroupData,
  getAllRegisteredGroups: mocks.getAllRegisteredGroups,
  getGroupsByTargetAgent: mocks.getGroupsByTargetAgent,
  getJidsByFolder: mocks.getJidsByFolder,
  getRegisteredGroup: mocks.getRegisteredGroup,
  setRegisteredGroup: mocks.setRegisteredGroup,
}));

vi.mock('../../../src/storage/agents.js', () => ({
  deletePrimaryRuntimeSessions: mocks.deletePrimaryRuntimeSessions,
  getAgent: mocks.getAgent,
  listAgentsByJid: mocks.listAgentsByJid,
}));

vi.mock('../../../src/web/context.js', () => ({
  getWebDeps: mocks.getWebDeps,
  canModifyGroup: mocks.canModifyGroup,
  canDeleteGroup: mocks.canDeleteGroup,
  MAX_GROUP_NAME_LEN: 40,
}));

vi.mock('../../../src/core/runtime/build.js', () => ({
  isRuntimeBuildStale: mocks.isRuntimeBuildStale,
  getRuntimeBuildStatus: mocks.getRuntimeBuildStatus,
}));

vi.mock('../../../src/core/runtime/config.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/core/runtime/config.js')
  >('../../../src/core/runtime/config.js');
  return {
    ...actual,
    getOpenAiRuntimeDefaults: mocks.getOpenAiRuntimeDefaults,
  };
});

vi.mock('../../../src/core/runtime/model-options.js', () => ({
  getAvailableRuntimeModelOptions: mocks.getAvailableRuntimeModelOptions,
  getAvailableRuntimeModelPresets: mocks.getAvailableRuntimeModelPresets,
  normalizeAvailableRuntimeModelPreset:
    mocks.normalizeAvailableRuntimeModelPreset,
}));

vi.mock('../../../src/core/workspace/workspace-cwd.js', () => ({
  materializeWorkspaceDefaultCwd: mocks.materializeWorkspaceDefaultCwd,
  validateWorkspaceCwd: mocks.validateWorkspaceCwd,
  resolveEffectiveWorkspaceCwd: mocks.resolveEffectiveWorkspaceCwd,
}));

vi.mock('../../../src/web/app.js', () => ({
  broadcastNewMessage: mocks.broadcastNewMessage,
  invalidateAllowedUserCache: mocks.invalidateAllowedUserCache,
}));

vi.mock('../../../src/agent/runner/workspace-reset.js', () => ({
  clearSessionJsonlFiles: mocks.clearSessionJsonlFiles,
  resetWorkspaceAgentSessionState: mocks.resetWorkspaceAgentSessionState,
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual.default,
      existsSync: mocks.fsExistsSync,
      readdirSync: mocks.fsReaddirSync,
      rmSync: mocks.fsRmSync,
    },
    existsSync: mocks.fsExistsSync,
    readdirSync: mocks.fsReaddirSync,
    rmSync: mocks.fsRmSync,
  };
});

import groupRoutes from '../../../src/web/routes/groups.js';

function createApp() {
  const app = new Hono();
  app.route('/api/groups', groupRoutes);
  return app;
}

describe('group runtime stale-build guard', () => {
  let registeredGroups: Record<string, any>;
  let sessions: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();

    registeredGroups = {
      'web:main': {
        name: 'Main',
        folder: 'main',
        added_at: '2026-04-04T10:00:00.000Z',
        created_by: null,
        is_home: true,
        agentType: 'openai',
      },
    };
    sessions = { main: 'session-1' };

    mocks.getRegisteredGroup.mockImplementation(
      (jid: string) => registeredGroups[jid],
    );
    mocks.setRegisteredGroup.mockImplementation((jid: string, group: any) => {
      registeredGroups[jid] = group;
    });
    mocks.getAllRegisteredGroups.mockImplementation(() => registeredGroups);
    mocks.getAllChats.mockReturnValue([]);
    mocks.getMessagesPage.mockReturnValue({ messages: [], hasMore: false });
    mocks.getMessagesAfter.mockReturnValue([]);
    mocks.getMessagesAfterMulti.mockReturnValue([]);
    mocks.getMessagesPageMulti.mockReturnValue([]);
    mocks.getGroupsByTargetAgent.mockReturnValue([]);
    mocks.getAgent.mockReturnValue(undefined);
    mocks.getJidsByFolder.mockReturnValue(['web:main']);
    mocks.listAgentsByJid.mockReturnValue([]);
    mocks.canModifyGroup.mockReturnValue(true);
    mocks.stopGroup.mockResolvedValue(undefined);
    mocks.resetWorkspaceAgentSessionState.mockImplementation(
      async (deps: any, jid: string, group: any) => {
        await mocks.stopGroup(jid, { force: true });
        delete deps.getSessions()[group.folder];
        return undefined;
      },
    );
    mocks.materializeWorkspaceDefaultCwd.mockImplementation(
      (group: any) => {
        if (!group.customCwd) {
          return {
            group: { ...group, customCwd: '/launch/cwd' },
            materialized: true,
          };
        }
        return { group, materialized: false };
      },
    );
    mocks.getOpenAiRuntimeDefaults.mockReturnValue({
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      speedTier: 'standard',
    });
    mocks.getAvailableRuntimeModelOptions.mockReturnValue([
      { value: 'gpt-5.5', label: 'GPT-5.5 (current)' },
      { value: 'gpt-5.4', label: 'GPT-5.4' },
    ]);
    mocks.getAvailableRuntimeModelPresets.mockReturnValue([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
    ]);
    mocks.normalizeAvailableRuntimeModelPreset.mockImplementation(
      (
        _agentType: string,
        rawValue: string,
        options?: { currentModel?: string | null },
      ) => {
        const value = rawValue.trim();
        if (options?.currentModel === value) return value;
        if (['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5'].includes(value)) {
          return value;
        }
        return null;
      },
    );
    mocks.getWebDeps.mockReturnValue({
      queue: {
        stopGroup: mocks.stopGroup,
      },
      getRegisteredGroups: () => registeredGroups,
      getSessions: () => sessions,
    });
    mocks.isRuntimeBuildStale.mockReturnValue(false);
    mocks.fsExistsSync.mockReturnValue(false);
    mocks.fsReaddirSync.mockReturnValue([]);
    mocks.fsRmSync.mockReturnValue(undefined);
    mocks.getRuntimeBuildStatus.mockReturnValue({
      pid: 1234,
      startedAt: '2026-04-04T10:00:00.000Z',
      stale: true,
      backend: {
        stale: true,
        loaded: {
          path: '/tmp/backend',
          version: '1.0.0',
          exists: true,
          mtimeMs: 1,
          mtimeIso: '2026-04-04T10:00:00.000Z',
        },
        current: {
          path: '/tmp/backend',
          version: '1.0.0',
          exists: true,
          mtimeMs: 2,
          mtimeIso: '2026-04-04T10:01:00.000Z',
        },
      },
      agentRunner: {
        stale: false,
        loaded: {
          path: '/tmp/runner',
          version: '1.0.0',
          exists: true,
          mtimeMs: 1,
          mtimeIso: '2026-04-04T10:00:00.000Z',
        },
        current: {
          path: '/tmp/runner',
          version: '1.0.0',
          exists: true,
          mtimeMs: 1,
          mtimeIso: '2026-04-04T10:00:00.000Z',
        },
      },
    });
  });

  test('still allows non-runtime patch fields when backend is stale', async () => {
    mocks.isRuntimeBuildStale.mockReturnValue(true);
    const app = createApp();

    const res = await app.request('/api/groups/web:main', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Main' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
      }),
    );
    expect(mocks.setRegisteredGroup).toHaveBeenCalledOnce();
    expect(registeredGroups['web:main'].name).toBe('Renamed Main');
    expect(mocks.stopGroup).not.toHaveBeenCalled();
  });

  test('includes shared web:main home workspace with its actual runtime in group list', async () => {
    registeredGroups = {
      'web:main': {
        name: 'Main',
        folder: 'main',
        added_at: '2026-04-04T10:00:00.000Z',
        created_by: null,
        is_home: true,
        agentType: 'openai',
      },
      'feishu:ops-room': {
        name: 'Ops Room',
        folder: 'main',
        added_at: '2026-04-04T10:05:00.000Z',
        created_by: null,
        is_home: false,
      },
    };
    mocks.getRegisteredGroup.mockImplementation(
      (jid: string) => registeredGroups[jid],
    );
    mocks.getAllRegisteredGroups.mockImplementation(() => registeredGroups);
    mocks.getJidsByFolder.mockImplementation((folder: string) =>
      Object.keys(registeredGroups).filter(
        (jid) => registeredGroups[jid]?.folder === folder,
      ),
    );

    const app = createApp();

    const res = await app.request('/api/groups');

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { groups: Record<string, any> };
    expect(payload.groups['web:main']).toEqual(
      expect.objectContaining({
        agent_type: 'openai',
        is_home: true,
        is_my_home: true,
      }),
    );
    expect(payload.groups['web:main']).not.toHaveProperty('execution_mode');
  });

  test('persists workspace model, reasoning effort, and speed tier on patch', async () => {
    const app = createApp();

    const res = await app.request('/api/groups/web:main', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent_type: 'openai',
        model: 'gpt-5.4',
        reasoning_effort: 'xhigh',
        speed_tier: 'fast',
      }),
    });

    expect(res.status).toBe(200);
    expect(mocks.setRegisteredGroup).toHaveBeenCalledWith(
      'web:main',
      expect.objectContaining({
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
        speedTier: 'fast',
      }),
    );
  });

  test('does not accept unsupported OpenAI models', async () => {
    const app = createApp();

    const res = await app.request('/api/groups/web:main', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent_type: 'openai',
        model: 'sonnet',
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Unsupported openai model',
      presets: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
    });
    expect(mocks.normalizeAvailableRuntimeModelPreset).toHaveBeenCalledWith(
      'openai',
      'sonnet',
      { currentModel: 'gpt-5.5' },
    );
    expect(mocks.getAvailableRuntimeModelPresets).toHaveBeenCalledWith(
      'openai',
      { currentModel: 'gpt-5.5' },
    );
    expect(mocks.setRegisteredGroup).not.toHaveBeenCalled();
  });

  test('returns runtime model options with the effective current model', async () => {
    registeredGroups['web:main'] = {
      ...registeredGroups['web:main'],
      agentType: 'openai',
      model: null,
    };
    const app = createApp();

    const res = await app.request('/api/groups/web:main/runtime-model-options');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      current_model: 'gpt-5.5',
      options: [
        { value: 'gpt-5.5', label: 'GPT-5.5 (current)' },
        { value: 'gpt-5.4', label: 'GPT-5.4' },
      ],
    });
    expect(mocks.getAvailableRuntimeModelOptions).toHaveBeenCalledWith(
      'openai',
      { currentModel: 'gpt-5.5' },
    );
  });

  test('creates a workspace without a custom cwd', async () => {
    const app = createApp();

    const res = await app.request('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Ops',
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        group: expect.objectContaining({
          name: 'Ops',
        }),
      }),
    );
    const payload = (await app.request('/api/groups').then((r) => r.json())) as {
      groups: Record<string, any>;
    };
    expect(Object.values(payload.groups).every((g) => !('execution_mode' in g))).toBe(
      true,
    );
    expect(mocks.setRegisteredGroup).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        name: 'Ops',
      }),
    );
  });
});
