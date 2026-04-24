import { beforeEach, describe, expect, test, vi } from 'vitest';

const { runScriptMock, runHostAgentMock } = vi.hoisted(() => ({
  runScriptMock: vi.fn(),
  runHostAgentMock: vi.fn(),
}));

vi.mock('../src/script-runner.js', () => ({
  hasScriptCapacity: () => true,
  runScript: runScriptMock,
}));

vi.mock('../src/container-runner.js', () => ({
  runHostAgent: runHostAgentMock,
  runContainerAgent: vi.fn(),
  writeTasksSnapshot: vi.fn(),
}));

vi.mock('../src/billing.js', () => ({
  checkBillingAccessFresh: vi.fn(),
  isBillingEnabled: () => false,
}));

vi.mock('../src/db.js', () => ({
  addGroupMember: vi.fn(),
  cleanupOldTaskRunLogs: vi.fn(),
  cleanupStaleRunningLogs: vi.fn(),
  deleteGroupData: vi.fn(),
  ensureChatExists: vi.fn(),
  getAllTasks: vi.fn(() => []),
  getDueTasks: vi.fn(() => []),
  getTaskById: vi.fn(),
  getUserById: vi.fn(),
  getUserHomeGroup: vi.fn(),
  getMessagesPage: vi.fn(() => []),
  logTaskRun: vi.fn(),
  logTaskRunStart: vi.fn(() => 'run-log-1'),
  setRegisteredGroup: vi.fn(),
  updateChatName: vi.fn(),
  updateTaskAfterRun: vi.fn(),
  updateTaskRunLog: vi.fn(),
  updateTaskWorkspace: vi.fn(),
}));

vi.mock('../src/daily-summary.js', () => ({
  runDailySummaryIfNeeded: vi.fn(),
}));

import {
  runScriptTask,
  runTask,
  runWorkspaceAutopilotTask,
} from '../src/task-scheduler.js';
import type { RegisteredGroup, ScheduledTask } from '../src/types.js';

const sourceGroup: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  added_at: '2026-04-05T09:00:00.000Z',
  executionMode: 'host',
  customCwd: '/srv/source',
  is_home: true,
};

function buildTask(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 'task-1',
    group_folder: 'main',
    chat_jid: 'web:source',
    prompt: 'run something',
    schedule_type: 'once',
    schedule_value: '2026-04-05T10:00:00.000Z',
    context_mode: 'isolated',
    execution_type: 'agent',
    script_command: null,
    execution_mode: 'host',
    next_run: null,
    status: 'active',
    created_at: '2026-04-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('task scheduler host cwd forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('passes the source host cwd to script tasks', async () => {
    const task = buildTask({
      execution_type: 'script',
      script_command: 'echo done',
    });
    const groups = {
      'web:source': sourceGroup,
    } as Record<string, RegisteredGroup>;

    const deps = {
      registeredGroups: () => groups,
      getSessions: () => ({}),
      queue: {
        closeStdin: vi.fn(),
        enqueueTask: vi.fn(),
        enqueueMessageCheck: vi.fn(),
      },
      onProcess: vi.fn(),
      sendMessage: vi.fn(),
      assistantName: 'cli-claw',
    };

    vi.mocked((await import('../src/db.js')).getTaskById).mockReturnValue(task);
    runScriptMock.mockResolvedValue({
      stdout: 'done',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
    });

    await runScriptTask(task, deps as never, 'web:source', true);
    expect(runScriptMock).toHaveBeenCalledWith(
      'echo done',
      'main',
      '/srv/source',
    );
  });

  test('passes the source host cwd to host agent tasks without changing storage ownership', async () => {
    const task = buildTask({});
    const groups = {
      'web:source': sourceGroup,
    } as Record<string, RegisteredGroup>;

    const deps = {
      registeredGroups: () => groups,
      getSessions: () => ({}),
      queue: {
        closeStdin: vi.fn(),
        enqueueTask: vi.fn(),
        enqueueMessageCheck: vi.fn(),
      },
      onProcess: vi.fn(),
      sendMessage: vi.fn(),
      assistantName: 'cli-claw',
    };

    vi.mocked((await import('../src/db.js')).getTaskById).mockReturnValue(task);
    runHostAgentMock.mockResolvedValue({
      status: 'success',
      result: 'ok',
    });

    await runTask(task, deps as never, { manualRun: true });
    expect(runHostAgentMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        folder: expect.stringMatching(/^task-/),
        executionMode: 'host',
        customCwd: '/srv/source',
      }),
    );
    expect(runHostAgentMock.mock.calls[0][5]).toEqual(
      expect.objectContaining({
        executionCwd: '/srv/source',
      }),
    );
  });

  test('runs workspace autopilot without storing its prompt as a user message', async () => {
    const task = buildTask({
      id: 'autopilot:workspace:main',
      context_mode: 'group',
      schedule_type: 'interval',
      schedule_value: '300000',
      next_run: '2026-04-05T10:00:00.000Z',
    });
    const groups = {
      'web:source': sourceGroup,
    } as Record<string, RegisteredGroup>;
    const storePromptMessage = vi.fn();
    const sendMessage = vi.fn();

    const deps = {
      registeredGroups: () => groups,
      getSessions: () => ({}),
      queue: {
        closeStdin: vi.fn(),
        enqueueTask: vi.fn(),
        enqueueMessageCheck: vi.fn(),
      },
      onProcess: vi.fn(),
      sendMessage,
      storePromptMessage,
      assistantName: 'cli-claw',
    };

    vi.mocked((await import('../src/db.js')).getTaskById).mockReturnValue(task);
    runHostAgentMock.mockResolvedValue({
      status: 'success',
      result: '当前没有值得执行的下一步，等待用户输入。',
    });

    await runWorkspaceAutopilotTask(task, deps as never, 'web:source', {
      manualRun: true,
    });

    expect(storePromptMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(runHostAgentMock).toHaveBeenCalledOnce();
    expect(runHostAgentMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        isScheduledTask: false,
      }),
    );
  });

  test('publishes substantive workspace autopilot results as scheduled task messages', async () => {
    const task = buildTask({
      id: 'autopilot:workspace:main',
      context_mode: 'group',
      schedule_type: 'interval',
      schedule_value: '300000',
      next_run: '2026-04-05T10:00:00.000Z',
    });
    const groups = {
      'web:source': sourceGroup,
    } as Record<string, RegisteredGroup>;
    const sendMessage = vi.fn();

    const deps = {
      registeredGroups: () => groups,
      getSessions: () => ({}),
      queue: {
        closeStdin: vi.fn(),
        enqueueTask: vi.fn(),
        enqueueMessageCheck: vi.fn(),
      },
      onProcess: vi.fn(),
      sendMessage,
      storePromptMessage: vi.fn(),
      assistantName: 'cli-claw',
    };

    vi.mocked((await import('../src/db.js')).getTaskById).mockReturnValue(task);
    runHostAgentMock.mockResolvedValue({
      status: 'success',
      result: '已完成主动检查：发现并修复了一个验证脚本入口问题。',
    });

    await runWorkspaceAutopilotTask(task, deps as never, 'web:source', {
      manualRun: true,
    });

    expect(sendMessage).toHaveBeenCalledWith(
      'web:source',
      '已完成主动检查：发现并修复了一个验证脚本入口问题。',
      { source: 'scheduled_task' },
    );
  });
});
