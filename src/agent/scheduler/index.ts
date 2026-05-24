import { CronExpressionParser } from 'cron-parser';

import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from '../../core/config.js';
import { getRuntimeUsageSnapshot } from '../../core/runtime/usage.js';
import { getOpenAiRuntimeDefaults } from '../../core/runtime/config.js';
import { resolveEffectiveRuntimeIdentity } from '../../core/runtime/group-runtime.js';
import { logger } from '../../core/logger.js';
import {
  cleanupOldTaskRunLogs,
  cleanupStaleRunningLogs,
  createTask,
  getAllTasks,
  getDueTasks,
  getTaskById,
  logTaskRunStart,
  updateTask,
  updateTaskAfterRun,
  updateTaskRunLog,
} from '../../storage/scheduler.js';
import { listWorkflowRuns } from '../../storage/workflows.js';
import type { GroupQueue } from '../queue/group-queue.js';
import { serializeErrorForOutput } from '../../../shared/dist/error-serialization.js';
import type {
  RegisteredGroup,
  ScheduledTask,
  WorkflowRun,
} from '../../domain/types.js';
import type { StreamEvent } from '../../presentation/stream-event.types.js';
import { evaluateScheduledTaskUsageGuard } from './usage-guard.js';
import {
  parseCadenceToIntervalMs,
  parseStockStrategyPlannerDecision,
  type StockStrategyPlannerDecision,
} from './stock-strategy-decision.js';

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
const STOCK_STRATEGY_DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

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

function shouldNotifyExternalChannels(
  decision: StockStrategyPlannerDecision | null,
): boolean {
  if (!decision) return true;
  return decision.requires_human || decision.action === 'ask_human';
}

function formatStockStrategyDecisionNotice(
  decision: StockStrategyPlannerDecision,
  options: { pauseBlocked?: boolean } = {},
): string {
  const usabilityStatus = decision.strategy_usability?.status ?? 'unknown';
  const pieces = [
    `股票策略调度决策：${decision.action}`,
    `usability=${usabilityStatus}`,
    options.pauseBlocked ? 'pause_blocked=usability_gate_not_passed' : null,
    decision.next_workflow ? `next=${decision.next_workflow}` : null,
    decision.cadence ? `cadence=${decision.cadence}` : null,
    decision.evidence_signature
      ? `signature=${decision.evidence_signature}`
      : null,
    decision.reason ? `reason=${decision.reason}` : null,
  ].filter((item): item is string => Boolean(item));
  return pieces.join(' | ');
}

function buildDownstreamPrompt(decision: StockStrategyPlannerDecision): string {
  const lines = [
    `State-driven stock strategy follow-up for ${decision.next_workflow}.`,
    decision.reason ? `Reason: ${decision.reason}` : null,
    decision.evidence_signature
      ? `Evidence signature: ${decision.evidence_signature}`
      : null,
    'Keep the workflow readonly. Do not approve, activate, or trade.',
  ];
  return lines.filter((line): line is string => Boolean(line)).join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRunScheduledTaskId(run: WorkflowRun): string | null {
  const metadata = run.metadata;
  if (!isRecord(metadata)) return null;
  if (typeof metadata.scheduledTaskId === 'string') {
    return metadata.scheduledTaskId;
  }
  const initialInput = metadata.initialInput;
  if (
    isRecord(initialInput) &&
    typeof initialInput.scheduledTaskId === 'string'
  ) {
    return initialInput.scheduledTaskId;
  }
  return null;
}

function taskWorkflowId(task: ScheduledTask): string | null {
  return task.script_command?.trim() || null;
}

function isStockStrategyDiscoveryTask(task: ScheduledTask): boolean {
  return (
    task.id === 'stock-strategy-discovery-loop' ||
    taskWorkflowId(task) === 'stock-strategy-discovery-loop'
  );
}

function workflowRunBelongsToTask(
  run: WorkflowRun,
  task: ScheduledTask,
): boolean {
  const scheduledTaskId = readRunScheduledTaskId(run);
  if (scheduledTaskId) return scheduledTaskId === task.id;
  return run.workflow_id === taskWorkflowId(task);
}

function recentStockStrategyPlannerDecisions(
  task: ScheduledTask,
): StockStrategyPlannerDecision[] {
  const workflowId = taskWorkflowId(task);
  if (!workflowId) return [];
  return listWorkflowRuns({ workflowId, limit: 20 })
    .filter(
      (run) =>
        run.status === 'success' &&
        workflowRunBelongsToTask(run, task) &&
        Boolean(run.result),
    )
    .map((run) => parseStockStrategyPlannerDecision(run.result))
    .filter(
      (decision): decision is StockStrategyPlannerDecision => decision !== null,
    )
    .slice(0, 2);
}

function sameEvidenceSignatureWithoutHumanReview(
  left: StockStrategyPlannerDecision,
  right: StockStrategyPlannerDecision,
): boolean {
  return (
    Boolean(left.evidence_signature) &&
    left.evidence_signature === right.evidence_signature &&
    left.action === right.action &&
    left.next_workflow === right.next_workflow &&
    left.cadence === right.cadence &&
    !left.requires_human &&
    !right.requires_human &&
    left.action !== 'ask_human' &&
    right.action !== 'ask_human'
  );
}

function resolveStockStrategyShortCircuitDecision(
  task: ScheduledTask,
): StockStrategyPlannerDecision | null {
  if (!isStockStrategyDiscoveryTask(task)) return null;
  const decisions = recentStockStrategyPlannerDecisions(task);
  if (decisions.length < 2) return null;
  const [latest, previous] = decisions;
  if (!sameEvidenceSignatureWithoutHumanReview(latest, previous)) return null;

  return {
    ...latest,
    action: 'pause_discovery',
    cadence: latest.cadence || '6h',
    reason: [
      'no new evidence: same evidence_signature repeated across two planner decisions',
      latest.reason,
    ]
      .filter(Boolean)
      .join('; '),
    requires_human: false,
  };
}

function formatStockStrategyShortCircuitResult(
  decision: StockStrategyPlannerDecision,
): string {
  return [
    'No new evidence: stock strategy discovery short-circuited before workflow execution.',
    `evidence_signature=${decision.evidence_signature}`,
    decision.next_workflow ? `next_workflow=${decision.next_workflow}` : null,
    decision.cadence ? `cadence=${decision.cadence}` : null,
    decision.reason ? `reason=${decision.reason}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function applyStockStrategyPlannerDecision(
  task: ScheduledTask,
  decision: StockStrategyPlannerDecision,
): string | null {
  const intervalMs = parseCadenceToIntervalMs(decision.cadence);
  const shouldPause =
    decision.action === 'pause' || decision.action === 'pause_discovery';
  const usabilityPassed = decision.strategy_usability?.status === 'passed';
  const pauseBlocked = shouldPause && !usabilityPassed;
  const effectiveIntervalMs =
    intervalMs ?? (pauseBlocked ? STOCK_STRATEGY_DEFAULT_COOLDOWN_MS : null);

  if (shouldPause) {
    if (usabilityPassed) {
      updateTask(task.id, { status: 'paused' });
    } else if (effectiveIntervalMs !== null) {
      updateTask(task.id, {
        schedule_type: 'interval',
        schedule_value: String(effectiveIntervalMs),
        status: 'active',
      });
    }
  } else if (decision.action === 'slow_down' && effectiveIntervalMs !== null) {
    updateTask(task.id, {
      schedule_type: 'interval',
      schedule_value: String(effectiveIntervalMs),
      status: 'active',
    });
  }

  if (decision.next_workflow && effectiveIntervalMs !== null) {
    const existing = getTaskById(decision.next_workflow);
    const nextRun = new Date(Date.now() + effectiveIntervalMs).toISOString();
    const prompt = buildDownstreamPrompt(decision);
    if (existing) {
      updateTask(existing.id, {
        prompt,
        schedule_type: 'interval',
        schedule_value: String(effectiveIntervalMs),
        script_command: decision.next_workflow,
        next_run: nextRun,
        status: 'active',
        notify_channels: task.notify_channels ?? null,
      });
    } else {
      createTask({
        id: decision.next_workflow,
        group_folder: task.group_folder,
        chat_jid: task.chat_jid,
        prompt,
        schedule_type: 'interval',
        schedule_value: String(effectiveIntervalMs),
        context_mode: 'isolated',
        execution_type: 'workflow',
        script_command: decision.next_workflow,
        workspace_jid: task.workspace_jid ?? null,
        workspace_folder: task.workspace_folder ?? null,
        next_run: nextRun,
        status: 'active',
        created_at: new Date().toISOString(),
        created_by: task.created_by ?? null,
        notify_channels: task.notify_channels ?? null,
      });
    }
  }

  return formatStockStrategyDecisionNotice(decision, { pauseBlocked });
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
  let completedByEvidenceShortCircuit = false;

  try {
    const stockStrategyShortCircuitDecision =
      !manualRun && !error
        ? resolveStockStrategyShortCircuitDecision(task)
        : null;
    if (stockStrategyShortCircuitDecision) {
      const shortCircuitResult = formatStockStrategyShortCircuitResult(
        stockStrategyShortCircuitDecision,
      );
      const decisionNotice = applyStockStrategyPlannerDecision(
        task,
        stockStrategyShortCircuitDecision,
      );
      const currentTask = getTaskById(task.id) ?? task;
      updateTaskRunLog(runLogId, {
        duration_ms: Date.now() - startTime,
        status: 'success',
        result: [shortCircuitResult, decisionNotice]
          .filter(Boolean)
          .join('\n\n'),
        error: null,
      });
      updateTaskAfterRun(
        task.id,
        computeNextRun(currentTask),
        shortCircuitResult.slice(0, 200),
      );
      completedByEvidenceShortCircuit = true;
      logger.info(
        {
          taskId: task.id,
          evidenceSignature:
            stockStrategyShortCircuitDecision.evidence_signature,
        },
        'Stock strategy discovery short-circuited with no new evidence',
      );
      return;
    }

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

    result = await deps.runWorkflowCommand(groupJid, workflowArgs, {
      source: 'scheduled_task',
      scheduledTaskId: task.id,
      scheduleType: task.schedule_type,
      scheduleValue: task.schedule_value,
    });
    const workflowFailure = extractWorkflowCommandFailure(result);
    if (workflowFailure) error = workflowFailure;

    const stockStrategyDecision = !error
      ? parseStockStrategyPlannerDecision(result)
      : null;
    const decisionNotice = stockStrategyDecision
      ? applyStockStrategyPlannerDecision(task, stockStrategyDecision)
      : null;

    if (result) {
      const message = `${deps.assistantName}: ${[result, decisionNotice]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 4000)}`;
      for (const jid of resolveTaskDeliveryJids(task, groupJid, {
        includeNotifyChannels: shouldNotifyExternalChannels(
          stockStrategyDecision,
        ),
      })) {
        await deps.sendMessage(jid, message, { source: 'scheduled_task' });
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
    if (!deferredByUsageGuard && !completedByEvidenceShortCircuit) {
      updateTaskRunLog(runLogId, {
        duration_ms: Date.now() - startTime,
        status: error ? 'error' : 'success',
        result,
        error,
      });
      const nextRun = manualRun ? task.next_run : computeNextRun(task);
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

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;

  runningTaskIds.clear();
  try {
    const cleaned = cleanupStaleRunningLogs();
    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up stale running task logs');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to cleanup stale running task logs');
  }

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
