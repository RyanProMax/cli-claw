import { CronExpressionParser } from 'cron-parser';

import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from '../../core/config.js';
import { getRuntimeUsageSnapshot } from '../../core/runtime/usage.js';
import { getOpenAiRuntimeDefaults } from '../../core/runtime/config.js';
import { resolveEffectiveRuntimeIdentity } from '../../core/runtime/group-runtime.js';
import { logger } from '../../core/logger.js';
import {
  cleanupOldTaskRunLogs,
  cleanupStaleRunningTaskAndWorkflowRuns,
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
  parseStockStrategyPlannerDecisionResult,
  type StockStrategyPlannerDecision,
  type StockStrategyWorkflowAssignment,
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
const DEFAULT_WORKFLOW_TASK_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_STALE_RUNNING_TIMEOUT_MS = 30 * 60 * 1000;
const STALE_RUNNING_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const STOCK_STRATEGY_DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const STOCK_STRATEGY_ORCHESTRATOR_INTERVAL_MS = 30 * 60 * 1000;
const STOCK_STRATEGY_CONTROL_LOOP_WORKFLOW_ID = 'stock-strategy-control-loop';
const STOCK_STRATEGY_DAILY_PROGRESS_WORKFLOW_ID =
  'stock-strategy-daily-progress-summary';
const STOCK_STRATEGY_WORKFLOW_IDS = new Set([
  STOCK_STRATEGY_CONTROL_LOOP_WORKFLOW_ID,
  STOCK_STRATEGY_DAILY_PROGRESS_WORKFLOW_ID,
  'stock-strategy-discovery-loop',
  'stock-strategy-loop',
  'stock-strategy-us-candidate-validation',
  'stock-strategy-hk-design-review',
  'stock-strategy-cn-coverage-check',
  'stock-strategy-paper-setup',
  'stock-strategy-paper-validation',
]);
const STOCK_STRATEGY_WORKFLOW_ALIASES = new Map<string, string>([
  ['stock-strategy-design-review', 'stock-strategy-hk-design-review'],
  [
    'stock-strategy-candidate-validation',
    'stock-strategy-us-candidate-validation',
  ],
]);

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

function shouldNotifyExternalChannels(
  task: ScheduledTask,
  decision: StockStrategyPlannerDecision | null,
): boolean {
  if (isStockStrategyWorkflowTask(task)) {
    if (isStockStrategyDailyProgressTask(task)) return true;
    return Boolean(
      decision && (decision.requires_human || decision.action === 'ask_human'),
    );
  }
  if (!decision) return true;
  return decision.requires_human || decision.action === 'ask_human';
}

function isStockStrategyWorkflowTask(task: ScheduledTask): boolean {
  const workflowId = taskWorkflowId(task);
  return (
    task.id.startsWith('stock-strategy-') ||
    Boolean(workflowId?.startsWith('stock-strategy-'))
  );
}

function isStockStrategyDailyProgressTask(task: ScheduledTask): boolean {
  const workflowId = taskWorkflowId(task);
  return (
    task.id === STOCK_STRATEGY_DAILY_PROGRESS_WORKFLOW_ID ||
    workflowId === STOCK_STRATEGY_DAILY_PROGRESS_WORKFLOW_ID
  );
}

function stripStockStrategySchedulerDecisionBlock(result: string): string {
  const marker = '[Scheduler Decision]';
  const markerIndex = result.indexOf(marker);
  if (markerIndex < 0) return result;
  return result.slice(0, markerIndex).trimEnd();
}

function formatStockStrategyDecisionSummaryForDelivery(
  decision: StockStrategyPlannerDecision,
): string {
  const nextWorkflow = decision.next_workflow || '暂无下游任务';
  return [
    '股票策略进展',
    '',
    `- 结论：${decision.reason || '已完成本轮状态判断。'}`,
    `- 动作：${decision.action}；下一步：${nextWorkflow}；节奏：${
      decision.cadence || '按状态触发'
    }`,
    `- 人工：${decision.requires_human ? '需要你确认' : '暂不需要'}`,
  ].join('\n');
}

function formatStockStrategyDailyFailureSummary(): string {
  return [
    '股票策略日报',
    '- 今日：日报生成未完成，细节已留在 Web 审计。',
    '- 当前：没有新的可上线策略结论。',
    '- 阻塞：运行时中断。',
    '- 下一步：下一轮继续按状态补证。',
    '- 人工：暂不需要。',
  ].join('\n');
}

function stripWorkflowCompletionHeading(result: string): string {
  return result
    .replace(/^✅\s*工作流\s+.+?完成[：:]\s*/u, '')
    .replace(/^❌\s*工作流\s+.+?失败[：:]\s*[\s\S]*$/u, '')
    .trim();
}

function normalizeStockStrategyDailyLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed === '[Scheduler Decision]') return null;
  if (/^[{}\[\],"]+$/u.test(trimmed)) return null;
  if (/^"[\w.-]+"\s*:/u.test(trimmed)) return null;
  if (/^(🎯|📍|📈|🧭|🛡️)/u.test(trimmed)) return null;
  if (trimmed.includes('以上仅为研究证据')) return null;
  if (trimmed.includes('不自动 approve')) return null;

  const plain = trimmed
    .replace(/^-\s*\*\*([^*]+)：\*\*\s*/u, '- $1：')
    .replace(/^\*\*([^*]+)：\*\*\s*/u, '- $1：');
  return plain.startsWith('- ') ? plain : `- ${plain.replace(/^-\s*/u, '')}`;
}

function formatStockStrategyDailyProgressForExternalDelivery(
  result: string,
): string {
  if (extractWorkflowCommandFailure(result)) {
    return formatStockStrategyDailyFailureSummary();
  }

  const stripped = stripWorkflowCompletionHeading(
    stripStockStrategySchedulerDecisionBlock(result),
  );
  const lines = stripped
    .split('\n')
    .map(normalizeStockStrategyDailyLine)
    .filter((line): line is string => Boolean(line))
    .slice(0, 8);

  if (lines.length === 0) {
    return [
      '股票策略日报',
      '- 今日：暂无新的可展示进展。',
      '- 当前：没有新的可上线策略结论。',
      '- 下一步：等待新证据后再推进。',
      '- 人工：暂不需要。',
    ].join('\n');
  }

  const [first, ...rest] = lines;
  if (first.replace(/^-\s*/u, '').startsWith('股票策略日报')) {
    return [first.replace(/^-\s*/u, ''), ...rest].join('\n');
  }
  return ['股票策略日报', ...lines].join('\n');
}

function formatWorkflowResultForScheduledDelivery(
  task: ScheduledTask,
  result: string,
  decision: StockStrategyPlannerDecision | null,
  options: { external?: boolean } = {},
): string {
  if (!isStockStrategyWorkflowTask(task)) return result;
  if (options.external) {
    if (decision)
      return formatStockStrategyDecisionSummaryForDelivery(decision);
    if (isStockStrategyDailyProgressTask(task)) {
      return formatStockStrategyDailyProgressForExternalDelivery(result);
    }
  }
  const stripped = stripStockStrategySchedulerDecisionBlock(result).trim();
  if (decision && /^\s*(?:```json\s*)?\{/.test(stripped)) {
    return formatStockStrategyDecisionSummaryForDelivery(decision);
  }
  return (
    stripped ||
    (decision
      ? formatStockStrategyDecisionSummaryForDelivery(decision)
      : result)
  );
}

function shouldAppendPlannerNoticeToDelivery(task: ScheduledTask): boolean {
  return !isStockStrategyWorkflowTask(task);
}

function formatStockStrategyDecisionNotice(
  decision: StockStrategyPlannerDecision,
  options: { pauseBlocked?: boolean } = {},
): string {
  const usabilityStatus = decision.strategy_usability?.status ?? 'unknown';
  const qualityStatus = decision.quality_gate?.status ?? 'unknown';
  const pieces = [
    `股票策略调度决策：${decision.action}`,
    `usability=${usabilityStatus}`,
    `quality=${qualityStatus}`,
    options.pauseBlocked ? 'pause_blocked=usability_gate_not_passed' : null,
    decision.next_workflow ? `next=${decision.next_workflow}` : null,
    decision.next_workflows && decision.next_workflows.length > 0
      ? `next_workflows=${decision.next_workflows
          .map((item) => item.workflow_id)
          .join(',')}`
      : null,
    decision.cadence ? `cadence=${decision.cadence}` : null,
    decision.current_next_run_at
      ? `current_next_run_at=${decision.current_next_run_at}`
      : null,
    decision.evidence_signature
      ? `signature=${decision.evidence_signature}`
      : null,
    decision.reason ? `reason=${decision.reason}` : null,
  ].filter((item): item is string => Boolean(item));
  return pieces.join(' | ');
}

function describeAssignmentQualityGate(
  assignment: StockStrategyWorkflowAssignment,
): string | null {
  const gate = assignment.quality_gate;
  if (!gate) return null;
  if (typeof gate === 'string') return gate;
  return `${gate.standard_version}:${gate.stage}:${gate.status}`;
}

function buildDownstreamPrompt(
  decision: StockStrategyPlannerDecision,
  assignment?: StockStrategyWorkflowAssignment,
): string {
  const lines = [
    `State-driven stock strategy follow-up for ${assignment?.workflow_id ?? decision.next_workflow}.`,
    assignment?.reason || decision.reason
      ? `Reason: ${assignment?.reason || decision.reason}`
      : null,
    decision.evidence_signature
      ? `Evidence signature: ${decision.evidence_signature}`
      : null,
    assignment?.priority ? `Priority: ${assignment.priority}` : null,
    assignment ? `Cadence: ${assignment.cadence ?? 'dynamic'}` : null,
    assignment
      ? `Quality gate: ${describeAssignmentQualityGate(assignment) ?? 'default'}`
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

function isStockStrategyControlTask(task: ScheduledTask): boolean {
  return (
    task.id === STOCK_STRATEGY_CONTROL_LOOP_WORKFLOW_ID ||
    taskWorkflowId(task) === STOCK_STRATEGY_CONTROL_LOOP_WORKFLOW_ID
  );
}

function defaultStockStrategyWorkflowIntervalMs(
  workflowId: string | null,
): number {
  if (workflowId === 'stock-strategy-us-candidate-validation') {
    return 2 * 60 * 60 * 1000;
  }
  if (workflowId === 'stock-strategy-cn-coverage-check') {
    return 60 * 60 * 1000;
  }
  if (workflowId === 'stock-strategy-paper-validation') {
    return 60 * 60 * 1000;
  }
  if (workflowId === 'stock-strategy-paper-setup') {
    return 60 * 60 * 1000;
  }
  return STOCK_STRATEGY_DEFAULT_COOLDOWN_MS;
}

function requiresStockStrategySchedulerDecision(task: ScheduledTask): boolean {
  const workflowId = taskWorkflowId(task);
  return (
    typeof workflowId === 'string' &&
    workflowId.startsWith('stock-strategy-') &&
    workflowId !== 'stock-strategy-loop' &&
    workflowId !== STOCK_STRATEGY_DAILY_PROGRESS_WORKFLOW_ID
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
    JSON.stringify(left.next_workflows ?? []) ===
      JSON.stringify(right.next_workflows ?? []) &&
    left.cadence === right.cadence &&
    (left.current_cadence ?? null) === (right.current_cadence ?? null) &&
    (left.next_cadence ?? null) === (right.next_cadence ?? null) &&
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
    current_cadence: latest.current_cadence || '30m',
    next_cadence: latest.next_cadence || latest.cadence || null,
    cadence: latest.cadence || latest.next_cadence || '30m',
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

function resolveCurrentTaskIntervalMs(
  task: ScheduledTask,
  decision: StockStrategyPlannerDecision,
  options: { pauseBlocked: boolean },
): number | null {
  const explicitCurrentIntervalMs = parseCadenceToIntervalMs(
    decision.current_cadence,
  );
  if (explicitCurrentIntervalMs !== null) return explicitCurrentIntervalMs;

  if (isStockStrategyDiscoveryTask(task)) {
    return STOCK_STRATEGY_ORCHESTRATOR_INTERVAL_MS;
  }
  if (isStockStrategyControlTask(task)) {
    return STOCK_STRATEGY_ORCHESTRATOR_INTERVAL_MS;
  }

  const legacyCadenceIntervalMs = parseCadenceToIntervalMs(decision.cadence);
  if (legacyCadenceIntervalMs !== null) return legacyCadenceIntervalMs;
  if (options.pauseBlocked) return STOCK_STRATEGY_DEFAULT_COOLDOWN_MS;
  return null;
}

function parseNextRunAt(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === 'immediate' || raw === '立即') {
    return new Date(Date.now()).toISOString();
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function nextRunFromInterval(intervalMs: number | null): string | null {
  if (intervalMs === null) return null;
  return new Date(Date.now() + intervalMs).toISOString();
}

function nextRunInFutureOrFallback(
  explicitNextRun: string | null,
  fallbackNextRun: string | null,
): string | null {
  if (!explicitNextRun) return fallbackNextRun;
  const parsed = Date.parse(explicitNextRun);
  if (Number.isFinite(parsed) && parsed >= Date.now()) return explicitNextRun;
  return fallbackNextRun;
}

function resolveCurrentTaskNextRunOverride(
  decision: StockStrategyPlannerDecision,
  currentTaskIntervalMs: number | null,
): string | null {
  const fallback = nextRunFromInterval(currentTaskIntervalMs);
  return nextRunInFutureOrFallback(
    parseNextRunAt(decision.current_next_run_at) ??
      parseNextRunAt(decision.next_run_at),
    fallback,
  );
}

function downstreamAssignmentsFromDecision(
  decision: StockStrategyPlannerDecision,
): StockStrategyWorkflowAssignment[] {
  const assignments: StockStrategyWorkflowAssignment[] = [];
  const seenWorkflowIds = new Set<string>();
  const addAssignment = (assignment: StockStrategyWorkflowAssignment): void => {
    const normalizedWorkflowId = normalizeStockStrategyWorkflowId(
      assignment.workflow_id,
    );
    if (!normalizedWorkflowId || seenWorkflowIds.has(normalizedWorkflowId)) {
      return;
    }
    seenWorkflowIds.add(normalizedWorkflowId);
    assignments.push({
      ...assignment,
      workflow_id: normalizedWorkflowId,
    });
  };
  for (const assignment of decision.next_workflows ?? []) {
    addAssignment(assignment);
  }
  if (decision.next_workflow) {
    addAssignment({
      workflow_id: decision.next_workflow,
      cadence: decision.next_cadence ?? decision.cadence,
      next_run_at: decision.next_run_at,
      reason: decision.reason,
    });
  }
  return assignments;
}

function normalizeStockStrategyWorkflowId(workflowId: string): string | null {
  const trimmed = workflowId.trim();
  if (!trimmed) return null;
  const normalized = STOCK_STRATEGY_WORKFLOW_ALIASES.get(trimmed) ?? trimmed;
  return STOCK_STRATEGY_WORKFLOW_IDS.has(normalized) ? normalized : null;
}

function resolveAssignmentIntervalMs(
  assignment: StockStrategyWorkflowAssignment,
): number | null {
  const cadence = assignment.cadence?.trim();
  if (!cadence && assignment.next_run_at) return null;
  const explicitIntervalMs = parseCadenceToIntervalMs(assignment.cadence);
  if (explicitIntervalMs !== null) return explicitIntervalMs;
  if (cadence === 'manual') return null;
  return defaultStockStrategyWorkflowIntervalMs(assignment.workflow_id);
}

function resolveAssignmentSchedule(
  assignment: StockStrategyWorkflowAssignment,
): {
  scheduleType: ScheduledTask['schedule_type'];
  scheduleValue: string;
  nextRun: string | null;
} | null {
  const intervalMs = resolveAssignmentIntervalMs(assignment);
  const explicitNextRun = parseNextRunAt(assignment.next_run_at);
  if (intervalMs !== null) {
    return {
      scheduleType: 'interval',
      scheduleValue: String(intervalMs),
      nextRun: nextRunInFutureOrFallback(
        explicitNextRun,
        nextRunFromInterval(intervalMs),
      ),
    };
  }
  if (explicitNextRun) {
    return {
      scheduleType: 'once',
      scheduleValue: '',
      nextRun: nextRunInFutureOrFallback(
        explicitNextRun,
        new Date(Date.now()).toISOString(),
      ),
    };
  }
  return null;
}

function applyStockStrategyPlannerDecision(
  task: ScheduledTask,
  decision: StockStrategyPlannerDecision,
): { notice: string | null; currentNextRunOverride: string | null } {
  const shouldPause =
    decision.action === 'pause' || decision.action === 'pause_discovery';
  const usabilityPassed = decision.strategy_usability?.status === 'passed';
  const qualityPassed = decision.quality_gate?.status === 'passed';
  const pauseBlocked = shouldPause && !(usabilityPassed && qualityPassed);
  const currentTaskIntervalMs = resolveCurrentTaskIntervalMs(task, decision, {
    pauseBlocked,
  });
  const currentNextRunOverride = resolveCurrentTaskNextRunOverride(
    decision,
    currentTaskIntervalMs,
  );

  if (shouldPause) {
    if (usabilityPassed && qualityPassed) {
      updateTask(task.id, { status: 'paused' });
    } else if (currentTaskIntervalMs !== null) {
      updateTask(task.id, {
        schedule_type: 'interval',
        schedule_value: String(currentTaskIntervalMs),
        next_run: currentNextRunOverride,
        status: 'active',
      });
    } else if (currentNextRunOverride) {
      updateTask(task.id, {
        next_run: currentNextRunOverride,
        status: 'active',
      });
    }
  } else if (currentTaskIntervalMs !== null) {
    updateTask(task.id, {
      schedule_type: 'interval',
      schedule_value: String(currentTaskIntervalMs),
      next_run: currentNextRunOverride,
      status: 'active',
    });
  } else if (currentNextRunOverride) {
    updateTask(task.id, {
      next_run: currentNextRunOverride,
      status: 'active',
    });
  }

  for (const assignment of downstreamAssignmentsFromDecision(decision)) {
    const schedule = resolveAssignmentSchedule(assignment);
    if (!schedule) continue;
    const existing = getTaskById(assignment.workflow_id);
    const prompt =
      assignment.prompt?.trim() || buildDownstreamPrompt(decision, assignment);
    if (existing) {
      updateTask(existing.id, {
        prompt,
        schedule_type: schedule.scheduleType,
        schedule_value: schedule.scheduleValue,
        script_command: assignment.workflow_id,
        next_run: schedule.nextRun,
        status: 'active',
        notify_channels: task.notify_channels ?? null,
      });
    } else {
      createTask({
        id: assignment.workflow_id,
        group_folder: task.group_folder,
        chat_jid: task.chat_jid,
        prompt,
        schedule_type: schedule.scheduleType,
        schedule_value: schedule.scheduleValue,
        context_mode: 'isolated',
        execution_type: 'workflow',
        script_command: assignment.workflow_id,
        workspace_jid: task.workspace_jid ?? null,
        workspace_folder: task.workspace_folder ?? null,
        next_run: schedule.nextRun,
        status: 'active',
        created_at: new Date().toISOString(),
        created_by: task.created_by ?? null,
        notify_channels: task.notify_channels ?? null,
      });
    }
  }

  return {
    notice: formatStockStrategyDecisionNotice(decision, { pauseBlocked }),
    currentNextRunOverride,
  };
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
  let stockStrategyApplyResult: {
    notice: string | null;
    currentNextRunOverride: string | null;
  } | null = null;

  try {
    const stockStrategyShortCircuitDecision =
      !manualRun && !error
        ? resolveStockStrategyShortCircuitDecision(task)
        : null;
    if (stockStrategyShortCircuitDecision) {
      const shortCircuitResult = formatStockStrategyShortCircuitResult(
        stockStrategyShortCircuitDecision,
      );
      const applyResult = applyStockStrategyPlannerDecision(
        task,
        stockStrategyShortCircuitDecision,
      );
      const currentTask = getTaskById(task.id) ?? task;
      updateTaskRunLog(runLogId, {
        duration_ms: Date.now() - startTime,
        status: 'success',
        result: [shortCircuitResult, applyResult.notice]
          .filter(Boolean)
          .join('\n\n'),
        error: null,
      });
      updateTaskAfterRun(
        task.id,
        applyResult.currentNextRunOverride ?? computeNextRun(currentTask),
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

    let stockStrategyDecision: StockStrategyPlannerDecision | null = null;
    if (!error && requiresStockStrategySchedulerDecision(task)) {
      const parseResult = parseStockStrategyPlannerDecisionResult(result);
      if (parseResult.ok) {
        stockStrategyDecision = parseResult.decision;
      } else {
        error = parseResult.error.message;
      }
    } else if (!error) {
      stockStrategyDecision = parseStockStrategyPlannerDecision(result);
    }
    stockStrategyApplyResult = stockStrategyDecision
      ? applyStockStrategyPlannerDecision(task, stockStrategyDecision)
      : null;

    if (result) {
      const primaryJids = resolveTaskDeliveryJids(task, groupJid, {
        includeNotifyChannels: false,
      });
      const primaryDeliveryResult = formatWorkflowResultForScheduledDelivery(
        task,
        result,
        stockStrategyDecision,
      );
      const primaryMessage = `${deps.assistantName}: ${[
        primaryDeliveryResult,
        shouldAppendPlannerNoticeToDelivery(task)
          ? stockStrategyApplyResult?.notice
          : null,
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 4000)}`;
      for (const jid of primaryJids) {
        await deps.sendMessage(jid, primaryMessage, {
          source: 'scheduled_task',
        });
      }

      if (shouldNotifyExternalChannels(task, stockStrategyDecision)) {
        const externalDeliveryResult = formatWorkflowResultForScheduledDelivery(
          task,
          result,
          stockStrategyDecision,
          { external: true },
        );
        const externalMessage = `${deps.assistantName}: ${[
          externalDeliveryResult,
          shouldAppendPlannerNoticeToDelivery(task)
            ? stockStrategyApplyResult?.notice
            : null,
        ]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 4000)}`;
        for (const jid of task.notify_channels ?? []) {
          if (!jid || primaryJids.includes(jid)) continue;
          await deps.sendMessage(jid, externalMessage, {
            source: 'scheduled_task',
          });
        }
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
      const currentTask = getTaskById(task.id) ?? task;
      const nextRun = manualRun
        ? task.next_run
        : (stockStrategyApplyResult?.currentNextRunOverride ??
          computeNextRun(currentTask));
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
