import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllRegisteredGroups: vi.fn(),
  getAllTasks: vi.fn(),
  listWorkflowRunsForDashboard: vi.fn(),
  listWorkflowRunStepsForRunIds: vi.fn(),
  getTaskRunLogsForTaskIdsInRange: vi.fn(),
  getRunningTaskIds: vi.fn(),
}));

vi.mock('../../../src/web/middleware/auth.js', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('sessionId', 'session-1');
    await next();
  },
}));

vi.mock('../../../src/web/context.js', () => ({}));

vi.mock('../../../src/storage/db.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/storage/db.js')
  >('../../../src/storage/db.js');
  return {
    ...actual,
    getAllRegisteredGroups: mocks.getAllRegisteredGroups,
    getAllTasks: mocks.getAllTasks,
    listWorkflowRunsForDashboard: mocks.listWorkflowRunsForDashboard,
    listWorkflowRunStepsForRunIds: mocks.listWorkflowRunStepsForRunIds,
    getTaskRunLogsForTaskIdsInRange: mocks.getTaskRunLogsForTaskIdsInRange,
  };
});

vi.mock('../../../src/agent/scheduler/index.js', () => ({
  getRunningTaskIds: mocks.getRunningTaskIds,
}));

vi.mock('../../../src/storage/workspaces.js', () => ({
  getAllRegisteredGroups: mocks.getAllRegisteredGroups,
}));

vi.mock('../../../src/storage/scheduler.js', () => ({
  getAllTasks: mocks.getAllTasks,
  getTaskRunLogsForTaskIdsInRange: mocks.getTaskRunLogsForTaskIdsInRange,
}));

vi.mock('../../../src/storage/workflows.js', () => ({
  listWorkflowRunsForDashboard: mocks.listWorkflowRunsForDashboard,
  listWorkflowRunStepsForRunIds: mocks.listWorkflowRunStepsForRunIds,
}));

import workflowRoutes from '../../../src/web/routes/workflows.js';

function createApp() {
  const app = new Hono();
  app.route('/api/workflows', workflowRoutes);
  return app;
}

describe('workflow dashboard route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllRegisteredGroups.mockReturnValue({
      'web:main': {
        name: 'Main',
        folder: 'main',
        added_at: '2026-05-21T00:00:00.000Z',
        created_by: null,
      },
      'web:private': {
        name: 'Private',
        folder: 'private',
        added_at: '2026-05-21T00:00:00.000Z',
        created_by: null,
      },
    });
    mocks.getAllTasks.mockReturnValue([
      {
        id: 'task-main',
        group_folder: 'main',
        chat_jid: 'web:main',
        prompt: 'Run main workflow',
        schedule_type: 'interval',
        schedule_value: '1800000',
        context_mode: 'isolated',
        execution_type: 'workflow',
        script_command: 'main-workflow',
        workspace_jid: null,
        workspace_folder: null,
        next_run: '2026-05-22T12:30:00.000Z',
        last_run: '2026-05-22T12:00:00.000Z',
        last_result: 'ok',
        status: 'active',
        created_at: '2026-05-21T00:00:00.000Z',
        created_by: null,
        notify_channels: null,
      },
      {
        id: 'task-private',
        group_folder: 'private',
        chat_jid: 'web:private',
        prompt: 'Run private workflow',
        schedule_type: 'interval',
        schedule_value: '1800000',
        context_mode: 'isolated',
        execution_type: 'workflow',
        script_command: 'private-workflow',
        workspace_jid: null,
        workspace_folder: null,
        next_run: '2026-05-22T12:30:00.000Z',
        last_run: null,
        last_result: null,
        status: 'active',
        created_at: '2026-05-21T00:00:00.000Z',
        created_by: null,
        notify_channels: null,
      },
    ]);
    mocks.listWorkflowRunsForDashboard.mockReturnValue([
      {
        id: 'run-main',
        context_id: 'ctx-main',
        folder: 'main',
        workflow_id: 'main-workflow',
        thread_id: 'thread-main',
        trigger_chat_jid: 'web:main',
        trigger_message_id: null,
        trigger_user_id: null,
        prompt: 'Run main workflow',
        status: 'running',
        result: null,
        error: null,
        metadata: { source: 'scheduled_task', scheduledTaskId: 'task-main' },
        started_at: '2026-05-22T12:00:00.000Z',
        completed_at: null,
        created_at: '2026-05-22T12:00:00.000Z',
        updated_at: '2026-05-22T12:05:00.000Z',
      },
      {
        id: 'run-private',
        context_id: 'ctx-private',
        folder: 'private',
        workflow_id: 'private-workflow',
        thread_id: 'thread-private',
        trigger_chat_jid: 'web:private',
        trigger_message_id: null,
        trigger_user_id: null,
        prompt: 'Run private workflow',
        status: 'running',
        result: null,
        error: null,
        metadata: null,
        started_at: '2026-05-22T12:00:00.000Z',
        completed_at: null,
        created_at: '2026-05-22T12:00:00.000Z',
        updated_at: '2026-05-22T12:05:00.000Z',
      },
    ]);
    mocks.listWorkflowRunStepsForRunIds.mockReturnValue([]);
    mocks.getTaskRunLogsForTaskIdsInRange.mockReturnValue([
      {
        id: 1,
        task_id: 'task-main',
        run_at: '2026-05-22T12:00:00.000Z',
        duration_ms: 0,
        status: 'running',
        result: null,
        error: null,
      },
    ]);
    mocks.getRunningTaskIds.mockReturnValue(['task-main']);
  });

  test('returns workflow dashboard data for the single instance', async () => {
    const app = createApp();
    const response = await app.request(
      '/api/workflows/dashboard?date=2026-05-22&tzOffsetMinutes=0',
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listWorkflowRunsForDashboard).toHaveBeenCalledWith({
      start: '2026-05-22T00:00:00.000Z',
      end: '2026-05-23T00:00:00.000Z',
    });
    expect(body.summary).toMatchObject({
      totalRuns: 2,
      runningRuns: 2,
      scheduledWorkflowTasks: 2,
      runningScheduledTasks: 1,
    });
    expect(body.todayRuns.map((run: { id: string }) => run.id)).toEqual([
      'run-main',
      'run-private',
    ]);
    expect(body.scheduledTasks.map((task: { id: string }) => task.id)).toEqual([
      'task-main',
      'task-private',
    ]);
  });

});
