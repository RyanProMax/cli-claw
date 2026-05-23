import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ScheduledTask } from '../../../../src/domain/types.ts';

const {
  getTaskByIdMock,
  logTaskRunStartMock,
  runtimeUsageMock,
  updateTaskAfterRunMock,
  updateTaskRunLogMock,
} = vi.hoisted(() => ({
  getTaskByIdMock: vi.fn(),
  logTaskRunStartMock: vi.fn(() => 1001),
  runtimeUsageMock: vi.fn(),
  updateTaskAfterRunMock: vi.fn(),
  updateTaskRunLogMock: vi.fn(),
}));

vi.mock('../../../../src/core/runtime/usage.js', () => ({
  getRuntimeUsageSnapshot: runtimeUsageMock,
}));

vi.mock('../../../../src/storage/db.js', () => ({
  cleanupOldTaskRunLogs: vi.fn(),
  cleanupStaleRunningLogs: vi.fn(),
  getAllTasks: vi.fn(() => []),
  getDueTasks: vi.fn(() => []),
  getTaskById: getTaskByIdMock,
  logTaskRunStart: logTaskRunStartMock,
  updateTaskAfterRun: updateTaskAfterRunMock,
  updateTaskRunLog: updateTaskRunLogMock,
}));

import {
  resolveWorkflowTaskArgs,
  runWorkflowTask,
} from '../../../../src/agent/scheduler/index.ts';

function task(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 'stock-strategy-loop-review',
    group_folder: 'main',
    chat_jid: 'web:main',
    prompt: 'Review recent stock strategy results.',
    schedule_type: 'interval',
    schedule_value: String(6 * 60 * 60 * 1000),
    context_mode: 'isolated',
    execution_type: 'workflow',
    script_command: 'stock-strategy-loop',
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
      'stock-strategy-loop Review recent stock strategy results.',
    );
  });

  test('accepts prompt values that already include the /workflow prefix', () => {
    expect(
      resolveWorkflowTaskArgs(
        task({
          script_command: null,
          prompt: '/workflow stock-strategy-loop Run the strategy loop.',
        }),
      ),
    ).toBe('stock-strategy-loop Run the strategy loop.');
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
        assistantName: 'cli-claw',
      },
      'web:main',
    );

    expect(runWorkflowCommand).toHaveBeenCalledWith(
      'web:main',
      'stock-strategy-loop Review recent stock strategy results.',
      {
        source: 'scheduled_task',
        scheduledTaskId: 'stock-strategy-loop-review',
        scheduleType: 'interval',
        scheduleValue: String(6 * 60 * 60 * 1000),
      },
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'web:main',
      'cli-claw: workflow started',
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
      'stock-strategy-loop-review',
      expect.any(String),
      'workflow started',
    );
  });

  test('records an error when the workflow command returns a failure message', async () => {
    const scheduledTask = task({});
    getTaskByIdMock.mockReturnValue(scheduledTask);
    const workflowResult =
      '❌ 工作流 股票策略自分析自迭代工作流 (stock-strategy-loop) 失败：planner overloaded';
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
        assistantName: 'cli-claw',
      },
      'web:main',
    );

    expect(sendMessage).toHaveBeenCalledWith(
      'web:main',
      `cli-claw: ${workflowResult}`,
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
      'stock-strategy-loop-review',
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
        assistantName: 'cli-claw',
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
      'stock-strategy-loop-review',
      '2026-05-20T15:00:00.000Z',
      'Error: workflow id is empty',
    );
  });

});
