import fs from 'fs';
import path from 'path';

import { APP_ROOT } from '../../core/app-root.js';
import { GROUPS_DIR } from '../../core/config.js';
import type { RegisteredGroup } from '../../domain/types.js';
import { createWorkflowRun, getOrCreateWorkflowContext } from './context.js';
import {
  discoverWorkflowConfigs,
  type WorkflowRoleDefinition,
} from './config.js';
import {
  getPersistentWorkflowCheckpointer,
  runWorkflowGraph,
  type WorkflowLocalTaskRegistry,
} from './engine.js';
import {
  createDefaultWorkflowLocalTasks,
  getDefaultWorkflowLocalTaskIds,
} from './local-tasks.js';
import { DEFAULT_WORKFLOW_KNOWN_TOOLS } from './tools.js';
import {
  parseStockStrategyPlannerDecision,
  type StockStrategyPlannerDecision,
} from '../scheduler/stock-strategy-decision.js';

type WorkflowDiscovery = ReturnType<typeof discoverWorkflowConfigs>;

export interface WorkflowCommandOptions {
  group: RegisteredGroup;
  chatJid: string;
  argsText: string;
  triggerUserId?: string | null;
  workspaceRoot?: string;
  knownTools?: string[];
  knownLocalTasks?: string[];
  initialInput?: Record<string, unknown>;
  localTasks?: WorkflowLocalTaskRegistry;
  runGraph?: typeof runWorkflowGraph;
  background?: boolean;
  onBackgroundResult?: (message: string) => Promise<void> | void;
}

function splitWorkflowArgs(argsText: string): {
  workflowId: string | null;
  prompt: string;
} {
  const trimmed = argsText.trim();
  if (!trimmed) return { workflowId: null, prompt: '' };
  const [workflowId = '', ...rest] = trimmed.split(/\s+/);
  return {
    workflowId,
    prompt: rest.join(' ').trim(),
  };
}

function resolveWorkflowWorkspaceRoot(
  group: RegisteredGroup,
  explicitRoot?: string,
): string {
  const candidate =
    explicitRoot || group.customCwd || path.join(GROUPS_DIR, group.folder);
  return fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
}

function formatWorkflowErrors(errors: string[]): string {
  return ['工作流配置存在错误：', ...errors.map((error) => `- ${error}`)].join(
    '\n',
  );
}

function formatWorkflowList(
  workflows: ReturnType<typeof discoverWorkflowConfigs>['workflows'],
): string {
  if (workflows.length === 0) {
    return '当前工作区没有可用工作流，请在 .agents/workflows/ 下添加配置';
  }
  return [
    '可用工作流：',
    ...workflows.map((workflow) => `- ${workflow.id}：${workflow.name}`),
    '',
    '用法：/workflow <id> <任务>',
  ].join('\n');
}

function formatWorkflowStarted(options: {
  workflow: WorkflowDiscovery['workflows'][number];
  runId: string;
  prompt: string;
}): string {
  return [
    `🚀 已启动工作流 ${options.workflow.name} (${options.workflow.id})`,
    `Run: ${options.runId}`,
    ...(options.prompt ? [`任务：${options.prompt}`] : []),
    '完成、失败或超时后我会继续回到这里通知你。',
  ].join('\n');
}

function formatScoreComponent(
  label: string,
  value: string,
  denominator: number,
): string {
  const normalized = value.toUpperCase() === 'NA' ? 'N/A' : value;
  return /N\/?A/i.test(normalized)
    ? `${label}N/A`
    : `${label}${normalized}/${denominator}`;
}

function normalizeHkipoFinalReport(result: string): string {
  return result
    .replaceAll('Chief Securities IPO', '致富证券 IPO')
    .replace(/致富证券(?! IPO)/g, '致富证券 IPO')
    .replace(/孖展\s*多源未取到/g, '融资/孖展倍数暂无多源核验')
    .replace(/孖展[：:]\s*多源未取到/g, '融资/孖展倍数暂无多源核验')
    .replace(
      /[｜|]\s*(?:卡[：:]\s*)?热(\d+|N\/?A|NA)\s+结构(\d+|N\/?A|NA)\s+回测(\d+|N\/?A|NA)\s+基本面(\d+|N\/?A|NA)\s+估值(\d+|N\/?A|NA)\s+证据(\d+|N\/?A|NA)/gi,
      (
        _match,
        heat: string,
        structure: string,
        backtest: string,
        fundamental: string,
        valuation: string,
        evidence: string,
      ) =>
        [
          '',
          '🧮 评分：',
          formatScoreComponent('热度', heat, 20),
          '｜',
          formatScoreComponent('结构', structure, 20),
          '｜',
          formatScoreComponent('回测', backtest, 20),
          '｜',
          formatScoreComponent('基本面', fundamental, 20),
          '｜',
          formatScoreComponent('估值', valuation, 10),
          '｜',
          formatScoreComponent('证据', evidence, 10),
        ].join(''),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

interface StockStrategyBullet {
  label: string;
  text: string;
}

function compactLine(value: string, maxLength = 96): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 1)}…`
    : compacted;
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
      if (!isRecord(parsed)) continue;
      const nestedResult = readString(parsed.result);
      if (
        nestedResult &&
        !parsed.next_iteration_objective &&
        !parsed.candidate_tasks
      ) {
        return parseJsonObjectLike(nestedResult) ?? parsed;
      }
      return parsed;
    } catch {
      // Try the next candidate; workflow role output can include prose wrappers.
    }
  }
  return null;
}

function formatNumber(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed
    .toFixed(Math.abs(parsed) >= 1 ? 2 : 3)
    .replace(/0+$/g, '')
    .replace(/\.$/g, '');
}

function formatRatioAsPercent(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  const percent = Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
  return `${percent.toFixed(1).replace(/\.0$/g, '')}%`;
}

function extractPatternNumber(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1] ?? null;
}

function formatMetricEvidenceText(text: string): string | null {
  const pieces: string[] = [];
  const rankIc = extractPatternNumber(
    text,
    /rank_ic_mean["']?\s*[=:]\s*(-?\d+(?:\.\d+)?)/i,
  );
  const rankIcTstat = extractPatternNumber(
    text,
    /rank_ic_tstat["']?\s*[=:]\s*(-?\d+(?:\.\d+)?)/i,
  );
  const costSpread = extractPatternNumber(
    text,
    /cost_adjusted_quantile_spread["']?\s*[=:]\s*(-?\d+(?:\.\d+)?)/i,
  );
  const turnover = extractPatternNumber(
    text,
    /turnover["']?\s*[=:]\s*(-?\d+(?:\.\d+)?)/i,
  );
  const observations = extractPatternNumber(
    text,
    /observations["']?\s*[=:]\s*(\d+(?:\.\d+)?)/i,
  );
  const totalReturn = extractPatternNumber(
    text,
    /total_return["']?\s*[=:]\s*(-?\d+(?:\.\d+)?)/i,
  );
  const sharpe = extractPatternNumber(
    text,
    /sharpe["']?\s*[=:]\s*(-?\d+(?:\.\d+)?)/i,
  );
  const maxDrawdown = extractPatternNumber(
    text,
    /max_drawdown["']?\s*[=:]\s*(-?\d+(?:\.\d+)?)/i,
  );

  if (rankIc) pieces.push(`rank IC ${formatNumber(rankIc)}`);
  if (rankIcTstat) pieces.push(`t ${formatNumber(rankIcTstat)}`);
  if (costSpread) pieces.push(`扣成本spread ${formatNumber(costSpread)}`);
  if (turnover) pieces.push(`换手 ${formatRatioAsPercent(turnover)}`);
  if (observations) pieces.push(`样本 ${formatNumber(observations)}`);
  if (totalReturn) pieces.push(`收益 ${formatRatioAsPercent(totalReturn)}`);
  if (sharpe) pieces.push(`Sharpe ${formatNumber(sharpe)}`);
  if (maxDrawdown) pieces.push(`回撤 ${formatRatioAsPercent(maxDrawdown)}`);

  return pieces.length > 0 ? pieces.join('｜') : null;
}

function collectMetricLines(value: unknown, limit = 3): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const seenMetricEvidence = new Set<string>();
  const hasDirectMetricKey = (record: Record<string, unknown>): boolean =>
    [
      'rank_ic_mean',
      'rank_ic_tstat',
      'cost_adjusted_quantile_spread',
      'turnover',
      'observations',
      'total_return',
      'sharpe',
      'max_drawdown',
    ].some((key) => Object.prototype.hasOwnProperty.call(record, key));
  const visit = (candidate: unknown): void => {
    if (lines.length >= limit) return;
    if (typeof candidate === 'string') {
      const metricLine = formatMetricEvidenceText(candidate);
      if (
        metricLine &&
        !seen.has(metricLine) &&
        !seenMetricEvidence.has(metricLine)
      ) {
        seen.add(metricLine);
        seenMetricEvidence.add(metricLine);
        lines.push(metricLine);
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!isRecord(candidate)) return;
    const evidence = readRecord(candidate.evidence);
    const label =
      readString(candidate.candidate) ||
      readString(candidate.task_name) ||
      readString(candidate.strategy) ||
      '';
    const metricSource =
      evidence || label || hasDirectMetricKey(candidate) ? candidate : null;
    const metricLine = evidence
      ? formatMetricEvidenceText(JSON.stringify(evidence))
      : metricSource
        ? formatMetricEvidenceText(JSON.stringify(metricSource))
        : null;
    if (metricLine) {
      const line = label ? `${label}：${metricLine}` : metricLine;
      if (!seen.has(line)) {
        seen.add(line);
        seenMetricEvidence.add(metricLine);
        lines.push(line);
      }
    }
    for (const item of Object.values(candidate)) visit(item);
  };
  visit(value);
  return lines.slice(0, limit);
}

function stringifySummaryValue(value: unknown): string {
  if (typeof value === 'string') return compactLine(value, 144);
  if (Array.isArray(value)) {
    return value
      .map(stringifySummaryValue)
      .filter(Boolean)
      .slice(0, 2)
      .join('；');
  }
  if (!isRecord(value)) return '';

  const priorityKeys = [
    'summary',
    'verdict',
    'decision',
    'reason',
    'action',
    'next_action',
    'recommendation',
  ];
  const pieces: string[] = [];
  for (const key of priorityKeys) {
    const text = stringifySummaryValue(value[key]);
    if (text) pieces.push(text);
    if (pieces.length >= 2) break;
  }
  return compactLine(pieces.join('；'), 144);
}

function readChangeSummary(data: Record<string, unknown>): string {
  return (
    stringifySummaryValue(data.change_summary) ||
    stringifySummaryValue(data.delta_summary) ||
    stringifySummaryValue(data.incremental_summary) ||
    stringifySummaryValue(data.this_round_summary)
  );
}

function readRepeatDecision(data: Record<string, unknown>): string {
  return (
    stringifySummaryValue(data.repeat_decision) ||
    stringifySummaryValue(data.repetition_decision) ||
    stringifySummaryValue(data.duplication_decision)
  );
}

function formatBullet(label: string, text: string, maxLength = 144): string {
  return `- **${compactLine(label, 28)}：** ${compactLine(text, maxLength)}`;
}

function splitLabeledBullet(
  line: string,
  fallbackLabel: string,
): StockStrategyBullet {
  const match = line.match(/^([^：:]{1,36})[：:]\s*(.+)$/);
  if (!match) return { label: fallbackLabel, text: line };
  return {
    label: match[1].trim(),
    text: match[2].trim(),
  };
}

function formatBullets(
  bullets: StockStrategyBullet[],
  fallback: StockStrategyBullet,
): string[] {
  const items = bullets.length > 0 ? bullets : [fallback];
  return items.map((item) => formatBullet(item.label, item.text));
}

function readObjectiveSummary(data: Record<string, unknown>): string {
  const objective = readRecord(data.next_iteration_objective);
  return (
    readString(objective?.summary) ||
    readString(data.summary) ||
    readString(data.next_iteration_objective)
  );
}

function formatCompletionBullets(
  data: Record<string, unknown>,
): StockStrategyBullet[] {
  const bullets: StockStrategyBullet[] = [];
  const changeSummary = readChangeSummary(data);
  if (changeSummary) bullets.push({ label: '本轮', text: changeSummary });

  const repeatDecision = readRepeatDecision(data);
  if (repeatDecision) {
    bullets.push({ label: '重复判断', text: repeatDecision });
  }

  const summary = readObjectiveSummary(data);
  if (!changeSummary && summary) {
    bullets.push({ label: '结论', text: compactLine(summary, 120) });
  }

  const objective = readRecord(data.next_iteration_objective);
  const cadenceDecision = readRecord(objective?.cadence_decision);
  if (cadenceDecision) {
    for (const [market, decision] of Object.entries(cadenceDecision).slice(
      0,
      2,
    )) {
      const text = readString(decision);
      if (text) {
        bullets.push({
          label: `${market.toUpperCase()} 节奏`,
          text: compactLine(text, 72),
        });
      }
    }
  }

  const priority = readArray(objective?.priority_order)
    .map(readString)
    .filter(Boolean)
    .slice(0, 3);
  if (bullets.length < 4 && priority.length > 0) {
    bullets.push({ label: '优先级', text: priority.join(' / ') });
  }
  return bullets.slice(0, 4);
}

function formatPlanningLines(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const task of readArray(data.candidate_tasks)) {
    if (!isRecord(task)) continue;
    const name = readString(task.task_name) || readString(task.name);
    const market = readString(task.market).toUpperCase();
    const goal = readString(task.goal) || readString(task.objective);
    const normalizedName = name.toUpperCase();
    const marketPrefix =
      market &&
      !normalizedName.startsWith(`${market}_`) &&
      !normalizedName.startsWith(`${market} `)
        ? market
        : '';
    const prefix = [marketPrefix, name].filter(Boolean).join(' ');
    const line = prefix
      ? `${prefix}：${compactLine(goal || '继续补证验证', 72)}`
      : compactLine(goal, 80);
    if (line) lines.push(line);
    if (lines.length >= 3) return lines;
  }

  for (const item of readArray(data.validation_plan)) {
    const text = readString(item);
    if (text) lines.push(compactLine(text, 84));
    if (lines.length >= 3) return lines;
  }

  const objective = readRecord(data.next_iteration_objective);
  for (const item of readArray(objective?.priority_order)) {
    const text = readString(item);
    if (text) lines.push(compactLine(text, 84));
    if (lines.length >= 3) return lines;
  }
  return lines;
}

function formatStockStrategyFallback(result: string): string {
  const lines = result
    .split('\n')
    .map((line) => compactLine(line, 96))
    .filter(
      (line) =>
        line && !/^[{}\[\],"]+$/.test(line) && !/^"[\w.-]+"\s*:/.test(line),
    )
    .slice(0, 3);
  return [
    '🎯 阶段目标',
    '',
    formatBullet(
      '目标',
      '股票策略自迭代结果摘要；完整原文保留在 workflow run 审计中。',
    ),
    '',
    '📍 本轮完成',
    '',
    ...(lines.length > 0
      ? lines.map((line, index) =>
          formatBullet(index === 0 ? '摘要' : `要点 ${index + 1}`, line),
        )
      : [formatBullet('结论', '暂未解析到结构化进展。')]),
    '',
    '📈 策略效果',
    '',
    formatBullet('结论', '暂未解析到可展示的核心指标，不能据此判断可上线。'),
    '',
    '🧭 后续规划',
    '',
    formatBullet(
      '下一步',
      '查看 workflow run / step artifact 后继续补证；保持只读，不自动 approve / activate / trade。',
    ),
  ].join('\n');
}

function formatStockStrategyDecisionBlock(
  decision: StockStrategyPlannerDecision,
): string {
  const payload: Record<string, unknown> = {
    action: decision.action,
    next_workflow: decision.next_workflow,
    cadence: decision.cadence,
    reason: decision.reason,
    evidence_signature: decision.evidence_signature,
    requires_human: decision.requires_human,
  };
  if (decision.current_cadence) {
    payload.current_cadence = decision.current_cadence;
  }
  if (decision.next_cadence) {
    payload.next_cadence = decision.next_cadence;
  }
  if (decision.current_next_run_at) {
    payload.current_next_run_at = decision.current_next_run_at;
  }
  if (decision.next_run_at) {
    payload.next_run_at = decision.next_run_at;
  }
  if (decision.next_workflows && decision.next_workflows.length > 0) {
    payload.next_workflows = decision.next_workflows;
  }
  if (decision.quality_gate) {
    payload.quality_gate = decision.quality_gate;
  }
  if (decision.work_budget) {
    payload.work_budget = decision.work_budget;
  }
  return JSON.stringify(payload);
}

function formatStockStrategyDecisionForDelivery(
  workflowId: string,
  result: string,
  decision: StockStrategyPlannerDecision,
): string {
  const data = parseJsonObjectLike(result) ?? {};
  const isDiscovery = workflowId === 'stock-strategy-discovery-loop';
  const title = isDiscovery
    ? '🔎 股票策略发现｜状态路由'
    : '🧪 股票策略复盘｜状态路由';
  const changeSummary =
    readChangeSummary(data) ||
    '本轮只生成调度决策；完整 planner 结果保留在 workflow run 审计中。';
  const nextWorkflow = decision.next_workflow || '暂无下游 workflow';
  const cadence =
    [
      decision.current_cadence ? `当前 ${decision.current_cadence}` : null,
      decision.next_cadence ? `下游 ${decision.next_cadence}` : null,
      decision.current_next_run_at
        ? `下次主控 ${decision.current_next_run_at}`
        : null,
    ]
      .filter(Boolean)
      .join(' / ') ||
    decision.cadence ||
    'manual';
  const humanText = decision.requires_human ? '需要人工确认' : '无需人工确认';

  return [
    title,
    '',
    '🎯 阶段目标',
    '',
    formatBullet(
      '目标',
      '先判断新证据与状态变化，再决定继续、暂停、降频或转验证。',
    ),
    '',
    '📍 本轮完成',
    '',
    formatBullet('本轮', changeSummary),
    formatBullet(
      '调度',
      `${decision.action} -> ${nextWorkflow}（${cadence}，${humanText}）`,
    ),
    '',
    '📈 策略效果',
    '',
    formatBullet('结论', '本轮为调度路由，不新增可上线收益结论。'),
    formatBullet('提醒', '以上仅为研究证据，不代表可实盘上线。'),
    '',
    '🧭 后续规划',
    '',
    formatBullet('下一步', decision.reason || '等待新证据或人工确认。'),
    decision.evidence_signature
      ? formatBullet('证据签名', decision.evidence_signature)
      : null,
    '',
    '🛡️ **边界：** 只读，不自动 approve / activate / trade。',
    '',
    '[Scheduler Decision]',
    formatStockStrategyDecisionBlock(decision),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function formatStockStrategyResultForDelivery(
  workflowId: string,
  result: string,
): string {
  const schedulerDecision = parseStockStrategyPlannerDecision(result);
  if (schedulerDecision) {
    return formatStockStrategyDecisionForDelivery(
      workflowId,
      result,
      schedulerDecision,
    );
  }

  const data = parseJsonObjectLike(result);
  if (!data) return formatStockStrategyFallback(result);

  const isDiscovery = workflowId === 'stock-strategy-discovery-loop';
  const title = isDiscovery
    ? '🔎 股票策略发现｜30m 探索'
    : '🧪 股票策略复盘｜6h 成熟/候选';
  const goal = isDiscovery
    ? '短间隔挖掘候选，先补证再候选验证；不自动上线。'
    : '复盘成熟/候选策略价值，决定继续、降频或停止。';
  const completionBullets = formatCompletionBullets(data);
  const metricLines = collectMetricLines(data, 3);
  const planningLines = formatPlanningLines(data);

  return [
    title,
    '',
    '🎯 阶段目标',
    '',
    formatBullet('目标', goal),
    '',
    '📍 本轮完成',
    '',
    ...formatBullets(completionBullets, {
      label: '结论',
      text: '暂无结构化本轮完成摘要。',
    }),
    '',
    '📈 策略效果',
    '',
    ...(metricLines.length > 0
      ? metricLines.map((line) => {
          const bullet = splitLabeledBullet(line, '指标');
          return formatBullet(bullet.label, bullet.text);
        })
      : [formatBullet('结论', '暂无可判定收益；当前仍处候选/补证阶段。')]),
    formatBullet('提醒', '以上仅为研究证据，不代表可实盘上线。'),
    '',
    '🧭 后续规划',
    '',
    ...(planningLines.length > 0
      ? planningLines.map((line) => {
          const bullet = splitLabeledBullet(line, '下一步');
          return formatBullet(bullet.label, bullet.text);
        })
      : [
          formatBullet(
            '下一步',
            '继续补证，等待 OOS / 对照 / 风控证据齐备后再评审。',
          ),
        ]),
    '',
    '🛡️ **边界：** 只读，不自动 approve / activate / trade。',
  ].join('\n');
}

function normalizeWorkflowResultForDelivery(
  workflowId: string,
  result: string,
): string {
  if (workflowId === 'hkipo') return normalizeHkipoFinalReport(result);
  if (
    workflowId === 'stock-strategy-discovery-loop' ||
    workflowId === 'stock-strategy-loop'
  ) {
    return formatStockStrategyResultForDelivery(workflowId, result);
  }
  return result;
}

function formatWorkflowSuccess(options: {
  workflow: WorkflowDiscovery['workflows'][number];
  result: string;
}): string {
  const normalizedResult = normalizeWorkflowResultForDelivery(
    options.workflow.id,
    options.result,
  );
  return [
    `✅ 工作流 ${options.workflow.name} (${options.workflow.id}) 完成：`,
    normalizedResult || '无输出',
  ].join('\n');
}

function formatWorkflowFailure(options: {
  workflow: WorkflowDiscovery['workflows'][number];
  message: string;
}): string {
  return `❌ 工作流 ${options.workflow.name} (${options.workflow.id}) 失败：${options.message}`;
}

function discoverWorkflowConfigsWithBuiltins(options: {
  workspaceRoot: string;
  knownTools: string[];
  knownLocalTasks: string[];
}): WorkflowDiscovery {
  const roots = Array.from(new Set([APP_ROOT, options.workspaceRoot]));
  const workflowById = new Map<
    string,
    WorkflowDiscovery['workflows'][number]
  >();
  const roles = new Map<string, WorkflowRoleDefinition>();
  const errors: string[] = [];

  for (const root of roots) {
    const discovered = discoverWorkflowConfigs({
      workspaceRoot: root,
      knownTools: options.knownTools,
      knownLocalTasks: options.knownLocalTasks,
    });
    errors.push(...discovered.errors);
    for (const [roleId, role] of discovered.roles.entries()) {
      roles.set(roleId, role);
    }
    for (const workflow of discovered.workflows) {
      workflowById.set(workflow.id, workflow);
    }
  }

  return {
    workflows: [...workflowById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    roles,
    errors: Array.from(new Set(errors)),
  };
}

export async function executeWorkflowCommand(
  options: WorkflowCommandOptions,
): Promise<string> {
  const workspaceRoot = resolveWorkflowWorkspaceRoot(
    options.group,
    options.workspaceRoot,
  );
  const knownTools = options.knownTools ?? [...DEFAULT_WORKFLOW_KNOWN_TOOLS];
  const knownLocalTasks =
    options.knownLocalTasks ?? getDefaultWorkflowLocalTaskIds();
  const { workflowId, prompt } = splitWorkflowArgs(options.argsText);

  if (!workflowId) {
    const discovered = discoverWorkflowConfigsWithBuiltins({
      workspaceRoot,
      knownTools,
      knownLocalTasks,
    });
    if (discovered.errors.length > 0) {
      return formatWorkflowErrors(discovered.errors);
    }
    return formatWorkflowList(discovered.workflows);
  }

  if (!prompt) {
    return `用法：/workflow ${workflowId} <任务>`;
  }

  const discovered = discoverWorkflowConfigsWithBuiltins({
    workspaceRoot,
    knownTools,
    knownLocalTasks,
  });
  const workflow =
    discovered.workflows.find((candidate) => candidate.id === workflowId) ??
    null;
  if (!workflow) {
    return formatWorkflowErrors([
      ...discovered.errors,
      `workflow ${workflowId} not found`,
    ]);
  }
  if (discovered.errors.length > 0) {
    return formatWorkflowErrors(discovered.errors);
  }

  const context = getOrCreateWorkflowContext({
    folder: options.group.folder,
    workflowId: workflow.id,
    workspaceJid: options.chatJid.startsWith('web:') ? options.chatJid : null,
    metadata: { workspaceRoot },
  });
  const run = createWorkflowRun({
    contextId: context.id,
    folder: options.group.folder,
    workflowId: workflow.id,
    triggerChatJid: options.chatJid,
    triggerUserId: options.triggerUserId ?? null,
    prompt,
    metadata: {
      source: 'slash-command',
      initialInput: options.initialInput ?? {},
    },
  });

  const runAndFormatResult = async (): Promise<string> => {
    const graphRunner = options.runGraph ?? runWorkflowGraph;
    try {
      const result = await graphRunner({
        workflow,
        roles: discovered.roles,
        group: options.group,
        context,
        run,
        prompt,
        initialInput: options.initialInput,
        localTasks:
          options.localTasks ??
          createDefaultWorkflowLocalTasks({ workspaceRoot }),
        executionCwd: workspaceRoot,
        checkpointer: getPersistentWorkflowCheckpointer(),
      });
      return formatWorkflowSuccess({
        workflow,
        result: result.result ?? '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatWorkflowFailure({ workflow, message });
    }
  };

  if (options.background) {
    const startedMessage = formatWorkflowStarted({
      workflow,
      runId: run.id,
      prompt,
    });
    void (async () => {
      const message = await runAndFormatResult();
      if (!options.onBackgroundResult) return;
      try {
        await options.onBackgroundResult(message);
      } catch {
        // Delivery failures are logged by the caller's transport when available.
      }
    })();
    return startedMessage;
  }

  return runAndFormatResult();
}
