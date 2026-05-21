import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import type {
  AgentProcessInput,
  AgentProcessOutput,
} from '../runner/container-runner.js';
import { runAgentProcess } from '../runner/container-runner.js';
import { STORE_DIR } from '../../core/config.js';
import type {
  RegisteredGroup,
  WorkflowContext,
  WorkflowRun,
} from '../../domain/types.js';
import {
  recordWorkflowRunStep as persistWorkflowRunStep,
  updateWorkflowRunStatus as persistWorkflowRunStatus,
} from './context.js';
import type {
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowRoleDefinition,
} from './config.js';
import { WORKFLOW_END } from './config.js';
import { createWorkflowSqliteSaver } from './sqlite-checkpointer.js';

export interface WorkflowNodeResult {
  nodeId: string;
  roleId?: string;
  taskId?: string;
  result: string | null;
}

export interface WorkflowGraphState {
  prompt: string;
  input: Record<string, unknown>;
  result: string | null;
  stepResults: Record<string, WorkflowNodeResult>;
  artifacts: Record<string, unknown>;
}

export type WorkflowStepRecorder = typeof persistWorkflowRunStep;
export type WorkflowRunStatusUpdater = typeof persistWorkflowRunStatus;

export type WorkflowNodeRunner = (
  input: AgentProcessInput,
) => Promise<AgentProcessOutput>;

export interface WorkflowLocalTaskInput {
  taskId: string;
  nodeId: string;
  workflow: WorkflowDefinition;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  prompt: string;
  input: Record<string, unknown>;
  artifacts: Record<string, unknown>;
  stepResults: Record<string, WorkflowNodeResult>;
  executionCwd?: string;
}

export type WorkflowLocalTask = (
  input: WorkflowLocalTaskInput,
) => Promise<unknown>;

export type WorkflowLocalTaskRegistry = Record<string, WorkflowLocalTask>;

export interface WorkflowGraphRunOptions {
  workflow: WorkflowDefinition;
  roles: Map<string, WorkflowRoleDefinition>;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  prompt: string;
  initialInput?: Record<string, unknown>;
  localTasks?: WorkflowLocalTaskRegistry;
  runner?: WorkflowNodeRunner;
  recordStep?: WorkflowStepRecorder;
  updateRunStatus?: WorkflowRunStatusUpdater;
  checkpointer?: BaseCheckpointSaver | false;
  onProcess?: (proc: ChildProcess, identifier: string) => void;
  onOutput?: (output: AgentProcessOutput) => Promise<void>;
  executionCwd?: string;
}

const WorkflowState = Annotation.Root({
  prompt: Annotation<string>(),
  input: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  result: Annotation<string | null>(),
  stepResults: Annotation<Record<string, WorkflowNodeResult>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  artifacts: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

let persistentWorkflowCheckpointer: BaseCheckpointSaver | null = null;
let persistentWorkflowCheckpointPath: string | null = null;

const HKIPO_FINAL_REPORT_NODE_ID = 'ranking_report_editor';
const HKIPO_ROLE_PROCESS_TIMEOUT_MS = 180_000;
const STOCK_STRATEGY_PLANNER_NODE_ID = 'plan_next_iteration';
const STOCK_STRATEGY_WORKFLOW_IDS = new Set([
  'stock-strategy-discovery-loop',
  'stock-strategy-loop',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function artifactRows(artifact: unknown): unknown[] {
  if (Array.isArray(artifact)) return artifact;
  if (isRecord(artifact) && Array.isArray(artifact.data)) return artifact.data;
  return [];
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractIpoCode(item: unknown): string {
  if (!isRecord(item)) return '';
  const direct = readString(item.code);
  if (direct) return direct;
  if (isRecord(item.code)) {
    return (
      readString(item.code.full) ||
      readString(item.code.numeric) ||
      readString(item.code.symbol)
    );
  }
  return readString(item.symbol);
}

function extractIpoName(item: unknown): string {
  if (!isRecord(item)) return '';
  if (isRecord(item.name)) {
    return (
      readString(item.name.display) ||
      readString(item.name.zh) ||
      readString(item.name.cn) ||
      readString(item.name.en)
    );
  }
  return (
    readString(item.display_name) ||
    readString(item.displayName) ||
    readString(item.name) ||
    readString(item.short_name)
  );
}

function compactCode(code: string): string {
  return code.replace(/^HK\./i, '').trim();
}

function findHeatItemForIpo(heatRows: unknown[], ipo: unknown): unknown {
  const ipoCode = compactCode(extractIpoCode(ipo));
  const ipoName = extractIpoName(ipo);
  return (
    heatRows.find((candidate) => {
      const candidateCode = compactCode(extractIpoCode(candidate));
      const candidateName = extractIpoName(candidate);
      return (
        (ipoCode && candidateCode && ipoCode === candidateCode) ||
        (ipoName && candidateName && ipoName === candidateName)
      );
    }) ?? null
  );
}

function findEvidence(
  item: unknown,
  field: string,
): Record<string, unknown> | null {
  if (!isRecord(item)) return null;
  return (
    asArray(item.evidence).find(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && entry.field === field,
    ) ?? null
  );
}

function formatMultipleEvidence(
  evidence: Record<string, unknown> | null,
  label: string,
): string | null {
  const value = readNumber(evidence?.value);
  if (value === null) return null;
  const unit = readString(evidence?.unit) || 'x';
  const source = readString(evidence?.source);
  const sourceText = source ? `（${source}）` : '';
  return `${label} ${Number(value.toFixed(2))}${unit}${sourceText}`;
}

function isTransientAgentRuntimeError(message: string): boolean {
  return /UND_ERR_SOCKET|undici\.error\.UND_ERR_SOCKET|socket hang up|other side closed|ECONNRESET|ETIMEDOUT|EPIPE|network socket|fetch failed|terminated|timed out|timeout|502|503|504|529|server_is_overloaded|service_unavailable_error|server_error|servers are currently overloaded|please try again later/i.test(
    message,
  );
}

function isAgentRuntimeTimeout(message: string): boolean {
  return /timed out|timeout/i.test(message);
}

function getWorkflowRoleProcessTimeoutMs(
  input: AgentProcessInput,
): number | undefined {
  return input.workflow?.id === 'hkipo'
    ? HKIPO_ROLE_PROCESS_TIMEOUT_MS
    : undefined;
}

function buildDegradedRoleNotice(input: {
  nodeId: string;
  roleId: string;
  message: string;
}): string {
  return [
    `⚠️ ${input.nodeId} 已降级`,
    `原因：Agent runtime socket 异常，已保留上游结构化数据继续执行。`,
    `原始错误：${input.message.slice(0, 500)}`,
  ].join('\n');
}

function buildHkipoFallbackReport(
  state: WorkflowGraphState,
  message: string,
): string {
  const ipoPool = state.artifacts.ipo_pool;
  const heatEvidence = state.artifacts.heat_evidence;
  const officialDocs = state.artifacts.official_docs;
  const ipos = artifactRows(ipoPool);
  const heatRows = artifactRows(heatEvidence);
  const officialRows = artifactRows(officialDocs);
  const heatSummary = isRecord(heatEvidence) ? heatEvidence.summary : null;
  const sameDayCount =
    isRecord(heatSummary) && typeof heatSummary.same_day_heat_count === 'number'
      ? heatSummary.same_day_heat_count
      : heatRows.filter((item) =>
          asArray(isRecord(item) ? item.evidence : []).some(
            (entry) => isRecord(entry) && entry.staleness_status === 'same_day',
          ),
        ).length;

  const lines = [
    '⚠️ 港股IPO打新｜降级报告',
    `原因：Agent runtime socket 异常，报告编辑角色中断；以下基于已完成的本地采集 artifact 自动生成，建议稍后重试获取完整分析。`,
    `Run 仍保留审计记录；原始错误：${message.slice(0, 220)}`,
    '',
    `📦 池子：Futu池 ${ipos.length}只｜同日热度 ${sameDayCount}/${Math.max(ipos.length, heatRows.length)}`,
  ];

  const docCount =
    isRecord(officialDocs) &&
    isRecord(officialDocs.summary) &&
    typeof officialDocs.summary.parsed_document_count === 'number'
      ? officialDocs.summary.parsed_document_count
      : officialRows.reduce<number>((count, item) => {
          if (!isRecord(item)) return count;
          return count + asArray(item.documents).length;
        }, 0);
  if (docCount > 0) {
    lines.push(
      `📄 官方文件：已解析 ${docCount} 份，结构/估值仍需完整报告角色复核`,
    );
  }

  const rows = ipos.length > 0 ? ipos : heatRows;
  for (const [index, ipo] of rows.slice(0, 8).entries()) {
    const heatItem = findHeatItemForIpo(heatRows, ipo) ?? ipo;
    const code = extractIpoCode(ipo) || extractIpoCode(heatItem) || 'N/A';
    const name = extractIpoName(ipo) || extractIpoName(heatItem) || code;
    const margin = formatMultipleEvidence(
      findEvidence(heatItem, 'margin_multiple'),
      '融资/孖展超额',
    );
    const subscription = formatMultipleEvidence(
      findEvidence(heatItem, 'subscription_multiple'),
      '认购倍数',
    );
    const heatLine =
      [margin, subscription].filter(Boolean).join('；') ||
      '热度未达当日核验门槛';
    lines.push(`${index + 1}. ${name} ${code}｜🔥 ${heatLine}`);
  }

  if (rows.length === 0) {
    lines.push('未能从 artifact 读取 IPO 池，请查看 workflow run steps。');
  }

  return lines.join('\n');
}

function parseJsonObjectLike(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
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
      return isRecord(parsed) ? parsed : null;
    } catch {
      // Role output can include prose around JSON; try the next candidate.
    }
  }
  return null;
}

function readRoleArtifactObject(artifact: unknown): Record<string, unknown> {
  if (!isRecord(artifact)) return {};
  const result = artifact.result;
  if (isRecord(result)) return result;
  if (typeof result === 'string') return parseJsonObjectLike(result) ?? {};
  return artifact;
}

function compactFallbackText(value: unknown, maxLength = 180): string {
  const text =
    typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : JSON.stringify(value);
  const compacted = text.replace(/\s+/g, ' ').trim();
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 1)}…`
    : compacted;
}

function summarizeStockStrategyReview(
  state: WorkflowGraphState,
  workflowId: string,
): {
  changeSummary: string;
  repeatSummary: string;
  validationPlan: string[];
  candidateTasks: Array<Record<string, unknown>>;
} {
  if (workflowId === 'stock-strategy-discovery-loop') {
    const review = readRoleArtifactObject(
      state.artifacts.strategy_discovery_review,
    );
    const newCandidates = asArray(review.new_candidates).filter(isRecord);
    const repeatedCandidates = asArray(review.repeated_candidates);
    const blockedReasons = asArray(review.blocked_reasons);
    const dataGaps = asArray(review.data_gaps);
    const recommendedChecks = asArray(review.recommended_checks)
      .map((item) => compactFallbackText(item, 120))
      .filter(Boolean)
      .slice(0, 4);
    const changeSummary =
      newCandidates.length > 0
        ? `Planner runtime 中断；上游 discovery review 已保留 ${newCandidates.length} 个新增候选，仍需人工复核后才能进入验证。`
        : 'Planner runtime 中断；上游 discovery review 已保留，本轮未确认可上线策略。';
    const repeatSummary =
      repeatedCandidates.length > 0 ||
      blockedReasons.length > 0 ||
      dataGaps.length > 0
        ? `存在重复/阻断信号：repeated=${repeatedCandidates.length}，blocked=${blockedReasons.length}，data_gaps=${dataGaps.length}；不要同配置原样重跑。`
        : '未能从降级 fallback 中确认重复候选；请重试 planner 或查看 workflow artifacts。';
    const candidateTasks = newCandidates.slice(0, 3).map((candidate) => ({
      task_name:
        readString(candidate.candidate) ||
        readString(candidate.factor) ||
        '候选补证验证',
      market: readString(candidate.market),
      goal:
        readString(candidate.summary) ||
        '基于已保留 discovery evidence 做只读补证验证。',
      evidence: candidate.evidence ?? null,
    }));
    return {
      changeSummary,
      repeatSummary,
      validationPlan:
        recommendedChecks.length > 0
          ? recommendedChecks
          : [
              '查看 strategy_discovery_review artifact',
              '待 runtime 恢复后重试 planner',
            ],
      candidateTasks,
    };
  }

  const valueReview = readRoleArtifactObject(
    state.artifacts.strategy_value_review,
  );
  const valueVerdict = isRecord(valueReview.value_verdict)
    ? valueReview.value_verdict
    : {};
  const overallStatus = readString(valueVerdict.overall_status);
  const runtimeStatus = readString(valueVerdict.runtime_status);
  const assessments = asArray(valueVerdict.market_assessments);
  return {
    changeSummary: `Planner runtime 中断；上游价值分析已保留，当前状态为 ${overallStatus || 'insufficient_evidence'}${runtimeStatus ? ` / ${runtimeStatus}` : ''}。`,
    repeatSummary:
      '最终规划节点未完成；在 planner 恢复前不要重复上线判断，只允许查看已保存的 task/value review artifact。',
    validationPlan: [
      '查看 strategy_value_review artifact',
      '待 runtime 恢复后重试 planner',
      '保持只读，不自动 approve / activate / trade',
    ],
    candidateTasks: assessments
      .slice(0, 3)
      .filter(isRecord)
      .map((item) => ({
        task_name: `${readString(item.market).toUpperCase() || 'UNKNOWN'} 价值补证`,
        market: readString(item.market),
        goal:
          readString(item.judgement) ||
          '基于已保留 value evidence 做只读补证验证。',
        evidence_strength: readString(item.evidence_strength),
      })),
  };
}

function buildStockStrategyFallbackPlan(
  state: WorkflowGraphState,
  workflowId: string,
  message: string,
): string {
  const summary = summarizeStockStrategyReview(state, workflowId);
  return JSON.stringify(
    {
      status: 'degraded',
      change_summary: summary.changeSummary,
      repeat_decision: {
        is_repeated: true,
        summary: summary.repeatSummary,
        next_step:
          '保留上游 artifact；待 runtime 恢复后重试 planner，或按已保存证据进入人工只读补证。',
      },
      next_iteration_objective: {
        summary:
          '最终 planner 因 transient runtime 错误降级；本轮不生成新的上线结论，只保留已完成 evidence 并要求人工复核。',
        cadence_decision: {
          discovery: '连续重复时暂停同配置高频 discovery，优先补证或降频',
          validation: '只读候选验证必须等 OOS / 对照 / 风控证据齐备',
        },
      },
      candidate_tasks: summary.candidateTasks,
      validation_plan: summary.validationPlan,
      stop_conditions: [
        'no_auto_approve',
        'no_auto_activate',
        'no_broker_or_order_side_effects',
      ],
      human_review_needed: true,
      degraded_reason: message.slice(0, 700),
    },
    null,
    2,
  );
}

function shouldFallbackStockStrategyPlanner(input: {
  workflow: WorkflowDefinition;
  node: WorkflowNodeDefinition;
  transientRuntimeError: boolean;
}): boolean {
  return (
    input.transientRuntimeError &&
    STOCK_STRATEGY_WORKFLOW_IDS.has(input.workflow.id) &&
    input.node.id === STOCK_STRATEGY_PLANNER_NODE_ID
  );
}

export function getWorkflowCheckpointSqlitePath(): string {
  return path.join(STORE_DIR, 'workflow-checkpoints.sqlite');
}

export function createWorkflowCheckpointer(
  options: {
    sqlitePath?: string | null;
  } = {},
): BaseCheckpointSaver {
  if (options.sqlitePath) {
    if (options.sqlitePath !== ':memory:') {
      fs.mkdirSync(path.dirname(options.sqlitePath), { recursive: true });
    }
    return createWorkflowSqliteSaver(options.sqlitePath);
  }
  return new MemorySaver();
}

export function getPersistentWorkflowCheckpointer(): BaseCheckpointSaver {
  const sqlitePath = getWorkflowCheckpointSqlitePath();
  if (
    !persistentWorkflowCheckpointer ||
    persistentWorkflowCheckpointPath !== sqlitePath
  ) {
    persistentWorkflowCheckpointer = createWorkflowCheckpointer({ sqlitePath });
    persistentWorkflowCheckpointPath = sqlitePath;
  }
  return persistentWorkflowCheckpointer;
}

export function buildWorkflowInvokeConfig(context: WorkflowContext): {
  configurable: { thread_id: string };
} {
  return {
    configurable: {
      thread_id: context.thread_id,
    },
  };
}

export function buildWorkflowAgentPrompt(input: {
  workflow: WorkflowDefinition;
  node: WorkflowNodeDefinition;
  role: WorkflowRoleDefinition;
  userPrompt: string;
  stepResults: Record<string, WorkflowNodeResult>;
  artifacts?: Record<string, unknown>;
  initialInput?: Record<string, unknown>;
}): string {
  const upstreamResults = Object.values(input.stepResults);
  const artifacts = input.artifacts ?? {};
  const initialInput = input.initialInput ?? {};
  return [
    `[Workflow] ${input.workflow.name} (${input.workflow.id})`,
    `[Node] ${input.node.id}`,
    `[Role] ${input.role.name} (${input.role.id})`,
    input.role.description
      ? `[Role Description]\n${input.role.description}`
      : null,
    `[Role Instructions]\n${input.role.instructions}`,
    input.node.prompt ? `[Node Task]\n${input.node.prompt}` : null,
    upstreamResults.length > 0
      ? `[Previous Step Results]\n${JSON.stringify(upstreamResults, null, 2)}`
      : null,
    Object.keys(artifacts).length > 0
      ? `[Structured Artifacts]\n${JSON.stringify(artifacts, null, 2)}`
      : null,
    Object.keys(initialInput).length > 0
      ? `[Workflow Input]\n${JSON.stringify(initialInput, null, 2)}`
      : null,
    `[User Request]\n${input.userPrompt}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

export function buildWorkflowAgentInput(input: {
  workflow: WorkflowDefinition;
  node: WorkflowNodeDefinition;
  role: WorkflowRoleDefinition;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  userPrompt: string;
  stepResults?: Record<string, WorkflowNodeResult>;
  artifacts?: Record<string, unknown>;
  initialInput?: Record<string, unknown>;
}): AgentProcessInput {
  return {
    prompt: buildWorkflowAgentPrompt({
      workflow: input.workflow,
      node: input.node,
      role: input.role,
      userPrompt: input.userPrompt,
      stepResults: input.stepResults ?? {},
      artifacts: input.artifacts ?? {},
      initialInput: input.initialInput ?? {},
    }),
    groupFolder: input.group.folder,
    chatJid: input.run.trigger_chat_jid,
    agentType: 'openai',
    agentId: input.context.runtime_agent_id,
    agentName: input.role.name,
    singleTurn: true,
    workflow: {
      id: input.workflow.id,
      name: input.workflow.name,
      contextId: input.context.id,
      runId: input.run.id,
      threadId: input.context.thread_id,
      nodeId: input.node.id,
      nodeType: input.node.type,
    },
    role: {
      id: input.role.id,
      name: input.role.name,
      description: input.role.description,
      instructions: input.role.instructions,
      skillIds: input.role.skillIds,
      permissionMode: input.role.permissionMode,
      allowedTools: input.role.allowedTools,
    },
    allowedTools: input.role.allowedTools,
  };
}

function createNoopNode(node: WorkflowNodeDefinition) {
  return async (
    state: typeof WorkflowState.State,
  ): Promise<Partial<WorkflowGraphState>> => ({
    stepResults: {
      [node.id]: {
        nodeId: node.id,
        result: state.result,
      },
    },
  });
}

function createRoleTaskNode(options: {
  workflow: WorkflowDefinition;
  node: WorkflowNodeDefinition;
  role: WorkflowRoleDefinition;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  runner: WorkflowNodeRunner;
  recordStep: WorkflowStepRecorder;
  maxAttempts: number;
}) {
  return async (
    state: typeof WorkflowState.State,
  ): Promise<Partial<WorkflowGraphState>> => {
    const maxAttempts = Math.max(1, options.maxAttempts);
    const agentInput = buildWorkflowAgentInput({
      workflow: options.workflow,
      node: options.node,
      role: options.role,
      group: options.group,
      context: options.context,
      run: options.run,
      userPrompt: state.prompt,
      stepResults: state.stepResults,
      artifacts: state.artifacts,
      initialInput: state.input,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      options.recordStep({
        runId: options.run.id,
        nodeId: options.node.id,
        roleId: options.role.id,
        status: 'running',
        attempt,
        input: { prompt: state.prompt },
      });

      const output = await options
        .runner(agentInput)
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            status: 'error' as const,
            result: null,
            error: message,
          };
        });

      if (output.status !== 'success') {
        const error = output.error || output.result || 'Workflow node failed';
        const transientRuntimeError = isTransientAgentRuntimeError(error);
        const shouldRetryTransient =
          transientRuntimeError &&
          !isAgentRuntimeTimeout(error) &&
          attempt < maxAttempts;
        if (shouldRetryTransient) {
          options.recordStep({
            runId: options.run.id,
            nodeId: options.node.id,
            roleId: options.role.id,
            status: 'error',
            attempt,
            input: { prompt: state.prompt },
            error,
          });
          continue;
        }

        if (options.workflow.id === 'hkipo' && transientRuntimeError) {
          const fallbackResult =
            options.node.id === HKIPO_FINAL_REPORT_NODE_ID
              ? buildHkipoFallbackReport(state, error)
              : buildDegradedRoleNotice({
                  nodeId: options.node.id,
                  roleId: options.role.id,
                  message: error,
                });
          const artifactKey = options.node.outputArtifact ?? options.node.id;
          const roleArtifact = {
            status: 'degraded',
            nodeId: options.node.id,
            roleId: options.role.id,
            reason: error,
            result: fallbackResult,
          };
          options.recordStep({
            runId: options.run.id,
            nodeId: options.node.id,
            roleId: options.role.id,
            status: 'success',
            attempt,
            input: { prompt: state.prompt },
            output: {
              result: fallbackResult,
              artifactKey,
              artifact: roleArtifact,
            },
          });
          return {
            result: fallbackResult,
            artifacts: {
              [artifactKey]: roleArtifact,
            },
            stepResults: {
              [options.node.id]: {
                nodeId: options.node.id,
                roleId: options.role.id,
                result: fallbackResult,
              },
            },
          };
        }

        if (
          shouldFallbackStockStrategyPlanner({
            workflow: options.workflow,
            node: options.node,
            transientRuntimeError,
          })
        ) {
          const fallbackResult = buildStockStrategyFallbackPlan(
            state,
            options.workflow.id,
            error,
          );
          const artifactKey = options.node.outputArtifact ?? options.node.id;
          const roleArtifact = {
            status: 'degraded',
            nodeId: options.node.id,
            roleId: options.role.id,
            reason: error,
            result: fallbackResult,
          };
          options.recordStep({
            runId: options.run.id,
            nodeId: options.node.id,
            roleId: options.role.id,
            status: 'success',
            attempt,
            input: { prompt: state.prompt },
            output: {
              result: fallbackResult,
              artifactKey,
              artifact: roleArtifact,
            },
          });
          return {
            result: fallbackResult,
            artifacts: {
              [artifactKey]: roleArtifact,
            },
            stepResults: {
              [options.node.id]: {
                nodeId: options.node.id,
                roleId: options.role.id,
                result: fallbackResult,
              },
            },
          };
        }

        options.recordStep({
          runId: options.run.id,
          nodeId: options.node.id,
          roleId: options.role.id,
          status: 'error',
          attempt,
          input: { prompt: state.prompt },
          error,
        });
        throw new Error(error);
      }

      const result = output.result ?? null;
      const artifactKey = options.node.outputArtifact;
      const roleArtifact = artifactKey
        ? {
            nodeId: options.node.id,
            roleId: options.role.id,
            result,
          }
        : null;
      options.recordStep({
        runId: options.run.id,
        nodeId: options.node.id,
        roleId: options.role.id,
        status: 'success',
        attempt,
        input: { prompt: state.prompt },
        output: roleArtifact
          ? { result, artifactKey, artifact: roleArtifact }
          : { result },
      });

      const nextState: Partial<WorkflowGraphState> = {
        result,
        stepResults: {
          [options.node.id]: {
            nodeId: options.node.id,
            roleId: options.role.id,
            result,
          },
        },
      };
      if (artifactKey && roleArtifact) {
        nextState.artifacts = { [artifactKey]: roleArtifact };
      }
      return nextState;
    }

    throw new Error('Workflow node failed');
  };
}

function createLocalTaskNode(options: {
  workflow: WorkflowDefinition;
  node: WorkflowNodeDefinition;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  localTasks: WorkflowLocalTaskRegistry;
  recordStep: WorkflowStepRecorder;
  executionCwd?: string;
}) {
  return async (
    state: typeof WorkflowState.State,
  ): Promise<Partial<WorkflowGraphState>> => {
    const taskId = options.node.taskId;
    const task = taskId ? options.localTasks[taskId] : undefined;
    if (!taskId || !task) {
      throw new Error(
        `workflow ${options.workflow.id} node ${options.node.id} has no registered local task`,
      );
    }

    options.recordStep({
      runId: options.run.id,
      nodeId: options.node.id,
      status: 'running',
      attempt: 1,
      input: {
        taskId,
        input: state.input,
        artifacts: state.artifacts,
      },
    });

    try {
      const artifact = await task({
        taskId,
        nodeId: options.node.id,
        workflow: options.workflow,
        group: options.group,
        context: options.context,
        run: options.run,
        prompt: state.prompt,
        input: state.input,
        artifacts: state.artifacts,
        stepResults: state.stepResults,
        executionCwd: options.executionCwd,
      });
      const artifactKey = options.node.outputArtifact ?? options.node.id;
      options.recordStep({
        runId: options.run.id,
        nodeId: options.node.id,
        status: 'success',
        attempt: 1,
        input: {
          taskId,
          input: state.input,
        },
        output: {
          taskId,
          artifactKey,
          artifact,
        },
      });

      return {
        artifacts: {
          [artifactKey]: artifact,
        },
        stepResults: {
          [options.node.id]: {
            nodeId: options.node.id,
            taskId,
            result:
              typeof artifact === 'string'
                ? artifact
                : JSON.stringify(artifact, null, 2),
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.recordStep({
        runId: options.run.id,
        nodeId: options.node.id,
        status: 'error',
        attempt: 1,
        input: {
          taskId,
          input: state.input,
        },
        error: message,
      });
      throw error;
    }
  };
}

export function compileWorkflowGraph(
  options: Omit<WorkflowGraphRunOptions, 'prompt'>,
) {
  const runner =
    options.runner ??
    ((input: AgentProcessInput) =>
      runAgentProcess(
        options.group,
        input,
        options.onProcess ?? (() => {}),
        options.onOutput,
        {
          ...(options.executionCwd
            ? { executionCwd: options.executionCwd }
            : {}),
          ...(getWorkflowRoleProcessTimeoutMs(input)
            ? { processTimeoutMs: getWorkflowRoleProcessTimeoutMs(input) }
            : {}),
        },
      ));
  const recordStep = options.recordStep ?? persistWorkflowRunStep;
  const localTasks = options.localTasks ?? {};
  const graph = new StateGraph(WorkflowState) as any;
  const maxAttempts = Math.max(1, (options.workflow.maxRetries ?? 0) + 1);

  for (const node of options.workflow.nodes) {
    if (node.type === 'role_task') {
      const roleId = node.roleId;
      const role = roleId ? options.roles.get(roleId) : undefined;
      if (!role) {
        throw new Error(
          `workflow ${options.workflow.id} node ${node.id} has no resolved role`,
        );
      }
      graph.addNode(
        node.id,
        createRoleTaskNode({
          workflow: options.workflow,
          node,
          role,
          group: options.group,
          context: options.context,
          run: options.run,
          runner,
          recordStep,
          maxAttempts,
        }),
        {
          retryPolicy: {
            maxAttempts: 1,
            initialInterval: 100,
            jitter: false,
          },
        },
      );
    } else if (node.type === 'local_task') {
      graph.addNode(
        node.id,
        createLocalTaskNode({
          workflow: options.workflow,
          node,
          group: options.group,
          context: options.context,
          run: options.run,
          localTasks,
          recordStep,
          executionCwd: options.executionCwd,
        }),
        {
          retryPolicy: {
            maxAttempts,
            initialInterval: 100,
            jitter: false,
          },
        },
      );
    } else {
      graph.addNode(node.id, createNoopNode(node));
    }
  }

  graph.addEdge(START, options.workflow.start);
  for (const edge of options.workflow.edges) {
    graph.addEdge(edge.from, edge.to === WORKFLOW_END ? END : edge.to);
  }

  return graph.compile({
    checkpointer:
      options.checkpointer === false
        ? false
        : (options.checkpointer ?? createWorkflowCheckpointer()),
    name: options.workflow.id,
    description: options.workflow.description || options.workflow.name,
  });
}

export async function runWorkflowGraph(
  options: WorkflowGraphRunOptions,
): Promise<WorkflowGraphState> {
  const updateRunStatus = options.updateRunStatus ?? persistWorkflowRunStatus;
  const graph = compileWorkflowGraph(options);
  updateRunStatus(options.run.id, { status: 'running' });
  try {
    const result = (await graph.invoke(
      {
        prompt: options.prompt,
        input: options.initialInput ?? {},
        result: null,
        stepResults: {},
        artifacts: {},
      },
      buildWorkflowInvokeConfig(options.context),
    )) as WorkflowGraphState;
    updateRunStatus(options.run.id, {
      status: 'success',
      result: result.result,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRunStatus(options.run.id, { status: 'error', error: message });
    throw error;
  }
}
