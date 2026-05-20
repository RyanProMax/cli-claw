import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { createDefaultWorkflowLocalTasks } from '../../../../src/agent/workflow/local-tasks.ts';

const ENV_KEYS = [
  'STOCK_ANALYSIS_API_ROOT',
  'STOCK_ANALYSIS_UV',
  'CLI_CLAW_CACHE_DIR',
  'STOCK_STRATEGY_TASK_DB',
] as const;

function writeExecutable(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

describe('default workflow local tasks', () => {
  const tempDirs: string[] = [];
  const previousEnv = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const previous = previousEnv.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
    previousEnv.clear();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('scan_heat returns a degraded artifact when the readonly scanner fails', async () => {
    const apiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-root-'));
    const binRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-bin-'));
    tempDirs.push(apiRoot, binRoot);
    fs.mkdirSync(path.join(apiRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(apiRoot, 'scripts', 'futu_market_data.py'), '');
    fs.writeFileSync(path.join(apiRoot, 'scripts', 'hkipo_heat_scan.py'), '');
    const fakeUv = path.join(binRoot, 'uv');
    writeExecutable(
      fakeUv,
      [
        '#!/usr/bin/env node',
        'process.stderr.write("heat scan source budget exceeded");',
        'process.exit(1);',
      ].join('\n'),
    );
    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    process.env.STOCK_ANALYSIS_API_ROOT = apiRoot;
    process.env.STOCK_ANALYSIS_UV = fakeUv;

    const tasks = createDefaultWorkflowLocalTasks();
    const artifact = await tasks['stock.hkipo.scan_heat']({
      taskId: 'stock.hkipo.scan_heat',
      nodeId: 'heat_data_crawler',
      input: { reportDate: '2026-05-17' },
      artifacts: {
        ipo_pool: {
          data: [{ code: 'HK.01234', name: '示例机器人' }],
        },
      },
    });

    expect(artifact).toMatchObject({
      status: 'degraded',
      source: 'hkipo_heat_scan',
      report_date: '2026-05-17',
      summary: {
        ipo_count: 1,
        same_day_heat_count: 0,
        degraded_count: 1,
      },
      data: [
        {
          code: 'HK.01234',
          name: '示例机器人',
          heat_status: 'heat_threshold_not_met',
          evidence_quality: 'low',
          subscription_heat: {
            status: '热度未达当日核验门槛',
          },
          structure_status: 'core_structure_not_verified',
          valuation_status: 'valuation_context_not_verified',
          structure_evidence: [],
          valuation_evidence: [],
        },
      ],
    });
    expect((artifact as any).data[0].source_errors[0].error).toContain(
      'heat scan source budget exceeded',
    );
  });

  test('fetch_official_docs calls the stock api parser with the shared cache namespace', async () => {
    const apiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-root-'));
    const binRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-bin-'));
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-cache-'));
    tempDirs.push(apiRoot, binRoot, cacheRoot);
    fs.mkdirSync(path.join(apiRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(apiRoot, 'scripts', 'futu_market_data.py'), '');
    fs.writeFileSync(
      path.join(apiRoot, 'scripts', 'hkipo_official_docs.py'),
      '',
    );
    const fakeUv = path.join(binRoot, 'uv');
    writeExecutable(
      fakeUv,
      [
        '#!/usr/bin/env node',
        'const fs = require("fs");',
        'const args = process.argv.slice(2);',
        'const script = args[2];',
        'const cacheDir = args[args.indexOf("--cache-dir") + 1];',
        'const iposPath = args[args.indexOf("--ipos-json") + 1];',
        'if (script !== "scripts/hkipo_official_docs.py") { process.stderr.write(`unexpected script ${script}`); process.exit(2); }',
        'const ipos = JSON.parse(fs.readFileSync(iposPath, "utf8"));',
        'process.stdout.write(JSON.stringify({',
        '  status: "ok",',
        '  source: "hkipo_official_docs",',
        '  cache_dir: cacheDir,',
        '  args,',
        '  data: [{ code: ipos[0].code, name: ipos[0].name, status: "official_docs_parsed", documents: [], structure_evidence: [], valuation_evidence: [], source_errors: [] }],',
        '  summary: { ipo_count: ipos.length, parsed_document_count: 0, degraded_count: 0 }',
        '}));',
      ].join('\n'),
    );
    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    process.env.STOCK_ANALYSIS_API_ROOT = apiRoot;
    process.env.STOCK_ANALYSIS_UV = fakeUv;
    process.env.CLI_CLAW_CACHE_DIR = cacheRoot;

    const tasks = createDefaultWorkflowLocalTasks();
    const artifact = await tasks['stock.hkipo.fetch_official_docs']({
      taskId: 'stock.hkipo.fetch_official_docs',
      nodeId: 'official_doc_crawler',
      input: {
        command: 'hkipo',
        argsText: '--all',
        input: { reportDate: '2026-05-17', includeClosed: true },
      },
      artifacts: {
        ipo_pool: {
          data: [{ code: 'HK.01234', name: '示例智能' }],
        },
      },
    });

    expect(artifact).toMatchObject({
      status: 'ok',
      source: 'hkipo_official_docs',
      data: [{ code: 'HK.01234', status: 'official_docs_parsed' }],
    });
    expect((artifact as any).cache_dir).toBe(
      path.join(cacheRoot, 'hkipo-official-docs'),
    );
    expect((artifact as any).args).toContain('--include-closed');
    expect((artifact as any).args).toContain('2026-05-17');
    expect(fs.existsSync((artifact as any).cache_dir)).toBe(true);
  });

  test('collect_results reads recent stock task-chain state as a summary artifact', async () => {
    const apiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-root-'));
    tempDirs.push(apiRoot);
    fs.mkdirSync(path.join(apiRoot, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(apiRoot, '.cache'), { recursive: true });
    fs.writeFileSync(path.join(apiRoot, 'scripts', 'futu_market_data.py'), '');
    const taskDbPath = path.join(apiRoot, '.cache', 'task_chain.sqlite');
    const db = new Database(taskDbPath);
    try {
      db.exec(`
        CREATE TABLE task_chain_tasks (
          id TEXT PRIMARY KEY,
          task_type TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 100,
          due_at TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          parent_task_id TEXT,
          lease_owner TEXT,
          lease_expires_at TEXT,
          result_json TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE task_chain_summaries (
          id TEXT PRIMARY KEY,
          summary_type TEXT NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          summary_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE task_chain_agent_handoff_outputs (
          id TEXT PRIMARY KEY,
          handoff_id TEXT NOT NULL,
          output_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      db.prepare(
        `INSERT INTO task_chain_tasks (id, task_type, status, due_at, result_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'task-1',
        'strategy_analysis',
        'completed',
        '2026-05-20T12:00:00Z',
        JSON.stringify({ summary: { human_review_ready: 1 } }),
        '2026-05-20T12:00:00Z',
        '2026-05-20T12:01:00Z',
      );
      db.prepare(
        `INSERT INTO task_chain_summaries (id, summary_type, period_start, period_end, summary_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        'summary-1',
        'daily',
        '2026-05-20T00:00:00Z',
        '2026-05-20T12:00:00Z',
        JSON.stringify({ summary: { tasks_total: 5 } }),
        '2026-05-20T12:02:00Z',
      );
      db.prepare(
        `INSERT INTO task_chain_agent_handoff_outputs (id, handoff_id, output_json, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(
        'output-1',
        'handoff-1',
        JSON.stringify({ summary: 'KOL evidence completed' }),
        '2026-05-20T12:03:00Z',
      );
    } finally {
      db.close();
    }

    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    process.env.STOCK_ANALYSIS_API_ROOT = apiRoot;

    const tasks = createDefaultWorkflowLocalTasks();
    const artifact = await tasks['stock.strategy.collect_results']({
      taskId: 'stock.strategy.collect_results',
      nodeId: 'collect_results',
      input: { maxTasks: 5 },
      artifacts: {},
    });

    expect(artifact).toMatchObject({
      status: 'ok',
      source: 'stock_strategy_collect_results',
      task_chain: {
        latest_tasks: [
          {
            id: 'task-1',
            task_type: 'strategy_analysis',
            status: 'completed',
            result: { summary: { human_review_ready: 1 } },
          },
        ],
        latest_summaries: [
          {
            id: 'summary-1',
            summary_type: 'daily',
            summary: { summary: { tasks_total: 5 } },
          },
        ],
        latest_handoff_outputs: [
          {
            id: 'output-1',
            handoff_id: 'handoff-1',
            output: { summary: 'KOL evidence completed' },
          },
        ],
      },
    });
  });

  test('analyze_value returns degraded sub-results instead of failing the workflow', async () => {
    const apiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-root-'));
    const binRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-bin-'));
    tempDirs.push(apiRoot, binRoot);
    fs.mkdirSync(path.join(apiRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(apiRoot, 'scripts', 'futu_market_data.py'), '');
    fs.writeFileSync(
      path.join(apiRoot, 'scripts', 'trading_daily_summary.py'),
      '',
    );
    fs.writeFileSync(
      path.join(apiRoot, 'scripts', 'alpha_daily_report.py'),
      '',
    );
    const fakeUv = path.join(binRoot, 'uv');
    writeExecutable(
      fakeUv,
      [
        '#!/usr/bin/env node',
        'const args = process.argv.slice(2);',
        'const script = args[2];',
        'if (script === "scripts/trading_daily_summary.py") {',
        '  process.stdout.write(JSON.stringify({ status: "ok", report_type: "trading_daily_summary" }));',
        '} else if (script === "scripts/alpha_daily_report.py") {',
        '  const market = args[args.indexOf("--market") + 1];',
        '  if (market === "us") { process.stderr.write("not enough mature samples"); process.exit(1); }',
        '  process.stdout.write(JSON.stringify({ status: "ok", report_type: "alpha_daily_report", market, alpha_backtest_summary: { total_return: 0.12 } }));',
        '} else {',
        '  process.stderr.write(`unexpected script ${script}`);',
        '  process.exit(2);',
        '}',
      ].join('\n'),
    );
    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    process.env.STOCK_ANALYSIS_API_ROOT = apiRoot;
    process.env.STOCK_ANALYSIS_UV = fakeUv;

    const tasks = createDefaultWorkflowLocalTasks();
    const artifact = await tasks['stock.strategy.analyze_value']({
      taskId: 'stock.strategy.analyze_value',
      nodeId: 'analyze_value',
      input: { reportDate: '2026-05-20', markets: ['hk', 'us'] },
      artifacts: {},
    });

    expect(artifact).toMatchObject({
      status: 'degraded',
      source: 'stock_strategy_analyze_value',
      trading_daily_summary: {
        status: 'ok',
        report_type: 'trading_daily_summary',
      },
      alpha_daily_reports: [
        {
          market: 'hk',
          status: 'ok',
          report_type: 'alpha_daily_report',
          alpha_backtest_summary: { total_return: 0.12 },
        },
        {
          market: 'us',
          status: 'degraded',
          reason: expect.stringContaining('not enough mature samples'),
        },
      ],
    });
  });

  test('discovery_cycle runs alpha scan and research loop while preserving degraded market results', async () => {
    const apiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-root-'));
    const binRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-bin-'));
    tempDirs.push(apiRoot, binRoot);
    fs.mkdirSync(path.join(apiRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(apiRoot, 'scripts', 'futu_market_data.py'), '');
    fs.writeFileSync(path.join(apiRoot, 'scripts', 'alpha_scan.py'), '');
    fs.writeFileSync(
      path.join(apiRoot, 'scripts', 'alpha_research_loop.py'),
      '',
    );
    const fakeUv = path.join(binRoot, 'uv');
    writeExecutable(
      fakeUv,
      [
        '#!/usr/bin/env node',
        'const args = process.argv.slice(2);',
        'const script = args[2];',
        'const market = args[args.indexOf("--market") + 1];',
        'if (script === "scripts/alpha_scan.py") {',
        '  process.stdout.write(JSON.stringify({ status: "ok", source: "alpha_scan", market, items: [{ symbol: `${market}.00001`, score: 0.9 }] }));',
        '} else if (script === "scripts/alpha_research_loop.py") {',
        '  if (market === "us") { process.stderr.write("insufficient_oos_samples"); process.exit(1); }',
        '  process.stdout.write(JSON.stringify({ status: "ok", source: "alpha_research_loop", market, selected_factor: "momentum_20d", verdict: { gate_status: "blocked" } }));',
        '} else {',
        '  process.stderr.write(`unexpected script ${script}`);',
        '  process.exit(2);',
        '}',
      ].join('\n'),
    );
    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    process.env.STOCK_ANALYSIS_API_ROOT = apiRoot;
    process.env.STOCK_ANALYSIS_UV = fakeUv;

    const tasks = createDefaultWorkflowLocalTasks();
    const artifact = await tasks['stock.strategy.discovery_cycle']({
      taskId: 'stock.strategy.discovery_cycle',
      nodeId: 'discover_candidates',
      input: {
        reportDate: '2026-05-20',
        factors: ['momentum_20d', 'volume_change_5d'],
        top: 15,
      },
      artifacts: {},
    });

    expect(artifact).toMatchObject({
      status: 'degraded',
      source: 'stock_strategy_discovery_cycle',
      cadence: 'discovery',
      report_date: '2026-05-20',
      constraints: expect.arrayContaining([
        'no_broker_or_order_side_effects',
        'no_auto_approve',
        'no_auto_activate',
      ]),
      request: {
        markets: ['cn', 'hk', 'us'],
      },
      markets: [
        {
          market: 'cn',
          scan: {
            status: 'ok',
            source: 'alpha_scan',
            items: [{ symbol: 'cn.00001', score: 0.9 }],
          },
          research_loop: {
            status: 'ok',
            source: 'alpha_research_loop',
            selected_factor: 'momentum_20d',
          },
        },
        {
          market: 'hk',
          scan: {
            status: 'ok',
            source: 'alpha_scan',
            items: [{ symbol: 'hk.00001', score: 0.9 }],
          },
          research_loop: {
            status: 'ok',
            source: 'alpha_research_loop',
            selected_factor: 'momentum_20d',
          },
        },
        {
          market: 'us',
          scan: { status: 'ok', source: 'alpha_scan' },
          research_loop: {
            status: 'degraded',
            reason: expect.stringContaining('insufficient_oos_samples'),
          },
        },
      ],
    });
  });
});
