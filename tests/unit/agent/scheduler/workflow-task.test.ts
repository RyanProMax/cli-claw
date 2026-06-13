import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ScheduledTask } from '../../../../src/domain/types.ts';

const {
  getTaskByIdMock,
  logTaskRunStartMock,
  runtimeUsageMock,
  updateTaskMock,
  updateTaskAfterRunMock,
  updateTaskRunLogMock,
} = vi.hoisted(() => ({
  getTaskByIdMock: vi.fn(),
  logTaskRunStartMock: vi.fn(() => 1001),
  runtimeUsageMock: vi.fn(),
  updateTaskMock: vi.fn(),
  updateTaskAfterRunMock: vi.fn(),
  updateTaskRunLogMock: vi.fn(),
}));

vi.mock('../../../../src/core/runtime/usage.js', () => ({
  getRuntimeUsageSnapshot: runtimeUsageMock,
}));

vi.mock('../../../../src/storage/db.js', () => ({
  cleanupOldTaskRunLogs: vi.fn(),
  cleanupStaleRunningTaskAndWorkflowRuns: vi.fn(() => ({
    taskLogs: 0,
    workflowRuns: 0,
  })),
  cleanupStaleRunningLogs: vi.fn(),
  getAllTasks: vi.fn(() => []),
  getDueTasks: vi.fn(() => []),
  getTaskById: getTaskByIdMock,
  logTaskRunStart: logTaskRunStartMock,
  updateTask: updateTaskMock,
  updateTaskAfterRun: updateTaskAfterRunMock,
  updateTaskRunLog: updateTaskRunLogMock,
}));

import {
  resolveWorkflowTaskArgs,
  runWorkflowTask,
} from '../../../../src/agent/scheduler/index.ts';

function task(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 'daily-research-review',
    group_folder: 'main',
    chat_jid: 'web:main',
    prompt: 'Review recent results.',
    schedule_type: 'interval',
    schedule_value: String(6 * 60 * 60 * 1000),
    context_mode: 'isolated',
    execution_type: 'workflow',
    script_command: 'daily-research',
    next_run: '2026-05-20T15:00:00.000Z',
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: '2026-05-20T14:00:00.000Z',
    ...overrides,
  };
}

describe('scheduled workflow task helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logTaskRunStartMock.mockReturnValue(1001);
    runtimeUsageMock.mockResolvedValue({
      provider: 'openai',
      available: true,
      source: 'test',
      primaryRemainingPct: 80,
      secondaryRemainingPct: 80,
    });
  });

  test('combines workflow id and prompt into workflow command args', () => {
    expect(resolveWorkflowTaskArgs(task({}))).toBe(
      'daily-research Review recent results.',
    );
  });

  test('accepts prompt values that already include the /workflow prefix', () => {
    expect(
      resolveWorkflowTaskArgs(
        task({
          script_command: null,
          prompt: '/workflow daily-research Run the review.',
        }),
      ),
    ).toBe('daily-research Run the review.');
  });

  test('returns null when workflow id is missing', () => {
    expect(
      resolveWorkflowTaskArgs(task({ script_command: '', prompt: '' })),
    ).toBeNull();
  });

  test('runs a due workflow task through the workflow command runner', async () => {
    const scheduledTask = task({});
    getTaskByIdMock.mockReturnValue(scheduledTask);
    const runWorkflowCommand = vi.fn().mockResolvedValue('workflow started');
    const sendMessage = vi.fn();

    await runWorkflowTask(
      scheduledTask,
      {
        registeredGroups: () => ({
          'web:main': {
            name: 'Main',
            folder: 'main',
            added_at: '2026-05-20T14:00:00.000Z',
            agentType: 'openai',
          },
        }),
        getSessions: () => ({}),
        queue: {} as never,
        sendMessage,
        runWorkflowCommand,
        assistantName: 'agent-fabric',
      },
      'web:main',
    );

    expect(runWorkflowCommand).toHaveBeenCalledWith(
      'web:main',
      'daily-research Review recent results.',
      {
        source: 'scheduled_task',
        scheduledTaskId: 'daily-research-review',
        scheduleType: 'interval',
        scheduleValue: String(6 * 60 * 60 * 1000),
      },
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'web:main',
      'agent-fabric: workflow started',
      { source: 'scheduled_task' },
    );
    expect(updateTaskRunLogMock).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({
        status: 'success',
        result: 'workflow started',
        error: null,
      }),
    );
    expect(updateTaskAfterRunMock).toHaveBeenCalledWith(
      'daily-research-review',
      expect.any(String),
      'workflow started',
    );
  });

  test('records an error when the workflow command returns a failure message', async () => {
    const scheduledTask = task({});
    getTaskByIdMock.mockReturnValue(scheduledTask);
    const workflowResult =
      '❌ 工作流 每日研究复盘工作流 (daily-research) 失败：planner overloaded';
    const runWorkflowCommand = vi.fn().mockResolvedValue(workflowResult);
    const sendMessage = vi.fn();

    await runWorkflowTask(
      scheduledTask,
      {
        registeredGroups: () => ({
          'web:main': {
            name: 'Main',
            folder: 'main',
            added_at: '2026-05-20T14:00:00.000Z',
            agentType: 'openai',
          },
        }),
        getSessions: () => ({}),
        queue: {} as never,
        sendMessage,
        runWorkflowCommand,
        assistantName: 'agent-fabric',
      },
      'web:main',
    );

    expect(sendMessage).toHaveBeenCalledWith(
      'web:main',
      `agent-fabric: ${workflowResult}`,
      { source: 'scheduled_task' },
    );
    expect(updateTaskRunLogMock).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({
        status: 'error',
        result: workflowResult,
        error: 'planner overloaded',
      }),
    );
    expect(updateTaskAfterRunMock).toHaveBeenCalledWith(
      'daily-research-review',
      expect.any(String),
      'Error: planner overloaded',
    );
  });

  test('records an error when the workflow id is missing', async () => {
    const scheduledTask = task({ script_command: '', prompt: '' });
    getTaskByIdMock.mockReturnValue(scheduledTask);
    const runWorkflowCommand = vi.fn();

    await runWorkflowTask(
      scheduledTask,
      {
        registeredGroups: () => ({
          'web:main': {
            name: 'Main',
            folder: 'main',
            added_at: '2026-05-20T14:00:00.000Z',
          },
        }),
        getSessions: () => ({}),
        queue: {} as never,
        sendMessage: vi.fn(),
        runWorkflowCommand,
        assistantName: 'agent-fabric',
      },
      'web:main',
      true,
    );

    expect(runWorkflowCommand).not.toHaveBeenCalled();
    expect(updateTaskRunLogMock).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({
        status: 'error',
        result: null,
        error: 'workflow id is empty',
      }),
    );
    expect(updateTaskAfterRunMock).toHaveBeenCalledWith(
      'daily-research-review',
      '2026-05-20T15:00:00.000Z',
      'Error: workflow id is empty',
    );
  });
});
