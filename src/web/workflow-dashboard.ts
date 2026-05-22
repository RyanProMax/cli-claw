import type {
  ScheduledTask,
  TaskRunLog,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunStep,
  WorkflowRunStepStatus,
} from '../domain/types.js';

export type WorkflowDashboardTaskRunLog = TaskRunLog & { id?: number };

export interface WorkflowDashboardInput {
  dayStart: string;
  dayEnd: string;
  generatedAt: string;
  runningTaskIds: string[];
  workflowRuns: WorkflowRun[];
  workflowSteps: WorkflowRunStep[];
  scheduledTasks: ScheduledTask[];
  taskRunLogs: WorkflowDashboardTaskRunLog[];
}

export interface WorkflowDashboardStepSummary {
  total: number;
  pending: number;
  running: number;
  success: number;
  error: number;
  skipped: number;
}

export interface WorkflowDashboardRunSourceTask {
  id: string;
  prompt: string;
  workflowId: string | null;
  scheduleType: ScheduledTask['schedule_type'];
  scheduleValue: string;
  status: ScheduledTask['status'];
  nextRun: string | null;
}

export interface WorkflowDashboardRunStep {
  id: string;
  nodeId: string;
  roleId: string | null;
  status: WorkflowRunStepStatus;
  attempt: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface WorkflowDashboardRun {
  id: string;
  folder: string;
  workflowId: string;
  prompt: string;
  status: WorkflowRunStatus;
  error: string | null;
  resultPreview: string | null;
  sourceTask: WorkflowDashboardRunSourceTask | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  stepSummary: WorkflowDashboardStepSummary;
  steps: WorkflowDashboardRunStep[];
}

export interface WorkflowDashboardScheduledTask {
  id: string;
  groupFolder: string;
  chatJid: string;
  prompt: string;
  workflowId: string;
  scheduleType: ScheduledTask['schedule_type'];
  scheduleValue: string;
  status: ScheduledTask['status'];
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
  running: boolean;
  todayRunCount: number;
  todayErrorCount: number;
  todaySuccessCount: number;
  todayLastLogStatus: TaskRunLog['status'] | null;
  todayLastLogAt: string | null;
}

export interface WorkflowDashboardSummary {
  totalRuns: number;
  queuedRuns: number;
  runningRuns: number;
  successRuns: number;
  errorRuns: number;
  cancelledRuns: number;
  scheduledWorkflowTasks: number;
  runningScheduledTasks: number;
  completedTaskRuns: number;
  failedTaskRuns: number;
}

export interface WorkflowDashboardData {
  dayStart: string;
  dayEnd: string;
  generatedAt: string;
  summary: WorkflowDashboardSummary;
  runningRuns: WorkflowDashboardRun[];
  todayRuns: WorkflowDashboardRun[];
  scheduledTasks: WorkflowDashboardScheduledTask[];
}

function isWithinRange(
  value: string | null | undefined,
  start: string,
  end: string,
) {
  if (!value) return false;
  return value >= start && value < end;
}

function sortDescByIso<T>(
  items: T[],
  pick: (item: T) => string | null | undefined,
): T[] {
  return [...items].sort((left, right) =>
    String(pick(right) ?? '').localeCompare(String(pick(left) ?? '')),
  );
}

function durationMs(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, endMs - startMs);
}

function preview(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 220 ? `${trimmed.slice(0, 220)}...` : trimmed;
}

function createEmptyStepSummary(): WorkflowDashboardStepSummary {
  return {
    total: 0,
    pending: 0,
    running: 0,
    success: 0,
    error: 0,
    skipped: 0,
  };
}

function summarizeSteps(
  steps: WorkflowRunStep[],
): WorkflowDashboardStepSummary {
  const summary = createEmptyStepSummary();
  summary.total = steps.length;
  for (const step of steps) {
    summary[step.status] += 1;
  }
  return summary;
}

function readScheduledTaskId(
  metadata: Record<string, unknown> | null,
): string | null {
  const id = metadata?.scheduledTaskId;
  return typeof id === 'string' && id.trim() ? id : null;
}

function taskWorkflowId(task: ScheduledTask): string | null {
  if (task.execution_type !== 'workflow') return null;
  const workflowId = task.script_command?.trim();
  return workflowId || null;
}

function toRunSourceTask(task: ScheduledTask): WorkflowDashboardRunSourceTask {
  return {
    id: task.id,
    prompt: task.prompt,
    workflowId: taskWorkflowId(task),
    scheduleType: task.schedule_type,
    scheduleValue: task.schedule_value,
    status: task.status,
    nextRun: task.next_run,
  };
}

function resolveSourceTask(
  run: WorkflowRun,
  tasksById: Map<string, ScheduledTask>,
  workflowTasks: ScheduledTask[],
): ScheduledTask | null {
  const metadataTaskId = readScheduledTaskId(run.metadata);
  if (metadataTaskId && tasksById.has(metadataTaskId)) {
    return tasksById.get(metadataTaskId) ?? null;
  }
  return (
    workflowTasks.find(
      (task) =>
        taskWorkflowId(task) === run.workflow_id &&
        task.chat_jid === run.trigger_chat_jid,
    ) ?? null
  );
}

function toDashboardStep(step: WorkflowRunStep): WorkflowDashboardRunStep {
  return {
    id: step.id,
    nodeId: step.node_id,
    roleId: step.role_id,
    status: step.status,
    attempt: step.attempt,
    error: step.error,
    startedAt: step.started_at,
    completedAt: step.completed_at,
    durationMs: durationMs(step.started_at, step.completed_at),
  };
}

function toDashboardRun(options: {
  run: WorkflowRun;
  steps: WorkflowRunStep[];
  sourceTask: ScheduledTask | null;
  generatedAt: string;
}): WorkflowDashboardRun {
  const { run, steps, sourceTask, generatedAt } = options;
  const effectiveStart = run.started_at ?? run.created_at;
  const effectiveEnd =
    run.completed_at ??
    (run.status === 'running' || run.status === 'queued' ? generatedAt : null);
  return {
    id: run.id,
    folder: run.folder,
    workflowId: run.workflow_id,
    prompt: run.prompt,
    status: run.status,
    error: run.error,
    resultPreview: preview(run.result),
    sourceTask: sourceTask ? toRunSourceTask(sourceTask) : null,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    durationMs: durationMs(effectiveStart, effectiveEnd),
    stepSummary: summarizeSteps(steps),
    steps: sortDescByIso(steps, (step) => step.created_at)
      .reverse()
      .map(toDashboardStep),
  };
}

function toDashboardScheduledTask(options: {
  task: ScheduledTask;
  logs: WorkflowDashboardTaskRunLog[];
  runningTaskIds: Set<string>;
}): WorkflowDashboardScheduledTask {
  const { task, logs, runningTaskIds } = options;
  const orderedLogs = sortDescByIso(logs, (log) => log.run_at);
  return {
    id: task.id,
    groupFolder: task.group_folder,
    chatJid: task.chat_jid,
    prompt: task.prompt,
    workflowId: taskWorkflowId(task) ?? '',
    scheduleType: task.schedule_type,
    scheduleValue: task.schedule_value,
    status: task.status,
    nextRun: task.next_run,
    lastRun: task.last_run,
    lastResult: task.last_result,
    running: runningTaskIds.has(task.id),
    todayRunCount: logs.length,
    todayErrorCount: logs.filter((log) => log.status === 'error').length,
    todaySuccessCount: logs.filter((log) => log.status === 'success').length,
    todayLastLogStatus: orderedLogs[0]?.status ?? null,
    todayLastLogAt: orderedLogs[0]?.run_at ?? null,
  };
}

export function buildWorkflowDashboardData(
  input: WorkflowDashboardInput,
): WorkflowDashboardData {
  const runningTaskIds = new Set(input.runningTaskIds);
  const tasksById = new Map(
    input.scheduledTasks.map((task) => [task.id, task]),
  );
  const workflowTasks = input.scheduledTasks.filter(
    (task) => task.execution_type === 'workflow' && taskWorkflowId(task),
  );
  const stepsByRunId = new Map<string, WorkflowRunStep[]>();
  for (const step of input.workflowSteps) {
    const existing = stepsByRunId.get(step.run_id) ?? [];
    existing.push(step);
    stepsByRunId.set(step.run_id, existing);
  }
  const logsByTaskId = new Map<string, WorkflowDashboardTaskRunLog[]>();
  for (const log of input.taskRunLogs) {
    if (!isWithinRange(log.run_at, input.dayStart, input.dayEnd)) continue;
    const existing = logsByTaskId.get(log.task_id) ?? [];
    existing.push(log);
    logsByTaskId.set(log.task_id, existing);
  }

  const normalizedRuns = sortDescByIso(
    input.workflowRuns,
    (run) => run.created_at,
  ).map((run) =>
    toDashboardRun({
      run,
      steps: stepsByRunId.get(run.id) ?? [],
      sourceTask: resolveSourceTask(run, tasksById, workflowTasks),
      generatedAt: input.generatedAt,
    }),
  );
  const runningRuns = normalizedRuns.filter(
    (run) => run.status === 'queued' || run.status === 'running',
  );
  const scheduledTasks = workflowTasks.map((task) =>
    toDashboardScheduledTask({
      task,
      logs: logsByTaskId.get(task.id) ?? [],
      runningTaskIds,
    }),
  );

  return {
    dayStart: input.dayStart,
    dayEnd: input.dayEnd,
    generatedAt: input.generatedAt,
    summary: {
      totalRuns: normalizedRuns.length,
      queuedRuns: normalizedRuns.filter((run) => run.status === 'queued')
        .length,
      runningRuns: normalizedRuns.filter((run) => run.status === 'running')
        .length,
      successRuns: normalizedRuns.filter((run) => run.status === 'success')
        .length,
      errorRuns: normalizedRuns.filter((run) => run.status === 'error').length,
      cancelledRuns: normalizedRuns.filter((run) => run.status === 'cancelled')
        .length,
      scheduledWorkflowTasks: scheduledTasks.length,
      runningScheduledTasks: scheduledTasks.filter((task) => task.running)
        .length,
      completedTaskRuns: input.taskRunLogs.filter(
        (log) =>
          isWithinRange(log.run_at, input.dayStart, input.dayEnd) &&
          log.status === 'success',
      ).length,
      failedTaskRuns: input.taskRunLogs.filter(
        (log) =>
          isWithinRange(log.run_at, input.dayStart, input.dayEnd) &&
          log.status === 'error',
      ).length,
    },
    runningRuns,
    todayRuns: normalizedRuns,
    scheduledTasks,
  };
}
