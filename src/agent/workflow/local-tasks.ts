import { execFile } from 'child_process';
import { createHash } from 'crypto';
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
  kolContextCache?: {
    minDays?: number;
    ttlMs?: number;
    maxEntries?: number;
    now?: () => number;
  };
}

interface KolContextCacheConfig {
  minDays: number;
  ttlMs: number;
  maxEntries: number;
  now: () => number;
}

interface KolContextCacheEntry {
  artifact: Record<string, unknown>;
  cachedAtMs: number;
  expiresAtMs: number;
  lastAccessedAtMs: number;
}

const KOL_CONTEXT_CACHE_MIN_DAYS = 30;
const KOL_CONTEXT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const KOL_CONTEXT_CACHE_MAX_ENTRIES = 16;
const kolContextCache = new Map<string, KolContextCacheEntry>();

function agentFabricCacheRootFromEnv(): string | undefined {
  return process.env.AGENT_FABRIC_CACHE_DIR;
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

function cloneJsonObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
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

function resolveStockKolIntelRoot(options: {
  workspaceRoot?: string;
  executionCwd?: string;
}): string {
  const candidates = [
    process.env.STOCK_KOL_INTEL_ROOT,
    options.workspaceRoot
      ? path.join(options.workspaceRoot, '..', 'stock-kol-intel')
      : null,
    options.executionCwd
      ? path.join(options.executionCwd, '..', 'stock-kol-intel')
      : null,
    path.join(APP_ROOT, '..', 'stock-kol-intel'),
    path.join(APP_ROOT, '..', '..', 'stock-kol-intel'),
    path.join(os.homedir(), 'projects', 'stock-kol-intel'),
    path.join(os.homedir(), 'stock-kol-intel'),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (
      fs.existsSync(path.join(resolved, 'commands', 'kol.py')) &&
      fs.existsSync(path.join(resolved, 'references', 'kol_whitelist.json'))
    ) {
      return resolved;
    }
  }
  throw new Error(
    '未找到 stock-kol-intel 仓库或 references/kol_whitelist.json',
  );
}

function resolveStockKolPythonExecutable(root: string): string {
  const venvCandidates =
    process.platform === 'win32'
      ? [
          path.join(root, '.venv', 'Scripts', 'python.exe'),
          path.join(root, '.venv', 'Scripts', 'python'),
        ]
      : [path.join(root, '.venv', 'bin', 'python')];
  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const envName of ['STOCK_KOL_INTEL_PYTHON', 'PYTHON_BIN']) {
    const resolved = findExecutable(process.env[envName] ?? '');
    if (resolved) return resolved;
  }
  for (const candidate of ['python3', 'python']) {
    const resolved = findExecutable(candidate);
    if (resolved) return resolved;
  }
  throw new Error('未找到 python，可设置 STOCK_KOL_INTEL_PYTHON / PYTHON_BIN');
}

async function runStockKolContextJson(
  days: number,
  input: WorkflowLocalTaskInput,
  options: DefaultWorkflowLocalTaskOptions,
): Promise<Record<string, unknown>> {
  const skillRoot = resolveStockKolIntelRoot({
    workspaceRoot: options.workspaceRoot,
    executionCwd: input.executionCwd,
  });
  const python = resolveStockKolPythonExecutable(skillRoot);
  const helper = [
    'import importlib.util',
    'import json',
    'import pathlib',
    'import sys',
    'root = pathlib.Path(sys.argv[1])',
    'days = int(sys.argv[2])',
    'module_path = root / "commands" / "kol.py"',
    'spec = importlib.util.spec_from_file_location("stock_kol_workflow_kol", module_path)',
    'module = importlib.util.module_from_spec(spec)',
    'assert spec.loader is not None',
    'spec.loader.exec_module(module)',
    'whitelist = module.load_whitelist() if hasattr(module, "load_whitelist") else json.loads((root / "references" / "kol_whitelist.json").read_text(encoding="utf-8"))',
    'if hasattr(module, "build_x_source_preflight"):',
    '    x_preflight = module.build_x_source_preflight(days, whitelist)',
    'else:',
    '    x_preflight = {"source": "twscrape", "status": "unavailable", "reason": "stock-kol-intel command does not expose build_x_source_preflight", "results": []}',
    'print(json.dumps({"whitelist": whitelist, "x_preflight": x_preflight}, ensure_ascii=False))',
  ].join('\n');

  const { stdout, stderr } = await execFileAsync(
    python,
    ['-c', helper, skillRoot, String(days)],
    {
      cwd: skillRoot,
      timeout: 180_000,
      maxBuffer: JSON_BUFFER_BYTES,
      env: {
        ...process.env,
        AGENT_FABRIC_SKILL_DIR: skillRoot,
      },
    },
  );
  const raw = stdout.trim();
  if (!raw) {
    throw new Error(
      stderr.trim() || 'stock-kol-intel context preflight 无输出',
    );
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) throw new Error('payload is not an object');
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`stock-kol-intel JSON 解析失败：${message}`);
  }
}

interface CoveredKol {
  id: string;
  display_name: string;
  handle?: string;
  x_url?: string;
  focus?: string[];
}

function getStringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getStringArrayValue(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractXHandle(urlValue: string): string {
  try {
    const parsed = new URL(urlValue);
    const host = parsed.hostname.toLowerCase();
    if (
      host !== 'x.com' &&
      host !== 'twitter.com' &&
      !host.endsWith('.x.com') &&
      !host.endsWith('.twitter.com')
    ) {
      return '';
    }
    const handle = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    if (!handle || ['i', 'intent', 'share', 'search'].includes(handle)) {
      return '';
    }
    return handle.replace(/^@/, '');
  } catch {
    return '';
  }
}

function findKolXLink(kol: Record<string, unknown>): {
  url: string;
  handle: string;
} | null {
  const links = [
    ...(Array.isArray(kol.primary_links) ? kol.primary_links : []),
    ...(Array.isArray(kol.candidate_links) ? kol.candidate_links : []),
  ];
  for (const link of links) {
    if (!isObject(link)) continue;
    const url = getStringValue(link, 'url');
    if (!url) continue;
    const platform = getStringValue(link, 'platform').toLowerCase();
    const handle = extractXHandle(url);
    if (handle || platform.includes('twitter') || platform === 'x') {
      return { url, handle };
    }
  }
  return null;
}

function buildCoveredKols(whitelist: Record<string, unknown>): CoveredKol[] {
  const kols = Array.isArray(whitelist.kols) ? whitelist.kols : [];
  return kols
    .filter(isObject)
    .map((kol) => {
      const id = getStringValue(kol, 'id');
      const displayName = getStringValue(kol, 'display_name') || id;
      const xLink = findKolXLink(kol);
      const fallbackHandle = id.replace(/^@/, '');
      return {
        id,
        display_name: displayName || fallbackHandle,
        handle: xLink?.handle || fallbackHandle || undefined,
        x_url: xLink?.url,
        focus: getStringArrayValue(kol, 'focus'),
      };
    })
    .filter((kol) => kol.id || kol.display_name || kol.handle);
}

function formatCoveredKol(kol: CoveredKol): string {
  const name = kol.display_name || kol.id || kol.handle || 'unknown';
  return kol.handle ? `${name}（@${kol.handle}）` : name;
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

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value !== 'string') return null;
  if (!/^\d+$/.test(value.trim())) return null;
  return Number.parseInt(value.trim(), 10);
}

function readWorkflowKolDays(input: WorkflowLocalTaskInput): number {
  const taskInput = resolveWorkflowTaskInput(input);
  const direct = parsePositiveInteger(taskInput.days);
  if (direct !== null) {
    if (direct < 1 || direct > 365) {
      throw new Error(`kol days must be between 1 and 365, got ${direct}`);
    }
    return direct;
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const promptMatch = prompt.match(/(?:^|\s)--days(?:=|\s+)(\d+)(?:\s|$)/);
  if (promptMatch) {
    const days = Number.parseInt(promptMatch[1], 10);
    if (days < 1 || days > 365) {
      throw new Error(`kol days must be between 1 and 365, got ${days}`);
    }
    return days;
  }

  return 30;
}

function resolveKolContextCacheConfig(
  options: DefaultWorkflowLocalTaskOptions,
): KolContextCacheConfig {
  return {
    minDays: options.kolContextCache?.minDays ?? KOL_CONTEXT_CACHE_MIN_DAYS,
    ttlMs: options.kolContextCache?.ttlMs ?? KOL_CONTEXT_CACHE_TTL_MS,
    maxEntries:
      options.kolContextCache?.maxEntries ?? KOL_CONTEXT_CACHE_MAX_ENTRIES,
    now: options.kolContextCache?.now ?? (() => Date.now()),
  };
}

function hashFileIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) return 'missing';
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function buildKolContextCacheKey(skillRoot: string, days: number): string {
  const payload = JSON.stringify({
    skillRoot,
    days,
    whitelistHash: hashFileIfExists(
      path.join(skillRoot, 'references', 'kol_whitelist.json'),
    ),
    commandHash: hashFileIfExists(path.join(skillRoot, 'commands', 'kol.py')),
    twscrapeDbPath: process.env.TWSCRAPE_DB_PATH ?? '',
    twscrapeProxy: process.env.TWSCRAPE_PROXY ?? '',
    httpsProxy: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '',
    allProxy: process.env.ALL_PROXY ?? process.env.all_proxy ?? '',
  });
  return createHash('sha256').update(payload).digest('hex');
}

function pruneKolContextCache(
  config: KolContextCacheConfig,
  now: number,
): void {
  for (const [key, entry] of kolContextCache.entries()) {
    if (entry.expiresAtMs <= now) {
      kolContextCache.delete(key);
    }
  }

  while (kolContextCache.size > config.maxEntries) {
    let oldestKey = '';
    let oldestAccess = Number.POSITIVE_INFINITY;
    for (const [key, entry] of kolContextCache.entries()) {
      if (entry.lastAccessedAtMs < oldestAccess) {
        oldestKey = key;
        oldestAccess = entry.lastAccessedAtMs;
      }
    }
    if (!oldestKey) break;
    kolContextCache.delete(oldestKey);
  }
}

function formatCacheIso(ms: number): string {
  return new Date(ms).toISOString();
}

function kolCacheMetadata(
  status: 'disabled' | 'hit' | 'miss',
  config: KolContextCacheConfig,
  now: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    scope: 'memory',
    status,
    cacheable: status !== 'disabled',
    min_days: config.minDays,
    ttl_seconds: Math.floor(config.ttlMs / 1_000),
    max_entries: config.maxEntries,
    served_at: formatCacheIso(now),
    ...extra,
  };
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
      { cacheRoot: agentFabricCacheRootFromEnv() },
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
      cacheRoot: agentFabricCacheRootFromEnv(),
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
      { cacheRoot: agentFabricCacheRootFromEnv() },
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

function buildKolPrepareContextArtifact(
  days: number,
  payload: Record<string, unknown>,
  cache: Record<string, unknown>,
): Record<string, unknown> {
  const whitelist = isObject(payload.whitelist) ? payload.whitelist : {};
  const xPreflight = isObject(payload.x_preflight)
    ? payload.x_preflight
    : {
        source: 'twscrape',
        status: 'unavailable',
        reason: 'stock-kol-intel did not return x_preflight',
        results: [],
      };
  const coveredKols = buildCoveredKols(whitelist);
  const coveredKolSummary =
    coveredKols.map(formatCoveredKol).join('、') || '未解析到白名单 KOL 名称';
  return {
    status: 'ok',
    source: 'stock-kol-intel',
    generatedAt: new Date().toISOString(),
    window_days: days,
    cache,
    whitelist,
    covered_kols: coveredKols,
    covered_kol_summary: coveredKolSummary,
    x_preflight: xPreflight,
    report_requirements: [
      '只使用白名单 KOL，不临时扩展范围',
      '覆盖 KOL 必须用一行输出为“覆盖 KOL（数量）：display_name（@handle）列表”，不能拆成数量和名单两行，也不能只写数量',
      '结论/总结必须放在消息顶部',
      '结论/总结、近期投资方向和每个编号主题之间必须用 --- 分隔',
      '每个 emoji 字段块之间不插入空行',
      '每个编号主题之间必须至少保留一个空行，下一条主题标题不能紧贴上一条来源列表',
      '结论/总结和下一步重点核验必须拆成编号列表，不要把多个判断塞进同一个长段落',
      '来源标题格式必须为“原文标题 [YYYY-MM-DD]”，不能保留旧版来源后缀',
      '按主题/共识合并',
      '按主题/共识合并，最多输出 3 个高信号投资主题，不用泛泛宏观情绪或“继续观察”补数',
      '每个要点字段必须使用 emoji + 粗体标签，例如 🧭 **核心论点**：',
      '作者原文链接',
      '每个主题必须包含观点摘要、关联行业/代表标的、可跟踪方向',
      '行业现状和未来叙事只有在来源给出具体事实时才写',
      '每个主题必须包含核心论点、可跟踪方向、作者原文链接',
      '作者原文链接放在来源行；原站不可访问时明确标注',
      '可跟踪方向必须落到股票/ETF/行业链，不写笼统事件',
      '删除免责声明、流程说明和没有证据增量的套话',
      '剔除弱证据、营销帖、玩笑帖、纯转推和无法核验内容',
      '区分 KOL 观点、可核验事实和推断，不输出买卖建议',
      '不要输出缓存状态、抓取过程、测试过程或内部实现细节',
      '不要输出固定的账号/来源置信段落',
      '只有来源存疑、低置信或不可访问时才输出来源提醒',
    ],
    output_template: [
      '**KOL 情报报告｜<主题池或默认白名单>**',
      `窗口：最近 ${days} 天`,
      `覆盖 KOL（${coveredKols.length}）：${coveredKolSummary}`,
      '高信号主题：<最多 3 个主题，用顿号分隔>',
      '',
      '🧾 **结论/总结**',
      '1. <最高置信共识一，用完整短句说明>',
      '2. <最高置信共识二，用完整短句说明>',
      '3. <可跟踪股票方向或行业链变化>',
      '',
      '🔍 **下一步重点核验**',
      '1. <核验点一>',
      '2. <核验点二>',
      '3. <核验点三>',
      '',
      '---',
      '',
      '**近期投资方向与高信号内容**',
      '',
      '**1. <主题>：<整合后的核心判断>**',
      '🧭 **核心论点**：<合并多个 KOL 的共识、分歧和高置信证据>',
      '📝 **观点摘要**：',
      '- **事实**：<可核验事实>',
      '- **推断**：<由事实延伸出的市场叙事或风险>',
      '🏷️ **关联行业/代表标的**：<行业链 + 典型股票/ETF>',
      '🎯 **可跟踪方向**：<股票投资方向 + 典型标的/ETF>',
      '🔗 **来源**：',
      '- <作者>：[<原文标题>](<原文链接>) [YYYY-MM-DD]',
      '---',
      '**2. <主题>：<整合后的核心判断>**',
      '<按同样字段结构继续；主题之间必须用 --- 分隔>',
      '',
      '**来源提醒（仅当有存疑内容时输出）**',
      '- <只列来源不可访问、低置信、账号失败、镜像/缓存来源等需要提醒的事项；没有则整段省略>',
    ].join('\n'),
  };
}

function createKolPrepareContextTask(
  options: DefaultWorkflowLocalTaskOptions,
): WorkflowLocalTask {
  return async (input) => {
    const days = readWorkflowKolDays(input);
    const cacheConfig = resolveKolContextCacheConfig(options);
    const now = cacheConfig.now();
    pruneKolContextCache(cacheConfig, now);

    if (
      days < cacheConfig.minDays ||
      cacheConfig.ttlMs <= 0 ||
      cacheConfig.maxEntries <= 0
    ) {
      const payload = await runStockKolContextJson(days, input, options);
      return buildKolPrepareContextArtifact(
        days,
        payload,
        kolCacheMetadata('disabled', cacheConfig, now, {
          reason: 'short_window_or_cache_disabled',
        }),
      );
    }

    const skillRoot = resolveStockKolIntelRoot({
      workspaceRoot: options.workspaceRoot,
      executionCwd: input.executionCwd,
    });
    const cacheKey = buildKolContextCacheKey(skillRoot, days);
    const existing = kolContextCache.get(cacheKey);
    if (existing && existing.expiresAtMs > now) {
      existing.lastAccessedAtMs = now;
      return {
        ...cloneJsonObject(existing.artifact),
        generatedAt: new Date().toISOString(),
        cache: kolCacheMetadata('hit', cacheConfig, now, {
          key: cacheKey,
          cached_at: formatCacheIso(existing.cachedAtMs),
          expires_at: formatCacheIso(existing.expiresAtMs),
        }),
      };
    }
    if (existing) {
      kolContextCache.delete(cacheKey);
    }

    const payload = await runStockKolContextJson(days, input, options);
    const artifact = buildKolPrepareContextArtifact(
      days,
      payload,
      kolCacheMetadata('miss', cacheConfig, now, {
        key: cacheKey,
        cached_at: formatCacheIso(now),
        expires_at: formatCacheIso(now + cacheConfig.ttlMs),
      }),
    );
    kolContextCache.set(cacheKey, {
      artifact: cloneJsonObject({ ...artifact, cache: undefined }),
      cachedAtMs: now,
      expiresAtMs: now + cacheConfig.ttlMs,
      lastAccessedAtMs: now,
    });
    pruneKolContextCache(cacheConfig, now);
    return artifact;
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
    'stock.kol.prepare_context': createKolPrepareContextTask(options),
  };
}

export function getDefaultWorkflowLocalTaskIds(): string[] {
  return [...DEFAULT_WORKFLOW_LOCAL_TASK_IDS];
}
