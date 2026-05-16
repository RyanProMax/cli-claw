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
} from '../src/agent/scheduler/index.js';
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

  test('inherits source OpenAI runtime settings for host agent tasks', async () => {
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

    vi.mocked((await import('../src/db.js')).getTaskById).mockReturnValue(task);
    runHostAgentMock.mockResolvedValue({
      status: 'success',
      result: 'ok',
    });

    await runTask(task, deps as never, { manualRun: true });

    expect(runHostAgentMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        agentType: 'openai',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'high',
        speedTier: 'fast',
      }),
    );
    expect(runHostAgentMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        agentType: 'openai',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'high',
        speedTier: 'fast',
      }),
    );
  });

  test('marks host agent login runtime text as a task error', async () => {
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

    const db = await import('../src/db.js');
    vi.mocked(db.getTaskById).mockReturnValue(task);
    runHostAgentMock.mockResolvedValue({
      status: 'success',
      result: 'Not logged in · Please run /login',
    });

    await runTask(task, deps as never, { manualRun: true });

    expect(db.updateTaskRunLog).toHaveBeenCalledWith(
      'run-log-1',
      expect.objectContaining({
        status: 'error',
        result: 'Not logged in · Please run /login',
        error:
          'Codex CLI 登录态缺失或已过期。请在宿主机执行 `codex login` 后重试。',
      }),
    );
    expect(db.updateTaskAfterRun).toHaveBeenCalledWith(
      'task-login-error',
      '2026-04-05T10:00:00.000Z',
      'Error: Codex CLI 登录态缺失或已过期。请在宿主机执行 `codex login` 后重试。',
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
    let releaseHostAgent!: () => void;
    const hostAgentDone = new Promise<void>((resolve) => {
      releaseHostAgent = resolve;
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

    const db = await import('../src/db.js');
    vi.mocked(db.getTaskById).mockReturnValue(task);
    runHostAgentMock.mockImplementation(async (...args: unknown[]) => {
      const onOutput = args[3] as (output: {
        status: 'success';
        result: string;
      }) => Promise<void>;
      await onOutput({ status: 'success', result: 'ok' });
      await hostAgentDone;
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
    releaseHostAgent();
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

    vi.mocked((await import('../src/db.js')).getTaskById).mockReturnValue(task);

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
