import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { APP_ROOT } from '../../core/app-root.js';
import { ensureCacheNamespaceDir, withCacheTempDir } from '../../core/cache.js';
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
  };
}

export function getDefaultWorkflowLocalTaskIds(): string[] {
  return [...DEFAULT_WORKFLOW_LOCAL_TASK_IDS];
}
