import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { runScriptMock, runAgentProcessMock, runtimeUsageMock } = vi.hoisted(
  () => ({
    runScriptMock: vi.fn(),
    runAgentProcessMock: vi.fn(),
    runtimeUsageMock: vi.fn(),
  }),
);

vi.mock('../../../src/agent/script-runner.js', () => ({
  hasScriptCapacity: () => true,
  runScript: runScriptMock,
}));

vi.mock('../../../src/agent/runner/container-runner.js', () => ({
  runAgentProcess: runAgentProcessMock,
  writeTasksSnapshot: vi.fn(),
}));

vi.mock('../../../src/core/billing.js', () => ({
  checkBillingAccessFresh: vi.fn(),
  isBillingEnabled: () => false,
}));

vi.mock('../../../src/core/runtime/usage.js', () => ({
  getRuntimeUsageSnapshot: runtimeUsageMock,
}));

vi.mock('../../../src/storage/db.js', () => ({
  addGroupMember: vi.fn(),
  cleanupOldTaskRunLogs: vi.fn(),
  cleanupStaleRunningLogs: vi.fn(),
  deleteGroupData: vi.fn(),
  ensureChatExists: vi.fn(),
  getAllTasks: vi.fn(() => []),
  getDueTasks: vi.fn(() => []),
  getTaskRunLogs: vi.fn(() => []),
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

import {
  getRunningTaskIds,
  runScriptTask,
  runTask,
  triggerTaskNow,
} from '../../../src/agent/scheduler/index.js';
import type {
  RegisteredGroup,
  ScheduledTask,
} from '../../../src/domain/types.js';

const sourceGroup: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  added_at: '2026-04-05T09:00:00.000Z',
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
    next_run: null,
    status: 'active',
    created_at: '2026-04-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('task scheduler workspace cwd forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeUsageMock.mockResolvedValue({
      provider: 'openai',
      available: true,
      source: 'test',
      primaryRemainingPct: 80,
      secondaryRemainingPct: 80,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('passes the source workspace cwd to script tasks', async () => {
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

    vi.mocked(
      (await import('../../../src/storage/db.js')).getTaskById,
    ).mockReturnValue(task);
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

  test('passes the source cwd to agent tasks without changing storage ownership', async () => {
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

    vi.mocked(
      (await import('../../../src/storage/db.js')).getTaskById,
    ).mockReturnValue(task);
    runAgentProcessMock.mockResolvedValue({
      status: 'success',
      result: 'ok',
    });

    await runTask(task, deps as never, { manualRun: true });
    expect(runAgentProcessMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        folder: expect.stringMatching(/^task-/),
        customCwd: '/srv/source',
      }),
    );
    expect(runAgentProcessMock.mock.calls[0][4]).toEqual(
      expect.objectContaining({
        executionCwd: '/srv/source',
      }),
    );
  });

  test('inherits source OpenAI model settings for agent tasks', async () => {
    const task = buildTask({});
    const openAiSourceGroup: RegisteredGroup = {
      ...sourceGroup,
      agentType: 'openai',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'high',
      speedTier: 'fast',
    };
    const groups = {
      'web:source': openAiSourceGroup,
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

    vi.mocked(
      (await import('../../../src/storage/db.js')).getTaskById,
    ).mockReturnValue(task);
    runAgentProcessMock.mockResolvedValue({
      status: 'success',
      result: 'ok',
    });

    await runTask(task, deps as never, { manualRun: true });

    expect(runAgentProcessMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        agentType: 'openai',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'high',
        speedTier: 'fast',
      }),
    );
    expect(runAgentProcessMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        agentType: 'openai',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'high',
        speedTier: 'fast',
      }),
    );
  });

  test('marks agent login runtime text as a task error', async () => {
    const task = buildTask({
      id: 'task-login-error',
      next_run: '2026-04-05T10:00:00.000Z',
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

    const db = await import('../../../src/storage/db.js');
    vi.mocked(db.getTaskById).mockReturnValue(task);
    runAgentProcessMock.mockResolvedValue({
      status: 'success',
      result: 'Not logged in · Please run /login',
    });

    await runTask(task, deps as never, { manualRun: true });

    expect(db.updateTaskRunLog).toHaveBeenCalledWith(
      'run-log-1',
      expect.objectContaining({
        status: 'error',
        result: 'Not logged in · Please run /login',
        error: 'Codex CLI 登录态缺失或已过期。请执行 `codex login` 后重试。',
      }),
    );
    expect(db.updateTaskAfterRun).toHaveBeenCalledWith(
      'task-login-error',
      '2026-04-05T10:00:00.000Z',
      'Error: Codex CLI 登录态缺失或已过期。请执行 `codex login` 后重试。',
    );
  });

  test('defers scheduled agent tasks when the 5h usage bucket is below threshold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T15:00:00.000Z'));
    const task = buildTask({
      id: 'task-low-usage',
      next_run: '2026-05-20T15:00:00.000Z',
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

    const db = await import('../../../src/storage/db.js');
    vi.mocked(db.getTaskById).mockReturnValue(task);
    runtimeUsageMock.mockResolvedValue({
      provider: 'openai',
      available: true,
      source: 'test',
      primaryRemainingPct: 29,
      secondaryRemainingPct: 80,
      primaryResetAt: '2026-05-20T17:00:00.000Z',
      secondaryResetAt: '2026-05-24T00:00:00.000Z',
    });

    await runTask(task, deps as never);

    expect(runAgentProcessMock).not.toHaveBeenCalled();
    expect(db.updateTaskRunLog).toHaveBeenCalledWith(
      'run-log-1',
      expect.objectContaining({
        status: 'success',
        result:
          'Deferred: OpenAI usage guard deferred scheduled task: 5h remaining 29% < 30%',
        error: null,
      }),
    );
    expect(db.updateTaskAfterRun).toHaveBeenCalledWith(
      'task-low-usage',
      '2026-05-20T17:00:00.000Z',
      'Deferred: OpenAI usage guard deferred scheduled task: 5h remaining 29% < 30%',
    );
  });

  test('keeps task marked running until scheduled task row is finalized', async () => {
    const task = buildTask({
      id: 'task-finalizing',
      next_run: '2026-04-05T10:00:00.000Z',
    });
    const groups = {
      'web:source': sourceGroup,
    } as Record<string, RegisteredGroup>;
    let releaseAgentProcess!: () => void;
    const agentProcessDone = new Promise<void>((resolve) => {
      releaseAgentProcess = resolve;
    });

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

    const db = await import('../../../src/storage/db.js');
    vi.mocked(db.getTaskById).mockReturnValue(task);
    runAgentProcessMock.mockImplementation(async (...args: unknown[]) => {
      const onOutput = args[3] as (output: {
        status: 'success';
        result: string;
      }) => Promise<void>;
      await onOutput({ status: 'success', result: 'ok' });
      await agentProcessDone;
      return { status: 'success', result: 'ok' };
    });

    const running = runTask(task, deps as never);
    await vi.waitFor(() => {
      expect(db.updateTaskRunLog).toHaveBeenCalledWith(
        'run-log-1',
        expect.objectContaining({ status: 'success', result: 'ok' }),
      );
    });

    expect(getRunningTaskIds()).toContain('task-finalizing');
    expect(db.updateTaskAfterRun).toHaveBeenCalledWith(
      'task-finalizing',
      null,
      'ok',
    );
    releaseAgentProcess();
    await running;
    expect(getRunningTaskIds()).not.toContain('task-finalizing');
  });

  test('runs former group-context agent tasks through isolated task workspaces instead of injecting prompts', async () => {
    const task = buildTask({
      id: 'task-group-mode',
      context_mode: 'group',
      execution_type: 'agent',
    });
    const groups = {
      'web:source': sourceGroup,
    } as Record<string, RegisteredGroup>;
    const storePromptMessage = vi.fn();
    const enqueueMessageCheck = vi.fn();
    const enqueueTask = vi.fn();

    const deps = {
      registeredGroups: () => groups,
      getSessions: () => ({}),
      queue: {
        closeStdin: vi.fn(),
        enqueueTask,
        enqueueMessageCheck,
      },
      onProcess: vi.fn(),
      sendMessage: vi.fn(),
      storePromptMessage,
      assistantName: 'cli-claw',
    };

    vi.mocked(
      (await import('../../../src/storage/db.js')).getTaskById,
    ).mockReturnValue(task);

    expect(triggerTaskNow(task.id, deps as never)).toEqual({ success: true });
    expect(storePromptMessage).not.toHaveBeenCalled();
    expect(enqueueMessageCheck).not.toHaveBeenCalled();
    expect(enqueueTask).toHaveBeenCalledWith(
      'web:source#task:task-group-mode',
      'task-group-mode',
      expect.any(Function),
    );
  });
});
