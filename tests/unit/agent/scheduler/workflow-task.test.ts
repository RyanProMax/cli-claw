import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ScheduledTask } from '../../../../src/domain/types.ts';

const {
  createTaskMock,
  getTaskByIdMock,
  listWorkflowRunsMock,
  logTaskRunStartMock,
  runtimeUsageMock,
  updateTaskMock,
  updateTaskAfterRunMock,
  updateTaskRunLogMock,
} = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  getTaskByIdMock: vi.fn(),
  listWorkflowRunsMock: vi.fn(() => []),
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
  cleanupStaleRunningLogs: vi.fn(),
  createTask: createTaskMock,
  getAllTasks: vi.fn(() => []),
  getDueTasks: vi.fn(() => []),
  getTaskById: getTaskByIdMock,
  logTaskRunStart: logTaskRunStartMock,
  updateTask: updateTaskMock,
  updateTaskAfterRun: updateTaskAfterRunMock,
  updateTaskRunLog: updateTaskRunLogMock,
}));

vi.mock('../../../../src/storage/workflows.js', () => ({
  listWorkflowRuns: listWorkflowRunsMock,
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
    listWorkflowRunsMock.mockReturnValue([]);
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

  test('keeps stock strategy discovery active when pause is requested without usability proof', async () => {
    const scheduledTask = task({
      id: 'stock-strategy-discovery-loop',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      script_command: 'stock-strategy-discovery-loop',
      prompt: 'Route stock strategy work by state.',
      schedule_value: String(30 * 60 * 1000),
      notify_channels: ['feishu:private'],
    });
    getTaskByIdMock.mockImplementation((id: string) =>
      id === scheduledTask.id ? scheduledTask : undefined,
    );
    const decision = {
      action: 'pause_discovery',
      next_workflow: 'stock-strategy-us-candidate-validation',
      cadence: '2h',
      reason: 'same evidence signature, candidate requires validation',
      evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
      requires_human: false,
    };
    const workflowResult = [
      '✅ 工作流 股票策略短间隔发现工作流 (stock-strategy-discovery-loop) 完成：',
      JSON.stringify(decision),
    ].join('\n');
    const runWorkflowCommand = vi.fn().mockResolvedValue(workflowResult);
    const sendMessage = vi.fn();

    await runWorkflowTask(
      scheduledTask,
      {
        registeredGroups: () => ({
          'web:stock-strategy': {
            name: '股票策略',
            folder: 'stock-strategy',
            added_at: '2026-05-24T00:00:00.000Z',
            agentType: 'openai',
            is_home: true,
          },
        }),
        getSessions: () => ({}),
        queue: {} as never,
        sendMessage,
        runWorkflowCommand,
        assistantName: 'cli-claw',
      },
      'web:stock-strategy',
    );

    expect(updateTaskMock).toHaveBeenCalledWith(
      'stock-strategy-discovery-loop',
      expect.objectContaining({
        schedule_type: 'interval',
        schedule_value: String(2 * 60 * 60 * 1000),
        status: 'active',
      }),
    );
    expect(updateTaskMock).not.toHaveBeenCalledWith(
      'stock-strategy-discovery-loop',
      expect.objectContaining({ status: 'paused' }),
    );
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'stock-strategy-us-candidate-validation',
        group_folder: 'stock-strategy',
        chat_jid: 'web:stock-strategy',
        execution_type: 'workflow',
        script_command: 'stock-strategy-us-candidate-validation',
        schedule_type: 'interval',
        schedule_value: String(2 * 60 * 60 * 1000),
        status: 'active',
        notify_channels: ['feishu:private'],
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'web:stock-strategy',
      expect.stringContaining('same evidence signature'),
      { source: 'scheduled_task' },
    );
    expect(sendMessage).not.toHaveBeenCalledWith(
      'feishu:private',
      expect.any(String),
      expect.anything(),
    );
  });

  test('allows stock strategy pause only when usability gate passed', async () => {
    const scheduledTask = task({
      id: 'stock-strategy-us-candidate-validation',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      script_command: 'stock-strategy-us-candidate-validation',
      prompt: 'Validate US candidate.',
      notify_channels: ['feishu:private'],
    });
    getTaskByIdMock.mockReturnValue(scheduledTask);
    const decision = {
      action: 'pause',
      next_workflow: null,
      cadence: 'manual',
      reason: 'candidate meets the usability standard and awaits human review',
      evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
      requires_human: true,
      strategy_usability: {
        status: 'passed',
        standard_version: 'stock_strategy_usability_v1',
        passed_checks: [
          'artifact_integrity',
          'oos_segment_performance',
          'champion_challenger_comparison',
          'liquidity_and_execution',
          'risk_and_cost_sensitivity',
          'explainable_universe',
          'human_approval_boundary',
        ],
        failed_checks: [],
      },
    };
    const runWorkflowCommand = vi
      .fn()
      .mockResolvedValue(JSON.stringify(decision));
    const sendMessage = vi.fn();

    await runWorkflowTask(
      scheduledTask,
      {
        registeredGroups: () => ({
          'web:stock-strategy': {
            name: '股票策略',
            folder: 'stock-strategy',
            added_at: '2026-05-24T00:00:00.000Z',
            agentType: 'openai',
            is_home: true,
          },
        }),
        getSessions: () => ({}),
        queue: {} as never,
        sendMessage,
        runWorkflowCommand,
        assistantName: 'cli-claw',
      },
      'web:stock-strategy',
    );

    expect(updateTaskMock).toHaveBeenCalledWith(
      'stock-strategy-us-candidate-validation',
      expect.objectContaining({ status: 'paused' }),
    );
  });

  test('forwards stock strategy decisions to external channels only when human input is required', async () => {
    const scheduledTask = task({
      id: 'stock-strategy-us-candidate-validation',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      script_command: 'stock-strategy-us-candidate-validation',
      prompt: 'Validate US candidate.',
      notify_channels: ['feishu:private'],
    });
    getTaskByIdMock.mockReturnValue(scheduledTask);
    const decision = {
      action: 'ask_human',
      next_workflow: null,
      cadence: 'manual',
      reason: 'candidate passed validation and needs approval',
      evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
      requires_human: true,
    };
    const runWorkflowCommand = vi
      .fn()
      .mockResolvedValue(JSON.stringify(decision));
    const sendMessage = vi.fn();

    await runWorkflowTask(
      scheduledTask,
      {
        registeredGroups: () => ({
          'web:stock-strategy': {
            name: '股票策略',
            folder: 'stock-strategy',
            added_at: '2026-05-24T00:00:00.000Z',
            agentType: 'openai',
            is_home: true,
          },
        }),
        getSessions: () => ({}),
        queue: {} as never,
        sendMessage,
        runWorkflowCommand,
        assistantName: 'cli-claw',
      },
      'web:stock-strategy',
    );

    expect(sendMessage).toHaveBeenCalledWith(
      'web:stock-strategy',
      expect.stringContaining('candidate passed validation'),
      { source: 'scheduled_task' },
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'feishu:private',
      expect.stringContaining('candidate passed validation'),
      { source: 'scheduled_task' },
    );
  });

  test('short-circuits repeated stock discovery evidence before running the workflow command', async () => {
    const scheduledTask = task({
      id: 'stock-strategy-discovery-loop',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      script_command: 'stock-strategy-discovery-loop',
      prompt: 'Route stock strategy work by state.',
      schedule_value: String(30 * 60 * 1000),
      workspace_jid: 'web:stock-strategy',
      workspace_folder: 'stock-strategy',
      notify_channels: ['feishu:private'],
    });
    getTaskByIdMock.mockImplementation((id: string) =>
      id === scheduledTask.id ? scheduledTask : undefined,
    );
    const decision = {
      action: 'switch_workflow',
      next_workflow: 'stock-strategy-us-candidate-validation',
      cadence: '2h',
      reason: 'same evidence signature, candidate requires validation',
      evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
      requires_human: false,
    };
    listWorkflowRunsMock.mockReturnValue([
      {
        id: 'run-latest',
        status: 'success',
        workflow_id: 'stock-strategy-discovery-loop',
        result: JSON.stringify(decision),
        metadata: {
          source: 'slash-command',
          initialInput: { scheduledTaskId: 'stock-strategy-discovery-loop' },
        },
      },
      {
        id: 'run-previous',
        status: 'success',
        workflow_id: 'stock-strategy-discovery-loop',
        result: JSON.stringify(decision),
        metadata: {
          source: 'slash-command',
          initialInput: { scheduledTaskId: 'stock-strategy-discovery-loop' },
        },
      },
    ]);
    const runWorkflowCommand = vi.fn();
    const sendMessage = vi.fn();

    await runWorkflowTask(
      scheduledTask,
      {
        registeredGroups: () => ({
          'web:stock-strategy': {
            name: '股票策略',
            folder: 'stock-strategy',
            added_at: '2026-05-24T00:00:00.000Z',
            agentType: 'openai',
            is_home: true,
          },
        }),
        getSessions: () => ({}),
        queue: {} as never,
        sendMessage,
        runWorkflowCommand,
        assistantName: 'cli-claw',
      },
      'web:stock-strategy',
    );

    expect(runWorkflowCommand).not.toHaveBeenCalled();
    expect(runtimeUsageMock).not.toHaveBeenCalled();
    expect(updateTaskMock).toHaveBeenCalledWith(
      'stock-strategy-discovery-loop',
      expect.objectContaining({
        schedule_type: 'interval',
        schedule_value: String(2 * 60 * 60 * 1000),
        status: 'active',
      }),
    );
    expect(updateTaskMock).not.toHaveBeenCalledWith(
      'stock-strategy-discovery-loop',
      expect.objectContaining({ status: 'paused' }),
    );
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'stock-strategy-us-candidate-validation',
        script_command: 'stock-strategy-us-candidate-validation',
        schedule_type: 'interval',
        schedule_value: String(2 * 60 * 60 * 1000),
      }),
    );
    expect(updateTaskRunLogMock).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({
        status: 'success',
        result: expect.stringContaining('No new evidence'),
        error: null,
      }),
    );
    expect(updateTaskAfterRunMock).toHaveBeenCalledWith(
      'stock-strategy-discovery-loop',
      expect.any(String),
      expect.stringContaining('No new evidence'),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
