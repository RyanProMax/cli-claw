import type {
  ScheduledTask,
  TaskRunLog,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunStep,
  WorkflowRunStepStatus,
} from '../domain/types.js';
import {
  parseStockStrategyPlannerDecision,
  type StockStrategyPlannerDecision,
  type StockStrategySchedulerAction,
} from '../agent/scheduler/stock-strategy-decision.js';

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

export type WorkflowDashboardStockStrategyMarketCode = 'US' | 'HK' | 'CN';

export type WorkflowDashboardStockStrategyState =
  | 'discovering'
  | 'validating'
  | 'blocked'
  | 'cooldown'
  | 'human_review_ready'
  | 'approved'
  | 'rejected';

export interface WorkflowDashboardStockStrategyDecision {
  action: StockStrategySchedulerAction;
  nextWorkflow: string | null;
  cadence: string | null;
  reason: string;
  evidenceSignature: string;
  requiresHuman: boolean;
  workflowId: string;
  updatedAt: string;
}

export interface WorkflowDashboardStockStrategyMarket {
  market: WorkflowDashboardStockStrategyMarketCode;
  state: WorkflowDashboardStockStrategyState;
  source: 'planner_decision' | 'local_artifact' | 'scheduled_task';
  workflowId: string | null;
  action: StockStrategySchedulerAction | null;
  nextWorkflow: string | null;
  cadence: string | null;
  reason: string | null;
  evidenceSignature: string | null;
  requiresHuman: boolean;
  updatedAt: string | null;
}

export interface WorkflowDashboardStockStrategy {
  workspaceJid: 'web:stock-strategy';
  workspaceFolder: 'stock-strategy';
  globalDecision: WorkflowDashboardStockStrategyDecision | null;
  markets: WorkflowDashboardStockStrategyMarket[];
}

export interface WorkflowDashboardData {
  dayStart: string;
  dayEnd: string;
  generatedAt: string;
  summary: WorkflowDashboardSummary;
  runningRuns: WorkflowDashboardRun[];
  todayRuns: WorkflowDashboardRun[];
  scheduledTasks: WorkflowDashboardScheduledTask[];
  stockStrategy: WorkflowDashboardStockStrategy | null;
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

const STOCK_STRATEGY_WORKSPACE_JID = 'web:stock-strategy';
const STOCK_STRATEGY_WORKSPACE_FOLDER = 'stock-strategy';
const STOCK_STRATEGY_WORKFLOW_IDS = new Set([
  'stock-strategy-discovery-loop',
  'stock-strategy-loop',
  'stock-strategy-us-candidate-validation',
  'stock-strategy-hk-design-review',
  'stock-strategy-cn-coverage-check',
]);
const STOCK_MARKET_ORDER: WorkflowDashboardStockStrategyMarketCode[] = [
  'US',
  'HK',
  'CN',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonObjectLike(
  value: string | null | undefined,
): Record<string, unknown> | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidates = [fenced?.[1] ?? trimmed];
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Keep trying more permissive candidates.
    }
  }
  return null;
}

function isStockStrategyWorkflowId(
  workflowId: string | null | undefined,
): boolean {
  return Boolean(workflowId && STOCK_STRATEGY_WORKFLOW_IDS.has(workflowId));
}

function isStockStrategyRun(run: WorkflowRun): boolean {
  return (
    run.folder === STOCK_STRATEGY_WORKSPACE_FOLDER ||
    run.trigger_chat_jid === STOCK_STRATEGY_WORKSPACE_JID ||
    isStockStrategyWorkflowId(run.workflow_id)
  );
}

function normalizeStockMarket(
  value: unknown,
): WorkflowDashboardStockStrategyMarketCode | null {
  const normalized = readString(value).toUpperCase();
  if (normalized === 'US' || normalized === 'HK' || normalized === 'CN') {
    return normalized;
  }
  return null;
}

function marketFromEvidenceSignature(
  signature: string | null | undefined,
): WorkflowDashboardStockStrategyMarketCode | null {
  const market = signature?.split(':')[0];
  return normalizeStockMarket(market);
}

function marketFromWorkflowId(
  workflowId: string | null | undefined,
): WorkflowDashboardStockStrategyMarketCode | null {
  if (!workflowId) return null;
  if (workflowId.includes('-us-')) return 'US';
  if (workflowId.includes('-hk-')) return 'HK';
  if (workflowId.includes('-cn-')) return 'CN';
  return null;
}

function stateFromWorkflowState(
  value: unknown,
  artifact?: Record<string, unknown>,
): WorkflowDashboardStockStrategyState | null {
  const normalized = readString(value).toLowerCase();
  if (
    normalized === 'human_review_ready' ||
    normalized === 'approved' ||
    normalized === 'rejected' ||
    normalized === 'cooldown'
  ) {
    return normalized;
  }
  if (normalized === 'discovery' || normalized === 'discovering') {
    return 'discovering';
  }
  if (
    normalized === 'candidate_validation' ||
    normalized === 'validating' ||
    normalized === 'validation'
  ) {
    return 'validating';
  }
  if (
    normalized === 'candidate_review' ||
    normalized === 'coverage_check' ||
    normalized === 'blocked' ||
    normalized === 'design_review'
  ) {
    if (
      normalized === 'coverage_check' &&
      readString(artifact?.coverage_status).toLowerCase() === 'ready'
    ) {
      return 'discovering';
    }
    return 'blocked';
  }
  return null;
}

function stateFromWorkflowId(
  workflowId: string | null | undefined,
): WorkflowDashboardStockStrategyState | null {
  if (!workflowId) return null;
  if (workflowId === 'stock-strategy-us-candidate-validation') {
    return 'validating';
  }
  if (
    workflowId === 'stock-strategy-hk-design-review' ||
    workflowId === 'stock-strategy-cn-coverage-check'
  ) {
    return 'blocked';
  }
  if (
    workflowId === 'stock-strategy-discovery-loop' ||
    workflowId === 'stock-strategy-loop'
  ) {
    return 'discovering';
  }
  return null;
}

function stateFromDecision(
  decision: StockStrategyPlannerDecision,
): WorkflowDashboardStockStrategyState | null {
  if (decision.requires_human || decision.action === 'ask_human') {
    return 'human_review_ready';
  }
  const downstreamState = stateFromWorkflowId(decision.next_workflow);
  if (downstreamState) return downstreamState;
  if (decision.action === 'continue') return 'discovering';
  if (decision.action === 'pause' || decision.action === 'pause_discovery') {
    return 'cooldown';
  }
  if (decision.action === 'slow_down') return 'cooldown';
  return null;
}

function toDashboardStockStrategyDecision(
  decision: StockStrategyPlannerDecision,
  run: WorkflowRun,
): WorkflowDashboardStockStrategyDecision {
  return {
    action: decision.action,
    nextWorkflow: decision.next_workflow,
    cadence: decision.cadence,
    reason: decision.reason,
    evidenceSignature: decision.evidence_signature,
    requiresHuman: decision.requires_human,
    workflowId: run.workflow_id,
    updatedAt: run.completed_at ?? run.updated_at,
  };
}

function readPlannerMarketStates(
  parsed: Record<string, unknown> | null,
): Array<{
  market: WorkflowDashboardStockStrategyMarketCode;
  state: WorkflowDashboardStockStrategyState;
}> {
  const rawStates = parsed?.market_states;
  if (!Array.isArray(rawStates)) return [];
  const states: Array<{
    market: WorkflowDashboardStockStrategyMarketCode;
    state: WorkflowDashboardStockStrategyState;
  }> = [];
  for (const item of rawStates) {
    if (!isRecord(item)) continue;
    const market = normalizeStockMarket(item.market);
    const state = stateFromWorkflowState(item.state, parsed ?? undefined);
    if (market && state) states.push({ market, state });
  }
  return states;
}

function readStepArtifact(
  step: WorkflowRunStep,
): Record<string, unknown> | null {
  const output = step.output;
  if (!isRecord(output)) return null;
  const artifact = output.artifact;
  if (isRecord(artifact)) return artifact;
  if (typeof artifact === 'string') return parseJsonObjectLike(artifact);
  return null;
}

function compareNullableIso(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function stockStrategySourcePriority(
  source: WorkflowDashboardStockStrategyMarket['source'],
): number {
  if (source === 'planner_decision') return 3;
  if (source === 'local_artifact') return 2;
  return 1;
}

function upsertStockMarketState(
  states: Map<
    WorkflowDashboardStockStrategyMarketCode,
    WorkflowDashboardStockStrategyMarket
  >,
  candidate: WorkflowDashboardStockStrategyMarket,
) {
  const existing = states.get(candidate.market);
  if (!existing) {
    states.set(candidate.market, candidate);
    return;
  }

  const timeCompare = compareNullableIso(
    candidate.updatedAt,
    existing.updatedAt,
  );
  if (
    timeCompare > 0 ||
    (timeCompare === 0 &&
      stockStrategySourcePriority(candidate.source) >
        stockStrategySourcePriority(existing.source))
  ) {
    states.set(candidate.market, candidate);
  }
}

function buildStockStrategyDashboard(input: {
  workflowRuns: WorkflowRun[];
  workflowSteps: WorkflowRunStep[];
  scheduledTasks: ScheduledTask[];
}): WorkflowDashboardStockStrategy | null {
  const runsById = new Map(input.workflowRuns.map((run) => [run.id, run]));
  const markets = new Map<
    WorkflowDashboardStockStrategyMarketCode,
    WorkflowDashboardStockStrategyMarket
  >();
  let globalDecision: WorkflowDashboardStockStrategyDecision | null = null;
  let hasStockStrategySignal = false;

  for (const run of input.workflowRuns) {
    if (!isStockStrategyRun(run)) continue;
    hasStockStrategySignal = true;
    const decision = parseStockStrategyPlannerDecision(run.result);
    if (!decision) continue;

    const dashboardDecision = toDashboardStockStrategyDecision(decision, run);
    if (
      !globalDecision ||
      dashboardDecision.updatedAt > globalDecision.updatedAt
    ) {
      globalDecision = dashboardDecision;
    }

    const parsed = parseJsonObjectLike(run.result);
    const plannerStates = readPlannerMarketStates(parsed);
    const states =
      plannerStates.length > 0
        ? plannerStates
        : [
            {
              market:
                marketFromEvidenceSignature(decision.evidence_signature) ??
                marketFromWorkflowId(decision.next_workflow) ??
                marketFromWorkflowId(run.workflow_id),
              state: stateFromDecision(decision),
            },
          ];

    for (const state of states) {
      if (!state.market || !state.state) continue;
      upsertStockMarketState(markets, {
        market: state.market,
        state: state.state,
        source: 'planner_decision',
        workflowId: run.workflow_id,
        action: decision.action,
        nextWorkflow: decision.next_workflow,
        cadence: decision.cadence,
        reason: decision.reason,
        evidenceSignature: decision.evidence_signature,
        requiresHuman: decision.requires_human,
        updatedAt: run.completed_at ?? run.updated_at,
      });
    }
  }

  for (const step of input.workflowSteps) {
    const artifact = readStepArtifact(step);
    if (!artifact) continue;
    const run = runsById.get(step.run_id) ?? null;
    const marketState = isRecord(artifact.market_state)
      ? artifact.market_state
      : null;
    const market = normalizeStockMarket(marketState?.market ?? artifact.market);
    const state = stateFromWorkflowState(marketState?.state, artifact);
    const workflowId = run?.workflow_id ?? null;
    const isStockArtifact =
      readString(artifact.source).startsWith('stock_strategy_') ||
      isStockStrategyWorkflowId(workflowId);
    if (!isStockArtifact) continue;
    hasStockStrategySignal = true;
    if (!market || !state) continue;

    upsertStockMarketState(markets, {
      market,
      state,
      source: 'local_artifact',
      workflowId,
      action: null,
      nextWorkflow: null,
      cadence: null,
      reason: null,
      evidenceSignature: readString(artifact.evidence_signature) || null,
      requiresHuman: false,
      updatedAt: step.completed_at ?? step.updated_at,
    });
  }

  for (const task of input.scheduledTasks) {
    const workflowId = taskWorkflowId(task);
    if (
      !isStockStrategyWorkflowId(workflowId) &&
      !isStockStrategyWorkflowId(task.id)
    ) {
      continue;
    }
    hasStockStrategySignal = true;
    const effectiveWorkflowId = workflowId ?? task.id;
    const market = marketFromWorkflowId(effectiveWorkflowId);
    const state = stateFromWorkflowId(effectiveWorkflowId);
    if (!market || !state) continue;
    upsertStockMarketState(markets, {
      market,
      state: task.status === 'paused' ? 'cooldown' : state,
      source: 'scheduled_task',
      workflowId: effectiveWorkflowId,
      action: null,
      nextWorkflow: null,
      cadence: task.schedule_type === 'interval' ? task.schedule_value : null,
      reason: task.prompt,
      evidenceSignature: null,
      requiresHuman: false,
      updatedAt: task.last_run ?? task.created_at,
    });
  }

  if (!hasStockStrategySignal) return null;

  return {
    workspaceJid: STOCK_STRATEGY_WORKSPACE_JID,
    workspaceFolder: STOCK_STRATEGY_WORKSPACE_FOLDER,
    globalDecision,
    markets: STOCK_MARKET_ORDER.flatMap((market) => {
      const state = markets.get(market);
      return state ? [state] : [];
    }),
  };
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
  if (typeof id === 'string' && id.trim()) return id;
  const initialInput = isRecord(metadata?.initialInput)
    ? metadata.initialInput
    : null;
  const nestedId = initialInput?.scheduledTaskId;
  return typeof nestedId === 'string' && nestedId.trim() ? nestedId : null;
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
    stockStrategy: buildStockStrategyDashboard({
      workflowRuns: input.workflowRuns,
      workflowSteps: input.workflowSteps,
      scheduledTasks: workflowTasks,
    }),
  };
}
