import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import {
  getRuntimeUsageSnapshot,
  shouldPauseAutopilotForUsage,
} from './runtime-usage.js';
import type { RuntimeIdentity, ScheduledTask } from './types.js';

export const WORKSPACE_AUTOPILOT_INTERVAL_MS = 5 * 60 * 1000;
const WORKSPACE_AUTOPILOT_TASK_PREFIX = 'autopilot:workspace:';
const AUTOPILOT_NOOP_PATTERNS = [
  /等待用户/,
  /等待新的/i,
  /没有值得执行/,
  /没有可安全推进/,
  /no actionable/i,
  /waiting for (the )?user/i,
  /nothing (to do|actionable)/i,
];

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
    '执行一次有界健康检查：只检查显式配置、任务队列、最近失败状态和可观测指标。',
    '不要从聊天历史、历史摘要或隐式上下文推断用户目标。',
    '只有发现需要用户处理的明确风险、阻塞或失败时才回复；没有问题时输出 no_op。',
  ].join('\n');
}

export function shouldPublishWorkspaceAutopilotResult(
  result: string | null | undefined,
): boolean {
  const text = result?.trim();
  if (!text) return false;
  return !AUTOPILOT_NOOP_PATTERNS.some((pattern) => pattern.test(text));
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
