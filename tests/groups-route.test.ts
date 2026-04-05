import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRegisteredGroup: vi.fn(),
  getAllRegisteredGroups: vi.fn(),
  getAllChats: vi.fn(),
  getMessagesPageMulti: vi.fn(),
  getGroupMembers: vi.fn(),
  addGroupMember: vi.fn(),
  getUserPinnedGroups: vi.fn(),
  setRegisteredGroup: vi.fn(),
  updateChatName: vi.fn(),
  getJidsByFolder: vi.fn(),
  listAgentsByJid: vi.fn(),
  deleteSession: vi.fn(),
  getWebDeps: vi.fn(),
  canAccessGroup: vi.fn(),
  canModifyGroup: vi.fn(),
  hasHostExecutionPermission: vi.fn(),
  isHostExecutionGroup: vi.fn(),
  stopGroup: vi.fn(),
  isRuntimeBuildStale: vi.fn(),
  getRuntimeBuildStatus: vi.fn(),
  broadcastNewMessage: vi.fn(),
  invalidateAllowedUserCache: vi.fn(),
  fsExistsSync: vi.fn(),
  fsReaddirSync: vi.fn(),
  fsRmSync: vi.fn(),
  materializeHostWorkspaceDefaultCwd: vi.fn(),
  resetWorkspaceRuntimeState: vi.fn(),
  validateHostWorkspaceCwd: vi.fn(),
  resolveEffectiveHostWorkspaceCwd: vi.fn(),
  clearSessionJsonlFiles: vi.fn(),
  canDeleteGroup: vi.fn(),
  canManageGroupMembers: vi.fn(),
  checkGroupLimit: vi.fn(),
}));

vi.mock('../src/middleware/auth.js', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('user', {
      id: 'admin-1',
      username: 'admin',
      role: 'admin',
      status: 'active',
      display_name: 'Admin',
      permissions: ['manage_system_config'],
      must_change_password: false,
    });
    c.set('sessionId', 'session-1');
    await next();
  },
}));

vi.mock('../src/app-root.js', () => ({
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

vi.mock('../src/billing.js', () => ({
  checkGroupLimit: mocks.checkGroupLimit,
}));

vi.mock('../src/db.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/db.js')>('../src/db.js');
  return {
    ...actual,
    getRegisteredGroup: mocks.getRegisteredGroup,
    getAllRegisteredGroups: mocks.getAllRegisteredGroups,
    getAllChats: mocks.getAllChats,
    getMessagesPageMulti: mocks.getMessagesPageMulti,
    getGroupMembers: mocks.getGroupMembers,
    addGroupMember: mocks.addGroupMember,
    getUserPinnedGroups: mocks.getUserPinnedGroups,
    setRegisteredGroup: mocks.setRegisteredGroup,
    updateChatName: mocks.updateChatName,
    getJidsByFolder: mocks.getJidsByFolder,
    listAgentsByJid: mocks.listAgentsByJid,
    deleteSession: mocks.deleteSession,
  };
});

vi.mock('../src/web-context.js', () => ({
  getWebDeps: mocks.getWebDeps,
  canAccessGroup: mocks.canAccessGroup,
  canModifyGroup: mocks.canModifyGroup,
  canDeleteGroup: mocks.canDeleteGroup,
  canManageGroupMembers: mocks.canManageGroupMembers,
  hasHostExecutionPermission: mocks.hasHostExecutionPermission,
  isHostExecutionGroup: mocks.isHostExecutionGroup,
  MAX_GROUP_NAME_LEN: 40,
}));

vi.mock('../src/runtime-build.js', () => ({
  isRuntimeBuildStale: mocks.isRuntimeBuildStale,
  getRuntimeBuildStatus: mocks.getRuntimeBuildStatus,
}));

vi.mock('../src/host-workspace-cwd.js', () => ({
  materializeHostWorkspaceDefaultCwd: mocks.materializeHostWorkspaceDefaultCwd,
  validateHostWorkspaceCwd: mocks.validateHostWorkspaceCwd,
  resolveEffectiveHostWorkspaceCwd: mocks.resolveEffectiveHostWorkspaceCwd,
}));

vi.mock('../src/web.js', () => ({
  broadcastNewMessage: mocks.broadcastNewMessage,
  invalidateAllowedUserCache: mocks.invalidateAllowedUserCache,
}));

vi.mock('../src/workspace-runtime-reset.js', () => ({
  clearSessionJsonlFiles: mocks.clearSessionJsonlFiles,
  resetWorkspaceRuntimeState: mocks.resetWorkspaceRuntimeState,
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

import groupRoutes from '../src/routes/groups.js';

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
        created_by: 'admin-1',
        is_home: true,
        agentType: 'claude',
        executionMode: 'host',
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
    mocks.getMessagesPageMulti.mockReturnValue([]);
    mocks.getGroupMembers.mockReturnValue([]);
    mocks.getUserPinnedGroups.mockReturnValue({});
    mocks.getJidsByFolder.mockReturnValue(['web:main']);
    mocks.listAgentsByJid.mockReturnValue([]);
    mocks.canAccessGroup.mockReturnValue(true);
    mocks.canModifyGroup.mockReturnValue(true);
    mocks.hasHostExecutionPermission.mockReturnValue(true);
    mocks.isHostExecutionGroup.mockImplementation(
      (group: { executionMode?: string }) =>
        (group.executionMode || 'container') === 'host',
    );
    mocks.stopGroup.mockResolvedValue(undefined);
    mocks.resetWorkspaceRuntimeState.mockImplementation(
      async (deps: any, jid: string, group: any) => {
        await mocks.stopGroup(jid, { force: true });
        delete deps.getSessions()[group.folder];
        return undefined;
      },
    );
    mocks.materializeHostWorkspaceDefaultCwd.mockImplementation(
      (group: any) => {
        if (group.executionMode === 'host' && !group.customCwd) {
          return {
            group: { ...group, customCwd: '/launch/cwd' },
            materialized: true,
          };
        }
        return { group, materialized: false };
      },
    );
    mocks.checkGroupLimit.mockReturnValue({ allowed: true });
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

  test('returns 409 with stale_build marker for runtime-changing patch when backend is stale', async () => {
    mocks.isRuntimeBuildStale.mockReturnValue(true);
    const app = createApp();

    const res = await app.request('/api/groups/web:main', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_type: 'codex' }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        stale_build: true,
      }),
    );
    expect(mocks.setRegisteredGroup).not.toHaveBeenCalled();
    expect(registeredGroups['web:main'].agentType).toBe('claude');
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

  test('still allows runtime-changing patch when backend build is fresh', async () => {
    const app = createApp();

    const res = await app.request('/api/groups/web:main', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_type: 'codex' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
      }),
    );
    expect(mocks.setRegisteredGroup).toHaveBeenCalledOnce();
    expect(registeredGroups['web:main'].agentType).toBe('codex');
    expect(mocks.stopGroup).toHaveBeenCalledWith('web:main', { force: true });
    expect(sessions.main).toBeUndefined();
  });

  test('includes shared admin web:main home workspace with its actual runtime in group list', async () => {
    registeredGroups = {
      'web:main': {
        name: 'Main',
        folder: 'main',
        added_at: '2026-04-04T10:00:00.000Z',
        created_by: 'admin-2',
        is_home: true,
        agentType: 'codex',
        executionMode: 'host',
      },
      'feishu:ops-room': {
        name: 'Ops Room',
        folder: 'main',
        added_at: '2026-04-04T10:05:00.000Z',
        created_by: 'admin-2',
        is_home: false,
        executionMode: 'host',
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
        agent_type: 'codex',
        execution_mode: 'host',
        is_home: true,
        is_my_home: true,
      }),
    );
  });

  test('persists workspace model and reasoning effort on patch', async () => {
    const app = createApp();

    const res = await app.request('/api/groups/web:main', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent_type: 'codex',
        model: 'gpt-5.4',
        reasoning_effort: 'xhigh',
      }),
    });

    expect(res.status).toBe(200);
    expect(mocks.setRegisteredGroup).toHaveBeenCalledWith(
      'web:main',
      expect.objectContaining({
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      }),
    );
  });

  test('materializes the launch cwd when creating a host workspace without custom_cwd', async () => {
    const app = createApp();

    const res = await app.request('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Ops',
        execution_mode: 'host',
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        group: expect.objectContaining({
          custom_cwd: '/launch/cwd',
        }),
      }),
    );
    expect(mocks.materializeHostWorkspaceDefaultCwd).toHaveBeenCalled();
    expect(mocks.setRegisteredGroup).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        executionMode: 'host',
        customCwd: '/launch/cwd',
      }),
    );
  });

  test('materializes the launch cwd when converting a workspace to host mode', async () => {
    registeredGroups = {
      ...registeredGroups,
      'web:ops': {
        name: 'Ops',
        folder: 'ops',
        added_at: '2026-04-04T10:10:00.000Z',
        created_by: 'admin-1',
        is_home: false,
        agentType: 'claude',
        executionMode: 'container',
      },
    };
    mocks.getRegisteredGroup.mockImplementation(
      (jid: string) => registeredGroups[jid],
    );
    mocks.getAllRegisteredGroups.mockImplementation(() => registeredGroups);

    const app = createApp();

    const res = await app.request('/api/groups/web:ops', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        execution_mode: 'host',
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
      }),
    );
    expect(mocks.materializeHostWorkspaceDefaultCwd).toHaveBeenCalled();
    expect(mocks.setRegisteredGroup).toHaveBeenCalledWith(
      'web:ops',
      expect.objectContaining({
        executionMode: 'host',
        customCwd: '/launch/cwd',
      }),
    );
  });
});
