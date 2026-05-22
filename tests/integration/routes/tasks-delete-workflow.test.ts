import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: {
    id: 'member-1',
    username: 'member',
    role: 'member',
    status: 'active',
    display_name: 'Member',
    permissions: [],
    must_change_password: false,
  },
  canAccessGroup: vi.fn(),
  getTaskById: vi.fn(),
  getRegisteredGroup: vi.fn(),
  getRunningTaskIds: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock('../../../src/web/middleware/auth.js', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('user', mocks.currentUser);
    await next();
  },
}));

vi.mock('../../../src/web/context.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/web/context.js')
  >('../../../src/web/context.js');
  return {
    ...actual,
    canAccessGroup: mocks.canAccessGroup,
    getWebDeps: vi.fn(),
  };
});

vi.mock('../../../src/agent/scheduler/index.js', () => ({
  getRunningTaskIds: mocks.getRunningTaskIds,
}));

vi.mock('../../../src/storage/db.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/storage/db.js')
  >('../../../src/storage/db.js');
  return {
    ...actual,
    getTaskById: mocks.getTaskById,
    getRegisteredGroup: mocks.getRegisteredGroup,
    deleteTask: mocks.deleteTask,
  };
});

vi.mock('../../../src/core/workspace/file-manager.js', () => ({
  removeFlowArtifacts: vi.fn(),
}));

import tasksRoutes from '../../../src/web/routes/tasks.js';

function createApp() {
  const app = new Hono();
  app.route('/api/tasks', tasksRoutes);
  return app;
}

function scheduledTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    group_folder: 'main',
    chat_jid: 'web:main',
    prompt: 'Run workflow',
    schedule_type: 'interval',
    schedule_value: '1800000',
    context_mode: 'isolated',
    execution_type: 'workflow',
    script_command: 'hkipo',
    next_run: '2026-05-22T12:30:00.000Z',
    last_run: '2026-05-22T12:00:00.000Z',
    last_result: null,
    status: 'active',
    created_at: '2026-05-21T00:00:00.000Z',
    created_by: 'member-1',
    notify_channels: null,
    workspace_jid: null,
    workspace_folder: null,
    ...overrides,
  };
}

describe('task delete route for running workflow tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canAccessGroup.mockReturnValue(true);
    mocks.getRegisteredGroup.mockReturnValue({
      jid: 'web:main',
      name: 'Main',
      folder: 'main',
      added_at: '2026-05-21T00:00:00.000Z',
      created_by: 'member-1',
    });
    mocks.getRunningTaskIds.mockReturnValue(['task-1']);
  });

  test('allows deleting a running workflow scheduled task', async () => {
    mocks.getTaskById.mockReturnValue(scheduledTask());

    const response = await createApp().request('/api/tasks/task-1', {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.deleteTask).toHaveBeenCalledWith('task-1');
  });

  test('keeps running non-workflow tasks protected from deletion', async () => {
    mocks.getTaskById.mockReturnValue(
      scheduledTask({
        execution_type: 'agent',
        script_command: null,
      }),
    );

    const response = await createApp().request('/api/tasks/task-1', {
      method: 'DELETE',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: '任务正在运行中，请先等待完成或停止任务',
    });
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });
});
