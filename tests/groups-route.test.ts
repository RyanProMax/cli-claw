import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRegisteredGroup: vi.fn(),
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

vi.mock('../src/db.js', async () => {
  const actual = await vi.importActual<typeof import('../src/db.js')>(
    '../src/db.js',
  );
  return {
    ...actual,
    getRegisteredGroup: mocks.getRegisteredGroup,
    setRegisteredGroup: mocks.setRegisteredGroup,
    updateChatName: mocks.updateChatName,
    getJidsByFolder: mocks.getJidsByFolder,
    listAgentsByJid: mocks.listAgentsByJid,
    deleteSession: mocks.deleteSession,
  };
});

vi.mock('../src/web-context.js', async () => {
  const actual = await vi.importActual<typeof import('../src/web-context.js')>(
    '../src/web-context.js',
  );
  return {
    ...actual,
    getWebDeps: mocks.getWebDeps,
    canAccessGroup: mocks.canAccessGroup,
    canModifyGroup: mocks.canModifyGroup,
    hasHostExecutionPermission: mocks.hasHostExecutionPermission,
    isHostExecutionGroup: mocks.isHostExecutionGroup,
  };
});

vi.mock('../src/runtime-build.js', () => ({
  isRuntimeBuildStale: mocks.isRuntimeBuildStale,
  getRuntimeBuildStatus: mocks.getRuntimeBuildStatus,
}));

vi.mock('../src/web.js', () => ({
  broadcastNewMessage: mocks.broadcastNewMessage,
  invalidateAllowedUserCache: mocks.invalidateAllowedUserCache,
}));

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

    mocks.getRegisteredGroup.mockImplementation((jid: string) => registeredGroups[jid]);
    mocks.setRegisteredGroup.mockImplementation((jid: string, group: any) => {
      registeredGroups[jid] = group;
    });
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
    mocks.getWebDeps.mockReturnValue({
      queue: {
        stopGroup: mocks.stopGroup,
      },
      getRegisteredGroups: () => registeredGroups,
      getSessions: () => sessions,
    });
    mocks.isRuntimeBuildStale.mockReturnValue(false);
    mocks.getRuntimeBuildStatus.mockReturnValue({
      pid: 1234,
      startedAt: '2026-04-04T10:00:00.000Z',
      stale: true,
      backend: {
        stale: true,
        loaded: { path: '/tmp/backend', version: '1.0.0', exists: true, mtimeMs: 1, mtimeIso: '2026-04-04T10:00:00.000Z' },
        current: { path: '/tmp/backend', version: '1.0.0', exists: true, mtimeMs: 2, mtimeIso: '2026-04-04T10:01:00.000Z' },
      },
      agentRunner: {
        stale: false,
        loaded: { path: '/tmp/runner', version: '1.0.0', exists: true, mtimeMs: 1, mtimeIso: '2026-04-04T10:00:00.000Z' },
        current: { path: '/tmp/runner', version: '1.0.0', exists: true, mtimeMs: 1, mtimeIso: '2026-04-04T10:00:00.000Z' },
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
});
