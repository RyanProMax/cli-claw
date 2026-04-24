import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import {
  getRuntimeUsageSnapshot,
  shouldPauseAutopilotForUsage,
} from './runtime-usage.js';
import type { RuntimeIdentity, ScheduledTask } from './types.js';

export const WORKSPACE_AUTOPILOT_INTERVAL_MS = 5 * 60 * 1000;
const WORKSPACE_AUTOPILOT_TASK_PREFIX = 'autopilot:workspace:';

export type WorkspaceAutopilotState = 'disabled' | 'active' | 'paused_quota';

export interface WorkspaceAutopilotStatus {
  state: WorkspaceAutopilotState;
  taskId: string | null;
  nextRun: string | null;
}

export interface EnsureWorkspaceAutopilotEnabledOptions {
  workspaceJid: string;
  workspaceName: string;
  groupFolder: string;
  createdBy?: string | null;
  executionMode?: ScheduledTask['execution_mode'];
  runtimeIdentity?: RuntimeIdentity | null;
}

export function buildWorkspaceAutopilotTaskId(groupFolder: string): string {
  return `${WORKSPACE_AUTOPILOT_TASK_PREFIX}${groupFolder}`;
}

export function isWorkspaceAutopilotTask(
  taskOrId: Pick<ScheduledTask, 'id'> | string,
): boolean {
  const id = typeof taskOrId === 'string' ? taskOrId : taskOrId.id;
  return id.startsWith(WORKSPACE_AUTOPILOT_TASK_PREFIX);
}

export function buildWorkspaceAutopilotPrompt(workspaceName: string): string {
  return [
    '[WORKSPACE_AUTOPILOT]',
    `你正在执行工作区「${workspaceName}」的主动模式回合。`,
    '请仅基于当前工作区已有上下文、用户最近明确表达的目标与未完成事项，主动推进下一步。',
    '如果可以直接推进，就自行调研、执行、验证，并在有实质进展、交付物、风险或阻塞时再回复用户。',
    '不要发散到新的目标，不要重复已经完成的工作。',
    '如果当前没有值得执行的下一步，请保持回复极短并说明当前在等待用户或外部条件。',
  ].join('\n');
}

export function getWorkspaceAutopilotTask(
  groupFolder: string,
): ScheduledTask | undefined {
  return getTaskById(buildWorkspaceAutopilotTaskId(groupFolder));
}

export function getWorkspaceAutopilotState(
  groupFolder: string,
): WorkspaceAutopilotStatus {
  const task = getWorkspaceAutopilotTask(groupFolder);
  if (!task) {
    return {
      state: 'disabled',
      taskId: null,
      nextRun: null,
    };
  }

  return {
    state: task.status === 'paused' ? 'paused_quota' : 'active',
    taskId: task.id,
    nextRun: task.next_run ?? null,
  };
}

export async function ensureWorkspaceAutopilotEnabled(
  options: EnsureWorkspaceAutopilotEnabledOptions,
): Promise<WorkspaceAutopilotStatus> {
  const taskId = buildWorkspaceAutopilotTaskId(options.groupFolder);
  const nextRun = new Date().toISOString();
  const existing = getTaskById(taskId);

  if (existing) {
    updateTask(taskId, {
      prompt: buildWorkspaceAutopilotPrompt(options.workspaceName),
      schedule_type: 'interval',
      schedule_value: String(WORKSPACE_AUTOPILOT_INTERVAL_MS),
      context_mode: 'group',
      execution_type: 'agent',
      execution_mode: options.executionMode ?? existing.execution_mode ?? null,
      next_run: nextRun,
      status: 'active',
    });
  } else {
    createTask({
      id: taskId,
      group_folder: options.groupFolder,
      chat_jid: options.workspaceJid,
      prompt: buildWorkspaceAutopilotPrompt(options.workspaceName),
      schedule_type: 'interval',
      schedule_value: String(WORKSPACE_AUTOPILOT_INTERVAL_MS),
      context_mode: 'group',
      execution_type: 'agent',
      script_command: null,
      execution_mode: options.executionMode ?? null,
      next_run: nextRun,
      status: 'active',
      created_at: nextRun,
      created_by: options.createdBy ?? undefined,
      notify_channels: null,
    });
  }

  const task =
    getTaskById(taskId) ??
    ({
      id: taskId,
      status: 'active',
      next_run: nextRun,
    } as ScheduledTask);
  await reconcileWorkspaceAutopilotQuota(task, options.runtimeIdentity ?? null);
  return getWorkspaceAutopilotState(options.groupFolder);
}

export function disableWorkspaceAutopilot(
  groupFolder: string,
): WorkspaceAutopilotStatus {
  const taskId = buildWorkspaceAutopilotTaskId(groupFolder);
  deleteTask(taskId);
  return {
    state: 'disabled',
    taskId: null,
    nextRun: null,
  };
}

export async function reconcileWorkspaceAutopilotQuota(
  task: ScheduledTask,
  runtimeIdentity?: RuntimeIdentity | null,
): Promise<'unchanged' | 'paused' | 'resumed'> {
  if (!isWorkspaceAutopilotTask(task)) return 'unchanged';

  const usage = await getRuntimeUsageSnapshot(runtimeIdentity ?? null);
  if (shouldPauseAutopilotForUsage(usage)) {
    if (task.status === 'paused') return 'unchanged';
    updateTask(task.id, {
      status: 'paused',
      next_run: null,
    });
    return 'paused';
  }

  if (!usage?.available) {
    return 'unchanged';
  }

  if (task.status === 'paused') {
    updateTask(task.id, {
      status: 'active',
      next_run: new Date().toISOString(),
    });
    return 'resumed';
  }

  return 'unchanged';
}
