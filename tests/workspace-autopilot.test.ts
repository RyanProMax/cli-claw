import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  createTaskMock,
  deleteTaskMock,
  getTaskByIdMock,
  updateTaskMock,
  getRuntimeUsageSnapshotMock,
} = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  deleteTaskMock: vi.fn(),
  getTaskByIdMock: vi.fn(),
  updateTaskMock: vi.fn(),
  getRuntimeUsageSnapshotMock: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  createTask: createTaskMock,
  deleteTask: deleteTaskMock,
  getTaskById: getTaskByIdMock,
  updateTask: updateTaskMock,
}));

vi.mock('../src/runtime-usage.js', () => ({
  getRuntimeUsageSnapshot: getRuntimeUsageSnapshotMock,
  shouldPauseAutopilotForUsage: (snapshot: {
    available?: boolean;
    primaryRemainingPct?: number;
    secondaryRemainingPct?: number;
  }) =>
    snapshot?.available === true &&
    ((typeof snapshot.primaryRemainingPct === 'number' &&
      snapshot.primaryRemainingPct < 20) ||
      (typeof snapshot.secondaryRemainingPct === 'number' &&
        snapshot.secondaryRemainingPct < 10)),
}));

import {
  buildWorkspaceAutopilotTaskId,
  disableWorkspaceAutopilot,
  ensureWorkspaceAutopilotEnabled,
  getWorkspaceAutopilotState,
  reconcileWorkspaceAutopilotQuota,
} from '../src/workspace-autopilot.ts';

describe('workspace autopilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('creates a group-context interval task when enabling autopilot', async () => {
    getTaskByIdMock.mockReturnValue(undefined);
    getRuntimeUsageSnapshotMock.mockResolvedValue({
      provider: 'codex',
      available: true,
      source: 'local ~/.codex/sessions',
      primaryRemainingPct: 42,
    });

    await ensureWorkspaceAutopilotEnabled({
      workspaceJid: 'web:proj-home',
      workspaceName: 'Project Home',
      groupFolder: 'proj',
      createdBy: 'user-1',
      executionMode: 'host',
      runtimeIdentity: { agentType: 'codex', model: 'gpt-5.4' },
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: buildWorkspaceAutopilotTaskId('proj'),
        chat_jid: 'web:proj-home',
        group_folder: 'proj',
        context_mode: 'group',
        execution_type: 'agent',
        schedule_type: 'interval',
        status: 'active',
      }),
    );
  });

  test('deletes the managed task when disabling autopilot', () => {
    disableWorkspaceAutopilot('proj');

    expect(deleteTaskMock).toHaveBeenCalledWith(
      buildWorkspaceAutopilotTaskId('proj'),
    );
  });

  test('reports autopilot state from the managed task status', () => {
    getTaskByIdMock.mockReturnValue({
      id: buildWorkspaceAutopilotTaskId('proj'),
      status: 'paused',
      next_run: null,
    });

    expect(getWorkspaceAutopilotState('proj')).toEqual({
      state: 'paused_quota',
      taskId: buildWorkspaceAutopilotTaskId('proj'),
      nextRun: null,
    });
  });

  test('pauses active autopilot tasks when 5h remaining drops below 20%', async () => {
    getRuntimeUsageSnapshotMock.mockResolvedValue({
      provider: 'codex',
      available: true,
      source: 'local ~/.codex/sessions',
      primaryRemainingPct: 19,
    });

    const result = await reconcileWorkspaceAutopilotQuota(
      {
        id: buildWorkspaceAutopilotTaskId('proj'),
        status: 'active',
      } as any,
      { agentType: 'codex', model: 'gpt-5.4' },
    );

    expect(result).toBe('paused');
    expect(updateTaskMock).toHaveBeenCalledWith(
      buildWorkspaceAutopilotTaskId('proj'),
      expect.objectContaining({ status: 'paused', next_run: null }),
    );
  });

  test('pauses active autopilot tasks when week remaining drops below 10%', async () => {
    getRuntimeUsageSnapshotMock.mockResolvedValue({
      provider: 'codex',
      available: true,
      source: 'local ~/.codex/sessions',
      primaryRemainingPct: 42,
      secondaryRemainingPct: 9,
    });

    const result = await reconcileWorkspaceAutopilotQuota(
      {
        id: buildWorkspaceAutopilotTaskId('proj'),
        status: 'active',
      } as any,
      { agentType: 'codex', model: 'gpt-5.4' },
    );

    expect(result).toBe('paused');
    expect(updateTaskMock).toHaveBeenCalledWith(
      buildWorkspaceAutopilotTaskId('proj'),
      expect.objectContaining({ status: 'paused', next_run: null }),
    );
  });

  test('resumes paused autopilot tasks when quota recovers', async () => {
    getRuntimeUsageSnapshotMock.mockResolvedValue({
      provider: 'codex',
      available: true,
      source: 'local ~/.codex/sessions',
      primaryRemainingPct: 35,
    });

    const result = await reconcileWorkspaceAutopilotQuota(
      {
        id: buildWorkspaceAutopilotTaskId('proj'),
        status: 'paused',
      } as any,
      { agentType: 'codex', model: 'gpt-5.4' },
    );

    expect(result).toBe('resumed');
    expect(updateTaskMock).toHaveBeenCalledWith(
      buildWorkspaceAutopilotTaskId('proj'),
      expect.objectContaining({ status: 'active' }),
    );
  });

  test('keeps paused autopilot tasks paused when usage is temporarily unavailable', async () => {
    getRuntimeUsageSnapshotMock.mockResolvedValue({
      provider: 'codex',
      available: false,
      source: 'local ~/.codex/sessions',
    });

    const result = await reconcileWorkspaceAutopilotQuota(
      {
        id: buildWorkspaceAutopilotTaskId('proj'),
        status: 'paused',
      } as any,
      { agentType: 'codex', model: 'gpt-5.4' },
    );

    expect(result).toBe('unchanged');
    expect(updateTaskMock).not.toHaveBeenCalled();
  });
});
