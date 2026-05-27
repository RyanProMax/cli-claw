import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import { createDefaultWorkflowLocalTasks } from '../../../../src/agent/workflow/local-tasks.ts';

const ENV_KEYS = [
  'STOCK_ANALYSIS_API_ROOT',
  'STOCK_ANALYSIS_UV',
  'CLI_CLAW_CACHE_DIR',
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

  test('does not register retired stock strategy local tasks', () => {
    const tasks = createDefaultWorkflowLocalTasks();

    expect(
      Object.keys(tasks).filter((taskId) => taskId.startsWith('stock.strategy.')),
    ).toEqual([]);
  });

});
