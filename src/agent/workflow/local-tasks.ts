import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { APP_ROOT } from '../../core/app-root.js';
import { ensureCacheNamespaceDir, withCacheTempDir } from '../../core/cache.js';
import Database from '../../storage/sqlite-compat.js';
import type {
  WorkflowLocalTask,
  WorkflowLocalTaskInput,
  WorkflowLocalTaskRegistry,
} from './engine.js';
import { DEFAULT_WORKFLOW_LOCAL_TASK_IDS } from './tools.js';

const execFileAsync = promisify(execFile);
const JSON_BUFFER_BYTES = 20 * 1024 * 1024;

interface DefaultWorkflowLocalTaskOptions {
  workspaceRoot?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pruneArtifactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') {
    return value.length > 2_000 ? `${value.slice(0, 2_000)}...` : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => pruneArtifactValue(item, depth + 1));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        pruneArtifactValue(item, depth + 1),
      ]),
    );
  }
  return value;
}

function findExecutable(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return null;
  if (path.isAbsolute(value) || value.includes(path.sep)) {
    const candidate = path.resolve(value);
    return fs.existsSync(candidate) ? candidate : null;
  }
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, value);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveUvExecutable(): string {
  for (const envName of ['STOCK_ANALYSIS_UV', 'UV_BIN', 'UV']) {
    const resolved = findExecutable(process.env[envName] ?? '');
    if (resolved) return resolved;
  }
  const pathUv = findExecutable('uv');
  if (pathUv) return pathUv;
  for (const candidate of [
    path.join(os.homedir(), '.local', 'bin', 'uv'),
    path.join(os.homedir(), '.cargo', 'bin', 'uv'),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('未找到 uv，可设置 STOCK_ANALYSIS_UV / UV_BIN / UV');
}

function resolvePythonExecutable(): string {
  for (const envName of ['STOCK_ANALYSIS_PYTHON', 'PYTHON_BIN']) {
    const resolved = findExecutable(process.env[envName] ?? '');
    if (resolved) return resolved;
  }
  for (const candidate of ['python3', 'python']) {
    const resolved = findExecutable(candidate);
    if (resolved) return resolved;
  }
  throw new Error('未找到 python，可设置 STOCK_ANALYSIS_PYTHON / PYTHON_BIN');
}

function resolveStockAnalysisApiRoot(options: {
  workspaceRoot?: string;
  executionCwd?: string;
}): string {
  const candidates = [
    process.env.STOCK_ANALYSIS_API_ROOT,
    options.workspaceRoot
      ? path.join(options.workspaceRoot, '..', 'stock-analysis-api')
      : null,
    options.executionCwd
      ? path.join(options.executionCwd, '..', 'stock-analysis-api')
      : null,
    path.join(APP_ROOT, '..', 'stock-analysis-api'),
    path.join(APP_ROOT, '..', '..', 'stock-analysis-api'),
    path.join(os.homedir(), 'projects', 'stock-analysis-api'),
    path.join(os.homedir(), 'stock-analysis-api'),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'scripts', 'futu_market_data.py'))) {
      return resolved;
    }
  }
  throw new Error(
    '未找到 stock-analysis-api 仓库或 scripts/futu_market_data.py',
  );
}

function resolveStockAnalysisSkillRoot(options: {
  workspaceRoot?: string;
  executionCwd?: string;
}): string {
  const candidates = [
    process.env.STOCK_ANALYSIS_SKILL_ROOT,
    options.workspaceRoot
      ? path.join(options.workspaceRoot, '..', 'stock-analysis-skill')
      : null,
    options.executionCwd
      ? path.join(options.executionCwd, '..', 'stock-analysis-skill')
      : null,
    path.join(APP_ROOT, '..', 'stock-analysis-skill'),
    path.join(APP_ROOT, '..', '..', 'stock-analysis-skill'),
    path.join(os.homedir(), 'projects', 'stock-analysis-skill'),
    path.join(os.homedir(), 'stock-analysis-skill'),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'scripts', 'hkipo_backtest.py'))) {
      return resolved;
    }
  }
  throw new Error(
    '未找到 stock-analysis-skill 仓库或 scripts/hkipo_backtest.py',
  );
}

async function runStockApiJson(
  args: string[],
  input: WorkflowLocalTaskInput,
  options: DefaultWorkflowLocalTaskOptions,
  runOptions: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const apiRoot = resolveStockAnalysisApiRoot({
    workspaceRoot: options.workspaceRoot,
    executionCwd: input.executionCwd,
  });
  const uv = resolveUvExecutable();
  const { stdout, stderr } = await execFileAsync(
    uv,
    ['run', 'python', ...args],
    {
      cwd: apiRoot,
      timeout: runOptions.timeoutMs ?? 120_000,
      maxBuffer: JSON_BUFFER_BYTES,
      env: process.env,
    },
  );
  const raw = stdout.trim();
  if (!raw) {
    throw new Error(stderr.trim() || `stock-analysis-api ${args[0]} 无输出`);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) throw new Error('payload is not an object');
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`stock-analysis-api JSON 解析失败：${message}`);
  }
}

async function runStockSkillJson(
  args: string[],
  input: WorkflowLocalTaskInput,
  options: DefaultWorkflowLocalTaskOptions,
): Promise<Record<string, unknown>> {
  const skillRoot = resolveStockAnalysisSkillRoot({
    workspaceRoot: options.workspaceRoot,
    executionCwd: input.executionCwd,
  });
  const python = resolvePythonExecutable();
  const { stdout, stderr } = await execFileAsync(python, args, {
    cwd: skillRoot,
    timeout: 180_000,
    maxBuffer: JSON_BUFFER_BYTES,
    env: process.env,
  });
  const raw = stdout.trim();
  if (!raw) {
    throw new Error(stderr.trim() || `stock-analysis-skill ${args[0]} 无输出`);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) throw new Error('payload is not an object');
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`stock-analysis-skill JSON 解析失败：${message}`);
  }
}

function currentShanghaiDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function getArtifactArray(
  input: WorkflowLocalTaskInput,
  artifactKey: string,
): unknown[] {
  const artifact = input.artifacts[artifactKey];
  if (Array.isArray(artifact)) return artifact;
  if (isObject(artifact) && Array.isArray(artifact.data)) return artifact.data;
  return [];
}

function resolveWorkflowTaskInput(
  input: WorkflowLocalTaskInput,
): Record<string, unknown> {
  const nestedInput = isObject(input.input.input) ? input.input.input : {};
  return { ...nestedInput, ...input.input };
}

function readWorkflowIncludeClosed(input: WorkflowLocalTaskInput): boolean {
  return resolveWorkflowTaskInput(input).includeClosed === true;
}

function readWorkflowReportDate(input: WorkflowLocalTaskInput): string {
  const taskInput = resolveWorkflowTaskInput(input);
  return typeof taskInput.reportDate === 'string'
    ? taskInput.reportDate
    : currentShanghaiDate();
}

function readWorkflowMarkets(input: WorkflowLocalTaskInput): string[] {
  const taskInput = resolveWorkflowTaskInput(input);
  const rawMarkets = taskInput.markets;
  if (Array.isArray(rawMarkets)) {
    const markets = rawMarkets
      .map((item) =>
        typeof item === 'string' ? item.trim().toLowerCase() : '',
      )
      .filter((item) => item === 'hk' || item === 'us' || item === 'cn');
    return markets.length > 0 ? markets : ['hk', 'us'];
  }
  if (typeof rawMarkets === 'string') {
    const markets = rawMarkets
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item === 'hk' || item === 'us' || item === 'cn');
    return markets.length > 0 ? markets : ['hk', 'us'];
  }
  return ['hk', 'us'];
}

function readWorkflowDiscoveryMarkets(input: WorkflowLocalTaskInput): string[] {
  const explicitMarkets = readWorkflowMarkets(input);
  if (resolveWorkflowTaskInput(input).markets !== undefined) {
    return explicitMarkets;
  }
  return ['cn', 'hk', 'us'];
}

function readWorkflowFactors(input: WorkflowLocalTaskInput): string[] {
  const taskInput = resolveWorkflowTaskInput(input);
  const rawFactors = taskInput.factors;
  const normalize = (items: unknown[]): string[] =>
    items
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
      .slice(0, 8);
  if (Array.isArray(rawFactors)) {
    const factors = normalize(rawFactors);
    if (factors.length > 0) return factors;
  }
  if (typeof rawFactors === 'string') {
    const factors = normalize(rawFactors.split(','));
    if (factors.length > 0) return factors;
  }
  return ['momentum_5d', 'momentum_20d', 'volume_change_5d'];
}

function readWorkflowMaxTasks(input: WorkflowLocalTaskInput): number {
  const value = resolveWorkflowTaskInput(input).maxTasks;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.min(50, Math.floor(value));
  }
  return 12;
}

function readWorkflowTop(input: WorkflowLocalTaskInput): number {
  const value = resolveWorkflowTaskInput(input).top;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.min(100, Math.floor(value));
  }
  return 20;
}

function readWorkflowMinObservations(input: WorkflowLocalTaskInput): number {
  const value = resolveWorkflowTaskInput(input).minObservations;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.min(250, Math.floor(value));
  }
  return 20;
}

function readWorkflowMinBacktestPeriods(input: WorkflowLocalTaskInput): number {
  const value = resolveWorkflowTaskInput(input).minBacktestPeriods;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.min(120, Math.floor(value));
  }
  return 3;
}

function readWorkflowUniverse(input: WorkflowLocalTaskInput): string {
  const value = resolveWorkflowTaskInput(input).universe;
  return typeof value === 'string' && value.trim() ? value.trim() : 'all';
}

function readWorkflowMarket(
  input: WorkflowLocalTaskInput,
  fallback: 'cn' | 'hk' | 'us',
): 'cn' | 'hk' | 'us' {
  const value = resolveWorkflowTaskInput(input).market;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === 'cn' || normalized === 'hk' || normalized === 'us'
    ? normalized
    : fallback;
}

function readWorkflowSymbols(input: WorkflowLocalTaskInput): string | null {
  const value = resolveWorkflowTaskInput(input).symbols;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const symbols = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return symbols.length > 0 ? symbols.join(',') : null;
  }
  return null;
}

function readWorkflowString(
  input: WorkflowLocalTaskInput,
  key: string,
  fallback: string,
): string {
  const value = resolveWorkflowTaskInput(input)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readWorkflowNumberOrNull(
  input: WorkflowLocalTaskInput,
  key: string,
): number | null {
  const value = resolveWorkflowTaskInput(input)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function appendOptionalNumberArg(
  args: string[],
  flag: string,
  value: number | null,
): void {
  if (value !== null) args.push(flag, String(value));
}

function artifactStatus(value: Record<string, unknown>): string {
  return typeof value.status === 'string' ? value.status : 'ok';
}

function evidenceSignature(parts: {
  market: string;
  factor: string;
  universe: string;
  costModel: string;
  holdingWindow: string;
  dataVersion: string;
}): string {
  return [
    parts.market,
    parts.factor,
    parts.universe,
    parts.costModel,
    parts.holdingWindow,
    parts.dataVersion,
  ].join(':');
}

const STOCK_STRATEGY_USABILITY_STANDARD = {
  version: 'stock_strategy_usability_v1',
  pause_policy:
    'pause_only_when_strategy_usability_passed_otherwise_continue_iteration',
  required_checks: [
    {
      id: 'artifact_integrity',
      description:
        'All mandatory validation artifacts are present and not degraded.',
    },
    {
      id: 'oos_segment_performance',
      description:
        'Out-of-sample segment evidence is available and not dependent on one recent slice.',
    },
    {
      id: 'champion_challenger_comparison',
      description:
        'Candidate is compared against the current champion under the same universe, holding window, and cost model.',
    },
    {
      id: 'liquidity_and_execution',
      description:
        'Selected symbols include average_amount_5d and turnover_rate evidence sufficient for execution review.',
    },
    {
      id: 'risk_and_cost_sensitivity',
      description:
        'Drawdown, turnover, and default plus stressed cost sensitivity do not invalidate the net edge.',
    },
    {
      id: 'explainable_universe',
      description:
        'Universe expands beyond a tiny symbol sample and concentration is explainable by industry or theme.',
    },
    {
      id: 'human_approval_boundary',
      description:
        'Human review remains required before approve, activate, or any broker action.',
    },
  ],
} as const;

function getCode(item: unknown): string {
  return isObject(item) && typeof item.code === 'string' ? item.code : '';
}

function getName(item: unknown): string {
  return isObject(item) && typeof item.name === 'string' ? item.name : '';
}

function buildDegradedHeatScanArtifact(
  ipos: unknown[],
  reportDate: string,
  reason: string,
): Record<string, unknown> {
  return {
    status: 'degraded',
    source: 'hkipo_heat_scan',
    report_date: reportDate,
    generatedAt: new Date().toISOString(),
    reason,
    errors: [
      {
        source: 'hkipo_heat_scan',
        source_family: 'workflow_local_task',
        error: reason,
      },
    ],
    summary: {
      ipo_count: ipos.length,
      same_day_heat_count: 0,
      degraded_count: ipos.length,
    },
    data: ipos.map((item) => ({
      code: getCode(item),
      name: getName(item),
      stage: isObject(item) ? item.stage : undefined,
      heat_status: 'heat_threshold_not_met',
      evidence_quality: 'low',
      subscription_heat: {
        status: '热度未达当日核验门槛',
      },
      structure_status: 'core_structure_not_verified',
      valuation_status: 'valuation_context_not_verified',
      structure_evidence: [],
      valuation_evidence: [],
      evidence: [],
      source_errors: [
        {
          source: 'hkipo_heat_scan',
          source_family: 'workflow_local_task',
          error: reason,
        },
      ],
    })),
  };
}

function buildDegradedOfficialDocsArtifact(
  ipos: unknown[],
  reportDate: string,
  reason: string,
): Record<string, unknown> {
  return {
    status: 'degraded',
    source: 'hkipo_official_docs',
    report_date: reportDate,
    generatedAt: new Date().toISOString(),
    reason,
    errors: [
      {
        source: 'hkipo_official_docs',
        source_family: 'workflow_local_task',
        error: reason,
      },
    ],
    summary: {
      ipo_count: ipos.length,
      parsed_document_count: 0,
      degraded_count: ipos.length,
    },
    data: ipos.map((item) => ({
      code: getCode(item),
      name: getName(item),
      stage: isObject(item) ? item.stage : undefined,
      status: 'official_docs_degraded',
      documents: [],
      structure_evidence: [],
      valuation_evidence: [],
      source_errors: [
        {
          source: 'hkipo_official_docs',
          source_family: 'workflow_local_task',
          error: reason,
        },
      ],
    })),
  };
}

function resolveStockTaskChainDbPath(options: DefaultWorkflowLocalTaskOptions) {
  if (process.env.STOCK_STRATEGY_TASK_DB?.trim()) {
    return path.resolve(process.env.STOCK_STRATEGY_TASK_DB);
  }
  const apiRoot = resolveStockAnalysisApiRoot({
    workspaceRoot: options.workspaceRoot,
  });
  return path.join(apiRoot, '.cache', 'task_chain.sqlite');
}

function hasSqliteTable(db: any, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function mapTaskChainTask(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: row.id,
    task_type: row.task_type,
    status: row.status,
    priority: row.priority,
    due_at: row.due_at,
    updated_at: row.updated_at,
    result: pruneArtifactValue(parseJsonValue(row.result_json)),
    error: row.error || null,
  };
}

function createCollectStrategyResultsTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const taskDbPath = resolveStockTaskChainDbPath(options);
    const maxTasks = readWorkflowMaxTasks(input);
    if (!fs.existsSync(taskDbPath)) {
      return {
        status: 'degraded',
        source: 'stock_strategy_collect_results',
        generatedAt: new Date().toISOString(),
        reason: `stock task-chain DB 不存在：${taskDbPath}`,
        task_chain: {
          latest_tasks: [],
          pending_tasks: [],
          latest_summaries: [],
          latest_handoff_outputs: [],
        },
      };
    }

    const db = new Database(taskDbPath, { readonly: true });
    try {
      const latestTasks = hasSqliteTable(db, 'task_chain_tasks')
        ? (
            db
              .prepare(
                `
              SELECT id, task_type, status, priority, due_at, result_json, error, updated_at
              FROM task_chain_tasks
              ORDER BY updated_at DESC
              LIMIT ?
              `,
              )
              .all(maxTasks) as Record<string, unknown>[]
          ).map(mapTaskChainTask)
        : [];
      const pendingTasks = hasSqliteTable(db, 'task_chain_tasks')
        ? (
            db
              .prepare(
                `
              SELECT id, task_type, status, priority, due_at, result_json, error, updated_at
              FROM task_chain_tasks
              WHERE status IN ('pending', 'running')
              ORDER BY due_at ASC, priority ASC
              LIMIT ?
              `,
              )
              .all(8) as Record<string, unknown>[]
          ).map(mapTaskChainTask)
        : [];
      const latestSummaries = hasSqliteTable(db, 'task_chain_summaries')
        ? (
            db
              .prepare(
                `
              SELECT id, summary_type, period_start, period_end, summary_json, created_at
              FROM task_chain_summaries
              ORDER BY created_at DESC
              LIMIT 5
              `,
              )
              .all() as Record<string, unknown>[]
          ).map((row) => ({
            id: row.id,
            summary_type: row.summary_type,
            period_start: row.period_start,
            period_end: row.period_end,
            created_at: row.created_at,
            summary: pruneArtifactValue(parseJsonValue(row.summary_json)),
          }))
        : [];
      const latestHandoffOutputs = hasSqliteTable(
        db,
        'task_chain_agent_handoff_outputs',
      )
        ? (
            db
              .prepare(
                `
              SELECT id, handoff_id, output_json, created_at
              FROM task_chain_agent_handoff_outputs
              ORDER BY created_at DESC
              LIMIT 5
              `,
              )
              .all() as Record<string, unknown>[]
          ).map((row) => ({
            id: row.id,
            handoff_id: row.handoff_id,
            created_at: row.created_at,
            output: pruneArtifactValue(parseJsonValue(row.output_json)),
          }))
        : [];

      return {
        status: 'ok',
        source: 'stock_strategy_collect_results',
        generatedAt: new Date().toISOString(),
        task_db: taskDbPath,
        task_chain: {
          latest_tasks: latestTasks,
          pending_tasks: pendingTasks,
          latest_summaries: latestSummaries,
          latest_handoff_outputs: latestHandoffOutputs,
        },
      };
    } finally {
      db.close?.();
    }
  };
}

async function runStockApiJsonOrDegraded(
  label: string,
  args: string[],
  input: WorkflowLocalTaskInput,
  options: DefaultWorkflowLocalTaskOptions,
): Promise<Record<string, unknown>> {
  try {
    return await runStockApiJson(args, input, options, { timeoutMs: 180_000 });
  } catch (error) {
    return {
      status: 'degraded',
      source: label,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function createAnalyzeStrategyValueTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const reportDate = readWorkflowReportDate(input);
    const markets = readWorkflowMarkets(input);
    const tradingDailySummary = await runStockApiJsonOrDegraded(
      'trading_daily_summary',
      ['scripts/trading_daily_summary.py', '--date', reportDate],
      input,
      options,
    );
    const alphaDailyReports: Record<string, unknown>[] = await Promise.all(
      markets.map(async (market) => ({
        market,
        ...(await runStockApiJsonOrDegraded(
          'alpha_daily_report',
          [
            'scripts/alpha_daily_report.py',
            '--market',
            market,
            '--date',
            reportDate,
          ],
          input,
          options,
        )),
      })),
    );
    const degraded =
      tradingDailySummary.status === 'degraded' ||
      alphaDailyReports.some((report) => report.status === 'degraded');

    return {
      status: degraded ? 'degraded' : 'ok',
      source: 'stock_strategy_analyze_value',
      report_date: reportDate,
      generatedAt: new Date().toISOString(),
      trading_daily_summary: pruneArtifactValue(tradingDailySummary),
      alpha_daily_reports: pruneArtifactValue(alphaDailyReports),
    };
  };
}

function createDiscoveryCycleTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const reportDate = readWorkflowReportDate(input);
    const markets = readWorkflowDiscoveryMarkets(input);
    const factors = readWorkflowFactors(input);
    const top = readWorkflowTop(input);
    const universe = readWorkflowUniverse(input);
    const symbols = readWorkflowSymbols(input);
    const minObservations = readWorkflowMinObservations(input);
    const minBacktestPeriods = readWorkflowMinBacktestPeriods(input);
    const recordToRegistry =
      resolveWorkflowTaskInput(input).recordToRegistry === true;
    const marketResults = await Promise.all(
      markets.map(async (market) => {
        const scanArgs = [
          'scripts/alpha_scan.py',
          '--market',
          market,
          '--universe',
          universe,
          '--top',
          String(top),
          '--as-of',
          reportDate,
        ];
        if (symbols) scanArgs.push('--symbols', symbols);

        const researchArgs = [
          'scripts/alpha_research_loop.py',
          '--market',
          market,
          '--universe',
          universe,
          '--factors',
          factors.join(','),
          '--date',
          reportDate,
          '--top',
          String(top),
          '--min-observations',
          String(minObservations),
          '--min-backtest-periods',
          String(minBacktestPeriods),
        ];
        if (symbols) researchArgs.push('--symbols', symbols);
        if (recordToRegistry) researchArgs.push('--record-to-registry');

        const [scan, researchLoop] = await Promise.all([
          runStockApiJsonOrDegraded('alpha_scan', scanArgs, input, options),
          runStockApiJsonOrDegraded(
            'alpha_research_loop',
            researchArgs,
            input,
            options,
          ),
        ]);

        return {
          market,
          scan: pruneArtifactValue(scan),
          research_loop: pruneArtifactValue(researchLoop),
        };
      }),
    );
    const degraded = marketResults.some((result) => {
      const scan = result.scan;
      const researchLoop = result.research_loop;
      return (
        (isObject(scan) && scan.status === 'degraded') ||
        (isObject(researchLoop) && researchLoop.status === 'degraded')
      );
    });

    return {
      status: degraded ? 'degraded' : 'ok',
      source: 'stock_strategy_discovery_cycle',
      cadence: 'discovery',
      report_date: reportDate,
      generatedAt: new Date().toISOString(),
      request: {
        markets,
        factors,
        top,
        universe,
        symbols,
        min_observations: minObservations,
        min_backtest_periods: minBacktestPeriods,
        record_to_registry: recordToRegistry,
      },
      constraints: [
        'summary_only_artifact',
        'no_broker_or_order_side_effects',
        'no_auto_approve',
        'no_auto_activate',
        'human_approval_required_before_activation',
      ],
      markets: marketResults,
    };
  };
}

function createCandidateValidationTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const reportDate = readWorkflowReportDate(input);
    const market = readWorkflowMarket(input, 'us');
    const universe = readWorkflowUniverse(input);
    const symbols = readWorkflowSymbols(input);
    const top = readWorkflowTop(input);
    const candidateFactor = readWorkflowString(
      input,
      'candidateFactor',
      'momentum_5d',
    );
    const championFactor = readWorkflowString(
      input,
      'championFactor',
      'momentum_20d',
    );
    const holdingWindow = readWorkflowString(input, 'holdingWindow', '5d');
    const costBps = readWorkflowNumberOrNull(input, 'costBps');
    const costModel = costBps === null ? 'default_cost' : `${costBps}bps`;
    const baseArgs = ['--market', market, '--universe', universe];
    if (symbols) baseArgs.push('--symbols', symbols);

    const evaluateArgs = (factor: string) => [
      'scripts/alpha_evaluate.py',
      ...baseArgs,
      '--factor',
      factor,
      '--end',
      reportDate,
      '--forward-windows',
      '1,5,10,20',
    ];
    const backtestArgs = (factor: string) => [
      'scripts/alpha_backtest.py',
      ...baseArgs,
      '--factor',
      factor,
      '--end',
      reportDate,
      '--top-n',
      String(Math.min(top, 20)),
      '--holding-period',
      holdingWindow.replace(/d$/i, ''),
      '--include-details',
    ];
    const candidateEvaluationArgs = evaluateArgs(candidateFactor);
    const championEvaluationArgs = evaluateArgs(championFactor);
    const candidateBacktestArgs = backtestArgs(candidateFactor);
    const championBacktestArgs = backtestArgs(championFactor);
    for (const args of [
      candidateEvaluationArgs,
      championEvaluationArgs,
      candidateBacktestArgs,
      championBacktestArgs,
    ]) {
      appendOptionalNumberArg(args, '--cost-bps', costBps);
    }

    const scanArgs = [
      'scripts/alpha_scan.py',
      ...baseArgs,
      '--top',
      String(Math.min(top, 50)),
      '--as-of',
      reportDate,
    ];

    const [
      candidateEvaluation,
      championEvaluation,
      candidateBacktest,
      championBacktest,
      liquiditySnapshot,
    ] = await Promise.all([
      runStockApiJsonOrDegraded(
        'alpha_evaluate_candidate',
        candidateEvaluationArgs,
        input,
        options,
      ),
      runStockApiJsonOrDegraded(
        'alpha_evaluate_champion',
        championEvaluationArgs,
        input,
        options,
      ),
      runStockApiJsonOrDegraded(
        'alpha_backtest_candidate',
        candidateBacktestArgs,
        input,
        options,
      ),
      runStockApiJsonOrDegraded(
        'alpha_backtest_champion',
        championBacktestArgs,
        input,
        options,
      ),
      runStockApiJsonOrDegraded(
        'alpha_scan_liquidity',
        scanArgs,
        input,
        options,
      ),
    ]);
    const subResults = [
      candidateEvaluation,
      championEvaluation,
      candidateBacktest,
      championBacktest,
      liquiditySnapshot,
    ];
    const degraded = subResults.some(
      (result) => artifactStatus(result) === 'degraded',
    );

    return {
      status: degraded ? 'degraded' : 'ok',
      source: 'stock_strategy_candidate_validation',
      generatedAt: new Date().toISOString(),
      market,
      report_date: reportDate,
      evidence_signature: evidenceSignature({
        market,
        factor: candidateFactor,
        universe,
        costModel,
        holdingWindow,
        dataVersion: reportDate,
      }),
      market_state: {
        market,
        state: 'candidate_validation',
        next_state_on_pass: 'human_review_ready',
        next_state_on_fail: 'cooldown',
      },
      candidate: {
        candidate_id: `alpha_topn_${candidateFactor}.${reportDate.replaceAll('-', '')}`,
        factor: candidateFactor,
        champion_factor: championFactor,
        universe,
        holding_window: holdingWindow,
        cost_model: costModel,
      },
      required_checks: [
        'oos_segment_performance',
        'champion_challenger_comparison',
        'industry_theme_concentration',
        'liquidity_fields_average_amount_5d_turnover_rate',
        'drawdown_turnover_cost_sensitivity',
        'expanded_explainable_universe',
      ],
      strategy_usability_standard: STOCK_STRATEGY_USABILITY_STANDARD,
      candidate_evaluation: pruneArtifactValue(candidateEvaluation),
      champion_evaluation: pruneArtifactValue(championEvaluation),
      candidate_backtest: pruneArtifactValue(candidateBacktest),
      champion_backtest: pruneArtifactValue(championBacktest),
      liquidity_snapshot: pruneArtifactValue(liquiditySnapshot),
    };
  };
}

function createDesignReviewTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const reportDate = readWorkflowReportDate(input);
    const market = readWorkflowMarket(input, 'hk');
    const universe = readWorkflowUniverse(input);
    const symbols = readWorkflowSymbols(input);
    const factors = readWorkflowFactors(input);
    const forwardWindows = readWorkflowString(
      input,
      'forwardWindows',
      '1,5,10,20',
    );
    const costBps = readWorkflowNumberOrNull(input, 'costBps');
    const costModel = costBps === null ? 'default_cost' : `${costBps}bps`;
    const args = [
      'scripts/alpha_research_loop.py',
      '--market',
      market,
      '--universe',
      universe,
      '--factors',
      factors.join(','),
      '--date',
      reportDate,
      '--forward-windows',
      forwardWindows,
      '--top',
      String(readWorkflowTop(input)),
      '--min-observations',
      String(readWorkflowMinObservations(input)),
      '--min-backtest-periods',
      String(readWorkflowMinBacktestPeriods(input)),
      '--include-attempt-details',
    ];
    if (symbols) args.push('--symbols', symbols);
    appendOptionalNumberArg(args, '--cost-bps', costBps);

    const designEvidence = await runStockApiJsonOrDegraded(
      'alpha_research_loop_design_review',
      args,
      input,
      options,
    );
    return {
      status: artifactStatus(designEvidence) === 'degraded' ? 'degraded' : 'ok',
      source: 'stock_strategy_design_review',
      generatedAt: new Date().toISOString(),
      market,
      report_date: reportDate,
      evidence_signature: evidenceSignature({
        market,
        factor: factors.join('+'),
        universe,
        costModel,
        holdingWindow: forwardWindows,
        dataVersion: reportDate,
      }),
      market_state: {
        market,
        state: 'candidate_review',
        next_state_on_pass: 'candidate_validation',
        next_state_on_fail: 'cooldown',
      },
      design_changes: [
        'forward_window_sensitivity',
        'cost_model_sensitivity',
        'universe_coverage_review',
        'blocked_reason_recheck',
      ],
      strategy_usability_standard: STOCK_STRATEGY_USABILITY_STANDARD,
      design_evidence: pruneArtifactValue(designEvidence),
    };
  };
}

function artifactDataCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!isObject(value)) return 0;
  if (Array.isArray(value.data)) return value.data.length;
  if (Array.isArray(value.items)) return value.items.length;
  const summary = isObject(value.summary) ? value.summary : null;
  const scanned = summary?.scanned;
  return typeof scanned === 'number' && Number.isFinite(scanned) ? scanned : 0;
}

function createCoverageCheckTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const reportDate = readWorkflowReportDate(input);
    const market = readWorkflowMarket(input, 'cn');
    const universe = readWorkflowUniverse(input);
    const universeSeed = readWorkflowString(
      input,
      'universeSeed',
      `${market}_default`,
    );
    const seedStatus = await runStockApiJsonOrDegraded(
      'alpha_universe_seed_status',
      [
        'scripts/alpha_universe_seed_status.py',
        '--universe-seed',
        universeSeed,
        '--market',
        market,
        '--stale-before',
        reportDate,
      ],
      input,
      options,
    );
    const scan = await runStockApiJsonOrDegraded(
      'alpha_scan_coverage_check',
      [
        'scripts/alpha_scan.py',
        '--market',
        market,
        '--universe',
        universe,
        '--top',
        String(readWorkflowTop(input)),
        '--as-of',
        reportDate,
      ],
      input,
      options,
    );
    const degraded =
      artifactStatus(seedStatus) === 'degraded' ||
      artifactStatus(scan) === 'degraded';
    const scanned = artifactDataCount(scan);
    const coverageStatus = scanned > 0 ? 'ready' : 'empty';

    return {
      status: degraded ? 'degraded' : 'ok',
      source: 'stock_strategy_coverage_check',
      generatedAt: new Date().toISOString(),
      market,
      report_date: reportDate,
      evidence_signature: evidenceSignature({
        market,
        factor: 'coverage',
        universe,
        costModel: 'none',
        holdingWindow: 'none',
        dataVersion: reportDate,
      }),
      market_state: {
        market,
        state: 'coverage_check',
        next_state_on_pass: 'discovery',
        next_state_on_fail: 'coverage_check',
      },
      coverage_status: coverageStatus,
      next_action:
        coverageStatus === 'ready' ? 'resume_discovery' : 'keep_coverage_check',
      strategy_usability_standard: STOCK_STRATEGY_USABILITY_STANDARD,
      seed_status: pruneArtifactValue(seedStatus),
      scan: pruneArtifactValue(scan),
    };
  };
}

function createFetchPoolTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const includeClosed = readWorkflowIncludeClosed(input);
    const payload = await runStockApiJson(
      ['scripts/futu_market_data.py', 'ipo-list', '--market', 'HK', '--json'],
      input,
      options,
    );
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const filtered = includeClosed
      ? rows
      : rows.filter((row) => {
          if (!isObject(row)) return false;
          return row.is_subscribe_status !== false;
        });
    return {
      status: 'ok',
      source: payload.source ?? 'futu_opend',
      market: payload.market ?? 'HK',
      includeClosed,
      fetchedAt: new Date().toISOString(),
      rawCount: rows.length,
      filteredCount: filtered.length,
      data: filtered,
    };
  };
}

function createHeatScanTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const reportDate = readWorkflowReportDate(input);
    const includeClosed = readWorkflowIncludeClosed(input);
    const ipos = getArtifactArray(input, 'ipo_pool');
    return withCacheTempDir(
      'hkipo-heat-scan-input',
      async (tempRoot) => {
        const iposPath = path.join(tempRoot, 'ipos.json');
        fs.writeFileSync(iposPath, JSON.stringify(ipos, null, 2));
        const args = [
          'scripts/hkipo_heat_scan.py',
          '--date',
          reportDate,
          '--ipos-json',
          iposPath,
          '--json',
        ];
        if (includeClosed) args.push('--include-closed');
        try {
          return await runStockApiJson(args, input, options, {
            timeoutMs: 300_000,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return buildDegradedHeatScanArtifact(ipos, reportDate, message);
        }
      },
      { cacheRoot: process.env.CLI_CLAW_CACHE_DIR },
    );
  };
}

function createOfficialDocsTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const reportDate = readWorkflowReportDate(input);
    const includeClosed = readWorkflowIncludeClosed(input);
    const ipos = getArtifactArray(input, 'ipo_pool');
    const cacheDir = ensureCacheNamespaceDir('hkipo-official-docs', {
      cacheRoot: process.env.CLI_CLAW_CACHE_DIR,
    });
    return withCacheTempDir(
      'hkipo-official-docs-input',
      async (tempRoot) => {
        const iposPath = path.join(tempRoot, 'ipos.json');
        fs.writeFileSync(iposPath, JSON.stringify(ipos, null, 2));
        const args = [
          'scripts/hkipo_official_docs.py',
          '--date',
          reportDate,
          '--ipos-json',
          iposPath,
          '--cache-dir',
          cacheDir,
          '--json',
        ];
        if (includeClosed) args.push('--include-closed');
        try {
          return await runStockApiJson(args, input, options);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return buildDegradedOfficialDocsArtifact(ipos, reportDate, message);
        }
      },
      { cacheRoot: process.env.CLI_CLAW_CACHE_DIR },
    );
  };
}

function createBacktestTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    try {
      const payload = await runStockSkillJson(
        [
          'scripts/hkipo_backtest.py',
          '--limit',
          '100',
          '--source',
          'aastocks',
          '--format',
          'json',
          '--enrichment-source',
          'xinguyufu',
          '--debut-price-source',
          'listed-table',
        ],
        input,
        options,
      );
      return {
        status: 'ok',
        source: 'hkipo_backtest',
        generatedAt: new Date().toISOString(),
        ...payload,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'degraded',
        source: 'hkipo_backtest',
        reason: message,
        generatedAt: new Date().toISOString(),
      };
    }
  };
}

export function createDefaultWorkflowLocalTasks(
  options: DefaultWorkflowLocalTaskOptions = {},
): WorkflowLocalTaskRegistry {
  return {
    'stock.hkipo.fetch_pool': createFetchPoolTask(options),
    'stock.hkipo.scan_heat': createHeatScanTask(options),
    'stock.hkipo.fetch_official_docs': createOfficialDocsTask(options),
    'stock.hkipo.run_backtest': createBacktestTask(options),
    'stock.strategy.collect_results': createCollectStrategyResultsTask(options),
    'stock.strategy.analyze_value': createAnalyzeStrategyValueTask(options),
    'stock.strategy.discovery_cycle': createDiscoveryCycleTask(options),
    'stock.strategy.candidate_validation':
      createCandidateValidationTask(options),
    'stock.strategy.design_review': createDesignReviewTask(options),
    'stock.strategy.coverage_check': createCoverageCheckTask(options),
  };
}

export function getDefaultWorkflowLocalTaskIds(): string[] {
  return [...DEFAULT_WORKFLOW_LOCAL_TASK_IDS];
}
