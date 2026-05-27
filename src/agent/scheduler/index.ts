import { CronExpressionParser } from 'cron-parser';

import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from '../../core/config.js';
import { getRuntimeUsageSnapshot } from '../../core/runtime/usage.js';
import { getOpenAiRuntimeDefaults } from '../../core/runtime/config.js';
import { resolveEffectiveRuntimeIdentity } from '../../core/runtime/group-runtime.js';
import { logger } from '../../core/logger.js';
import {
  cleanupOldTaskRunLogs,
  cleanupStaleRunningTaskAndWorkflowRuns,
  getDueTasks,
  getTaskById,
  logTaskRunStart,
  updateTaskAfterRun,
  updateTaskRunLog,
} from '../../storage/scheduler.js';
import type { GroupQueue } from '../queue/group-queue.js';
import { serializeErrorForOutput } from '../../../shared/dist/error-serialization.js';
import type { RegisteredGroup, ScheduledTask } from '../../domain/types.js';
import type { StreamEvent } from '../../presentation/stream-event.types.js';
import { evaluateScheduledTaskUsageGuard } from './usage-guard.js';

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  sendMessage: (
    jid: string,
    text: string,
    options?: { source?: string },
  ) => Promise<string | undefined | void>;
  runWorkflowCommand?: (
    chatJid: string,
    rawArgs: string,
    initialInput?: Record<string, unknown>,
  ) => Promise<string>;
  broadcastStreamEvent?: (chatJid: string, event: StreamEvent) => void;
  onWorkspaceCreated?: (jid: string, folder: string, name: string) => void;
  assistantName: string;
}

const runningTaskIds = new Set<string>();
const DEFAULT_USAGE_GUARD_MIN_REMAINING_PCT = 30;
const DEFAULT_USAGE_GUARD_UNAVAILABLE_RETRY_MS = 30 * 60 * 1000;
const DEFAULT_WORKFLOW_TASK_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_STALE_RUNNING_TIMEOUT_MS = 30 * 60 * 1000;
const STALE_RUNNING_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export function getRunningTaskIds(): string[] {
  return [...runningTaskIds];
}

function resolveTargetGroupJid(
  task: ScheduledTask,
  groups: Record<string, RegisteredGroup>,
): string {
  const directTarget = groups[task.chat_jid];
  if (directTarget && directTarget.folder === task.group_folder) {
    return task.chat_jid;
  }

  const sameFolder = Object.entries(groups).filter(
    ([, group]) => group.folder === task.group_folder,
  );
  const preferred =
    sameFolder.find(([jid]) => jid.startsWith('web:')) || sameFolder[0];
  return preferred?.[0] || '';
}

function resolveTaskSourceGroup(
  task: ScheduledTask,
  groups: Record<string, RegisteredGroup>,
): RegisteredGroup | undefined {
  const directSource = groups[task.chat_jid];
  if (directSource && directSource.folder === task.group_folder) {
    return directSource;
  }

  return (
    Object.values(groups).find(
      (group) => group.folder === task.group_folder && group.is_home,
    ) ||
    Object.values(groups).find((group) => group.folder === task.group_folder)
  );
}

function findHomeSiblingGroup(
  group: RegisteredGroup | undefined,
  groups: Record<string, RegisteredGroup>,
): RegisteredGroup | undefined {
  if (!group || group.is_home) return undefined;
  return Object.values(groups).find(
    (candidate) => candidate.folder === group.folder && candidate.is_home,
  );
}

function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    return interval.next().toISOString();
  }

  if (task.schedule_type === 'interval') {
    const ms = Number(task.schedule_value);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const anchor = task.next_run
      ? new Date(task.next_run).getTime()
      : Date.now();
    const now = Date.now();
    const elapsed = now - anchor;
    const periods = elapsed > 0 ? Math.ceil(elapsed / ms) : 1;
    return new Date(anchor + periods * ms).toISOString();
  }

  return null;
}

export function resolveWorkflowTaskArgs(task: ScheduledTask): string | null {
  const prompt = task.prompt.trim();
  const embeddedWorkflow = prompt.match(/^\/workflow\s+(.+)$/);
  if (embeddedWorkflow) {
    const args = embeddedWorkflow[1]?.trim() ?? '';
    return args || null;
  }

  const workflowId = task.script_command?.trim();
  if (!workflowId) return null;
  return [workflowId, prompt].filter(Boolean).join(' ');
}

function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function staleRunningTimeoutMs(): number {
  return positiveNumberFromEnv(
    'CLI_CLAW_SCHEDULED_WORKFLOW_STALE_TIMEOUT_MS',
    DEFAULT_STALE_RUNNING_TIMEOUT_MS,
  );
}

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function deferScheduledTaskIfUsageLow(
  task: ScheduledTask,
  deps: SchedulerDependencies,
  runLogId: number,
  startTime: number,
): Promise<boolean> {
  const groups = deps.registeredGroups();
  const sourceWorkspaceGroup = resolveTaskSourceGroup(task, groups);
  const sourceRuntimeGroup =
    (sourceWorkspaceGroup &&
      findHomeSiblingGroup(sourceWorkspaceGroup, groups)) ||
    sourceWorkspaceGroup;
  const openAiDefaults = getOpenAiRuntimeDefaults();
  const runtimeIdentity = resolveEffectiveRuntimeIdentity(
    {
      ...(sourceRuntimeGroup ?? ({} as RegisteredGroup)),
      agentType: sourceRuntimeGroup?.agentType ?? 'openai',
    },
    {
      openAiModel: openAiDefaults.model,
      openAiReasoningEffort: openAiDefaults.reasoningEffort,
      openAiSpeedTier: openAiDefaults.speedTier,
    },
  );

  let snapshot;
  try {
    snapshot = await getRuntimeUsageSnapshot(runtimeIdentity);
  } catch (err) {
    snapshot = {
      provider: 'openai' as const,
      available: false,
      source: 'Codex usage API',
      reason: serializeErrorForOutput(err),
    };
  }

  const decision = evaluateScheduledTaskUsageGuard(snapshot, {
    nowMs: Date.now(),
    minRemainingPct: positiveNumberFromEnv(
      'CLI_CLAW_SCHEDULED_AGENT_USAGE_MIN_REMAINING_PCT',
      DEFAULT_USAGE_GUARD_MIN_REMAINING_PCT,
    ),
    unavailableRetryMs: positiveNumberFromEnv(
      'CLI_CLAW_SCHEDULED_AGENT_USAGE_UNAVAILABLE_RETRY_MS',
      DEFAULT_USAGE_GUARD_UNAVAILABLE_RETRY_MS,
    ),
  });

  if (decision.allowed) return false;

  const reason =
    decision.reason ?? 'OpenAI usage guard deferred scheduled workflow';
  logger.info(
    {
      taskId: task.id,
      deferUntil: decision.deferUntil,
      lowBuckets: decision.lowBuckets,
      reason,
    },
    'Scheduled workflow deferred by usage guard',
  );
  updateTaskRunLog(runLogId, {
    duration_ms: Date.now() - startTime,
    status: 'success',
    result: `Deferred: ${reason}`,
    error: null,
  });
  updateTaskAfterRun(
    task.id,
    decision.deferUntil ?? computeNextRun(task),
    `Deferred: ${reason}`,
  );
  return true;
}

function extractWorkflowCommandFailure(result: string | null): string | null {
  if (!result) return null;
  const match = result.match(/^❌\s*工作流\s+.+?失败[：:]\s*([\s\S]+)$/);
  if (!match) return null;
  return (match[1] ?? '').trim() || 'Workflow command failed';
}

function resolveTaskDeliveryJids(
  task: ScheduledTask,
  primaryJid: string,
  options: { includeNotifyChannels?: boolean } = {},
): string[] {
  const jids = new Set<string>();
  if (primaryJid) jids.add(primaryJid);
  if (options.includeNotifyChannels ?? true) {
    for (const jid of task.notify_channels ?? []) {
      if (jid) jids.add(jid);
    }
  }
  return [...jids];
}

function isTaskStillActive(taskId: string): boolean {
  const currentTask = getTaskById(taskId);
  if (!currentTask || currentTask.status !== 'active') {
    logger.info(
      { taskId },
      'Skipping workflow task: deleted or no longer active since enqueue',
    );
    return false;
  }
  return true;
}

export async function runWorkflowTask(
  staleTask: ScheduledTask,
  deps: SchedulerDependencies,
  groupJid: string,
  manualRun = false,
): Promise<void> {
  if (!manualRun && !isTaskStillActive(staleTask.id)) return;

  const task = getTaskById(staleTask.id);
  if (!task) return;
  if (task.execution_type !== 'workflow') {
    logger.warn(
      { taskId: task.id, executionType: task.execution_type },
      'Skipping non-workflow scheduled task',
    );
    return;
  }

  runningTaskIds.add(task.id);
  const startTime = Date.now();
  const runLogId = logTaskRunStart(task.id);

  let result: string | null = null;
  let error: string | null = null;
  let deferredByUsageGuard = false;

  try {
    deferredByUsageGuard = await deferScheduledTaskIfUsageLow(
      task,
      deps,
      runLogId,
      startTime,
    );
    if (deferredByUsageGuard) return;

    const workflowArgs = resolveWorkflowTaskArgs(task);
    if (!workflowArgs) {
      error = 'workflow id is empty';
      return;
    }
    if (!deps.runWorkflowCommand) {
      error = 'workflow command runner is unavailable';
      return;
    }

    logger.info(
      { taskId: task.id, group: task.group_folder },
      'Running workflow task',
    );

    result = await runWithTimeout(
      deps.runWorkflowCommand(groupJid, workflowArgs, {
        source: 'scheduled_task',
        scheduledTaskId: task.id,
        scheduleType: task.schedule_type,
        scheduleValue: task.schedule_value,
      }),
      positiveNumberFromEnv(
        'CLI_CLAW_SCHEDULED_WORKFLOW_TASK_TIMEOUT_MS',
        DEFAULT_WORKFLOW_TASK_TIMEOUT_MS,
      ),
      `Scheduled workflow task ${task.id}`,
    );
    const workflowFailure = extractWorkflowCommandFailure(result);
    if (workflowFailure) error = workflowFailure;

    if (result) {
      const message = `${deps.assistantName}: ${result.slice(0, 4000)}`;
      for (const jid of resolveTaskDeliveryJids(task, groupJid)) {
        await deps.sendMessage(jid, message, {
          source: 'scheduled_task',
        });
      }
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Workflow task completed',
    );
  } catch (err) {
    error = serializeErrorForOutput(err);
    logger.error({ taskId: task.id, error }, 'Workflow task failed');
  } finally {
    runningTaskIds.delete(task.id);
    if (!deferredByUsageGuard) {
      updateTaskRunLog(runLogId, {
        duration_ms: Date.now() - startTime,
        status: error ? 'error' : 'success',
        result,
        error,
      });
      const currentTask = getTaskById(task.id) ?? task;
      const nextRun = manualRun ? task.next_run : computeNextRun(currentTask);
      const resultSummary = error
        ? `Error: ${error}`
        : result
          ? result.slice(0, 200)
          : 'Completed';
      updateTaskAfterRun(task.id, nextRun, resultSummary);
    }
  }
}

let schedulerRunning = false;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastCleanupTime = 0;
let lastStaleRunningCleanupTime = 0;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;

  runningTaskIds.clear();
  try {
    const cleaned = cleanupStaleRunningTaskAndWorkflowRuns({
      olderThanMs: 0,
    });
    if (cleaned.taskLogs > 0 || cleaned.workflowRuns > 0) {
      logger.info({ cleaned }, 'Cleaned up stale scheduled workflow runs');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to cleanup stale scheduled workflow runs');
  }
  lastStaleRunningCleanupTime = Date.now();

  logger.info('Workflow scheduler loop started');

  const loop = async () => {
    try {
      const now = Date.now();
      if (now - lastCleanupTime >= CLEANUP_INTERVAL_MS) {
        lastCleanupTime = now;
        try {
          const deleted = cleanupOldTaskRunLogs();
          if (deleted > 0) {
            logger.info({ deleted }, 'Cleaned up old task run logs');
          }
        } catch (err) {
          logger.error({ err }, 'Failed to cleanup old task run logs');
        }
      }

      if (
        now - lastStaleRunningCleanupTime >=
        STALE_RUNNING_CLEANUP_INTERVAL_MS
      ) {
        lastStaleRunningCleanupTime = now;
        try {
          const cleaned = cleanupStaleRunningTaskAndWorkflowRuns({
            olderThanMs: staleRunningTimeoutMs(),
          });
          if (cleaned.taskLogs > 0 || cleaned.workflowRuns > 0) {
            logger.info(
              { cleaned },
              'Cleaned up stale scheduled workflow runs',
            );
            runningTaskIds.clear();
          }
        } catch (err) {
          logger.error(
            { err },
            'Failed to cleanup stale scheduled workflow runs',
          );
        }
      }

      const dueTasks = getDueTasks().filter(
        (task) => task.execution_type === 'workflow',
      );
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due workflow tasks');
      }

      for (const task of dueTasks) {
        const currentTask = getTaskById(task.id);
        if (
          !currentTask ||
          currentTask.status !== 'active' ||
          currentTask.execution_type !== 'workflow' ||
          runningTaskIds.has(currentTask.id)
        ) {
          continue;
        }

        const targetGroupJid = resolveTargetGroupJid(
          currentTask,
          deps.registeredGroups(),
        );
        if (!targetGroupJid) {
          logger.error(
            { taskId: currentTask.id, groupFolder: currentTask.group_folder },
            'Target group not registered, skipping workflow task',
          );
          continue;
        }

        runWorkflowTask(currentTask, deps, targetGroupJid).catch((err) => {
          logger.error(
            { taskId: currentTask.id, err },
            'Unhandled error in runWorkflowTask',
          );
        });
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

export function triggerTaskNow(
  taskId: string,
  deps: SchedulerDependencies,
): { success: boolean; error?: string } {
  const task = getTaskById(taskId);
  if (!task) return { success: false, error: 'Task not found' };
  if (task.execution_type !== 'workflow') {
    return { success: false, error: 'Only workflow tasks can be run' };
  }
  if (task.status === 'completed') {
    return { success: false, error: 'Task already completed' };
  }
  if (task.status === 'paused') {
    return { success: false, error: '任务已暂停，请先恢复后再运行' };
  }
  if (runningTaskIds.has(taskId)) {
    return { success: false, error: 'Task is already running' };
  }

  const targetGroupJid = resolveTargetGroupJid(task, deps.registeredGroups());
  if (!targetGroupJid) {
    return { success: false, error: 'Target group not registered' };
  }

  runWorkflowTask(task, deps, targetGroupJid, true).catch((err) =>
    logger.error({ taskId, err }, 'Manual workflow task failed'),
  );
  return { success: true };
}
