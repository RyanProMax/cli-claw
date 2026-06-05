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
import { logger } from '../../core/logger.js';
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
import type { WorkflowProgressReporter } from './progress.js';

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
  progressReporter?: WorkflowProgressReporter | null;
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
const KOL_FINAL_REPORT_NODE_ID = 'kol_report_editor';
const HKIPO_ROLE_PROCESS_TIMEOUT_MS = 180_000;

function notifyWorkflowProgress(
  reporter: WorkflowProgressReporter | null | undefined,
  label: string,
  notify: (reporter: WorkflowProgressReporter) => Promise<void> | void,
): void {
  if (!reporter) return;
  try {
    void Promise.resolve(notify(reporter)).catch((err) => {
      logger.debug({ err, label }, 'Workflow progress reporter failed');
    });
  } catch (err) {
    logger.debug({ err, label }, 'Workflow progress reporter failed');
  }
}

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
  return /Agent Process timed out after|process timed out after|\btimed out after\b|TimeoutError\b|operation timed out|deadline exceeded/i.test(
    message,
  );
}

export function summarizeAgentRuntimeError(message: string): string {
  if (
    /UND_ERR_SOCKET|undici\.error\.UND_ERR_SOCKET|socket hang up|other side closed|ECONNRESET|EPIPE|network socket|fetch failed|terminated/i.test(
      message,
    )
  ) {
    return 'Agent runtime socket 异常（UND_ERR_SOCKET）';
  }
  if (
    /server_is_overloaded|service_unavailable_error|server_error|servers are currently overloaded|please try again later|502|503|504|529/i.test(
      message,
    )
  ) {
    return 'Agent runtime 服务暂时繁忙';
  }
  return message;
}

function formatAgentRuntimeErrorSummary(
  message: string,
  maxLength: number,
): string {
  const summary = summarizeAgentRuntimeError(message);
  return summary.length > maxLength
    ? `${summary.slice(0, maxLength)}...`
    : summary;
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
    `错误摘要：${formatAgentRuntimeErrorSummary(input.message, 500)}`,
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
    `Run 仍保留审计记录；错误摘要：${formatAgentRuntimeErrorSummary(message, 220)}`,
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

function normalizeKolHandle(handle: string): string {
  return handle.replace(/^@+/, '').trim();
}

function extractKolHandleFromUrl(url: string): string {
  const match = url.match(/(?:x|twitter)\.com\/([^/?#]+)/i);
  return match ? normalizeKolHandle(match[1]) : '';
}

function readKolHandle(item: Record<string, unknown>): string {
  const direct =
    readString(item.handle) ||
    readString(item.username) ||
    readString(item.screen_name) ||
    readString(item.screenName);
  if (direct) return normalizeKolHandle(direct);
  const url = readString(item.x_url) || readString(item.url);
  return url ? extractKolHandleFromUrl(url) : '';
}

function readKolDisplayName(item: Record<string, unknown>): string {
  return (
    readString(item.display_name) ||
    readString(item.displayName) ||
    readString(item.name) ||
    readString(item.id) ||
    readKolHandle(item) ||
    'Unknown KOL'
  );
}

function formatKolName(item: Record<string, unknown>): string {
  const displayName = readKolDisplayName(item);
  const handle = readKolHandle(item);
  return handle ? `${displayName}（@${handle}）` : displayName;
}

function readKolContext(state: WorkflowGraphState): Record<string, unknown> {
  const artifact = state.artifacts.kol_context;
  return isRecord(artifact) ? artifact : {};
}

function readCoveredKols(
  kolContext: Record<string, unknown>,
): Record<string, unknown>[] {
  const covered = asArray(kolContext.covered_kols).filter(isRecord);
  if (covered.length > 0) return covered;
  const whitelist = isRecord(kolContext.whitelist) ? kolContext.whitelist : {};
  return asArray(whitelist.kols).filter(isRecord);
}

function buildKolIdentityMap(
  coveredKols: Record<string, unknown>[],
  xPreflight: Record<string, unknown>,
): Map<string, string> {
  const identities = new Map<string, string>();
  const addIdentity = (item: Record<string, unknown>) => {
    const name = formatKolName(item);
    for (const key of [
      readString(item.id),
      readString(item.kol_id),
      readKolHandle(item),
      readString(item.username),
    ]) {
      if (key) identities.set(normalizeKolHandle(key), name);
    }
  };
  for (const kol of coveredKols) addIdentity(kol);
  for (const account of asArray(xPreflight.accounts).filter(isRecord)) {
    addIdentity(account);
  }
  return identities;
}

function readKolIdentity(
  item: Record<string, unknown>,
  identities: Map<string, string>,
): string {
  for (const key of [
    readString(item.kol_id),
    readString(item.id),
    readKolHandle(item),
    readString(item.username),
  ]) {
    const normalized = normalizeKolHandle(key);
    if (normalized && identities.has(normalized)) {
      return identities.get(normalized) ?? formatKolName(item);
    }
  }
  return formatKolName(item);
}

function formatKolSourceTitle(post: Record<string, unknown>): string {
  const title = readString(post.title);
  if (title) return title;
  const text = readString(post.text).replace(/\s+/g, ' ');
  if (text) return text.length > 42 ? `${text.slice(0, 42)}...` : text;
  return '原文';
}

function formatKolSourceDate(post: Record<string, unknown>): string {
  for (const key of [
    'published_at',
    'created_at',
    'posted_at',
    'date',
    'time',
    'timestamp',
  ]) {
    const rawValue = readString(post[key]);
    const match = rawValue.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
    if (match) {
      return ` [${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(
        2,
        '0',
      )}]`;
    }
  }
  return '';
}

function collectKolSourceLinks(
  kolContext: Record<string, unknown>,
  coveredKols: Record<string, unknown>[],
): string[] {
  const xPreflight = isRecord(kolContext.x_preflight)
    ? kolContext.x_preflight
    : {};
  const identities = buildKolIdentityMap(coveredKols, xPreflight);
  const seenUrls = new Set<string>();
  const lines: string[] = [];
  const pushLink = (
    author: string,
    title: string,
    url: string,
    suffix = '',
  ) => {
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    lines.push(`- ${author}：[${title}](${url})${suffix}`);
  };

  for (const result of asArray(xPreflight.results).filter(isRecord)) {
    const author = readKolIdentity(result, identities);
    for (const post of asArray(result.posts).filter(isRecord)) {
      const url = readString(post.url) || readString(post.link);
      pushLink(
        author,
        formatKolSourceTitle(post),
        url,
        formatKolSourceDate(post),
      );
    }
  }

  for (const account of asArray(xPreflight.accounts).filter(isRecord)) {
    const author = readKolIdentity(account, identities);
    const url = readString(account.url) || readString(account.x_url);
    pushLink(author, '账号主页', url, '（本轮报告编辑中断，未完成主题归因）');
  }

  for (const kol of coveredKols) {
    const url = readString(kol.x_url) || readString(kol.url);
    pushLink(
      formatKolName(kol),
      '账号主页',
      url,
      '（本轮报告编辑中断，未完成主题归因）',
    );
  }

  return lines.slice(0, 8);
}

function formatKolPreflightStatus(kolContext: Record<string, unknown>): string {
  const xPreflight = isRecord(kolContext.x_preflight)
    ? kolContext.x_preflight
    : {};
  const status = readString(xPreflight.status) || 'unknown';
  const reason =
    readString(xPreflight.error) ||
    readString(xPreflight.reason) ||
    readString(xPreflight.message);
  return reason ? `${status}（${reason.slice(0, 120)}）` : status;
}

function buildKolFallbackReport(
  state: WorkflowGraphState,
  message: string,
): string {
  const kolContext = readKolContext(state);
  const coveredKols = readCoveredKols(kolContext);
  const coveredSummary =
    readString(kolContext.covered_kol_summary) ||
    coveredKols.map(formatKolName).join('、') ||
    '未解析到白名单 KOL 名称';
  const windowDays = readNumber(kolContext.window_days) ?? 30;
  const sourceLinks = collectKolSourceLinks(kolContext, coveredKols);
  const preflightStatus = formatKolPreflightStatus(kolContext);
  const reason = formatAgentRuntimeErrorSummary(message, 220);
  const cache = isRecord(kolContext.cache) ? kolContext.cache : {};
  const retryHint =
    cache.cacheable === true
      ? '稍后重试可复用缓存继续生成完整报告。'
      : '稍后重试可重新获取上下文并生成完整报告。';

  const lines = [
    '⚠️ **KOL 情报报告｜降级报告**',
    `窗口：最近 ${windowDays} 天`,
    `覆盖 KOL（${coveredKols.length}）：${coveredSummary}`,
    '高信号主题：暂无可确认主题',
    '',
    `🧾 **结论/总结**：本轮已完成白名单与 X/Twitter 来源预检，但报告编辑角色因 ${reason} 中断。为避免把未完成整合的内容包装成投资结论，本次只返回来源可用性与保守核验方向；${retryHint}`,
    '',
    '---',
    '',
    '**近期投资方向与高信号内容**',
    '',
    '**1. 暂无可确认高信号主题：等待完整报告角色复核**',
    '',
    '🧭 **核心论点**：上游 `kol_context` 已生成，但本次最终编辑未完成，因此不能把零散帖子或账号主页直接提升为股票热点方向。',
    '',
    '📝 **观点摘要**：',
    '- **事实**：白名单范围与 X/Twitter 预检已完成；最终报告生成环节发生 runtime socket 中断。',
    '- **推断**：问题更接近模型运行时网络瞬断，而不是 KOL 抓取或账号白名单失败；重试后更可能得到完整主题合并报告。',
    '',
    '🏷️ **关联行业/代表标的**：暂无。当前证据不足以落到具体行业链、个股或 ETF。',
    '',
    '📊 **行业现状**：本次不输出行业景气判断；需等待完整报告角色基于原文链接复核后再生成。',
    '',
    '🔮 **未来叙事**：优先观察两位白名单 KOL 的原文恢复情况、是否出现多源共识，以及是否能落到可跟踪股票方向。',
    '',
    '🎯 **可跟踪方向**：先跟踪来源可用性与完整报告重跑结果；不输出买卖建议。',
    '',
    '🔗 **来源**：',
    ...(sourceLinks.length > 0
      ? sourceLinks
      : ['- 暂无可用原文链接（本轮报告编辑中断）']),
    '',
    '---',
    '',
    '**来源提醒**',
    `- X/Twitter 预检状态：${preflightStatus}`,
    '- 降级边界：不使用镜像、搜索缓存、截图或不可核验转述作为高信号主题主证据。',
  ];

  return lines.join('\n');
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

        const canDegradeTransientRole =
          transientRuntimeError &&
          (options.workflow.id === 'hkipo' || options.workflow.id === 'kol');
        if (canDegradeTransientRole) {
          const fallbackResult =
            options.workflow.id === 'hkipo' &&
            options.node.id === HKIPO_FINAL_REPORT_NODE_ID
              ? buildHkipoFallbackReport(state, error)
              : options.workflow.id === 'kol' &&
                  options.node.id === KOL_FINAL_REPORT_NODE_ID
                ? buildKolFallbackReport(state, error)
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
  const baseRecordStep = options.recordStep ?? persistWorkflowRunStep;
  const recordStep: WorkflowStepRecorder = (input) => {
    const step = baseRecordStep(input);
    notifyWorkflowProgress(options.progressReporter, 'step', (reporter) =>
      reporter.onStep?.(step),
    );
    return step;
  };
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
  const baseUpdateRunStatus =
    options.updateRunStatus ?? persistWorkflowRunStatus;
  const updateRunStatus: WorkflowRunStatusUpdater = (runId, input) => {
    const updatedRun = baseUpdateRunStatus(runId, input);
    notifyWorkflowProgress(options.progressReporter, 'run_status', (reporter) =>
      reporter.onRunStatus?.(updatedRun),
    );
    return updatedRun;
  };
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
