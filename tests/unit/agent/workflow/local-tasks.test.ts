import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import { createDefaultWorkflowLocalTasks } from '../../../../src/agent/workflow/local-tasks.ts';

const ENV_KEYS = ['STOCK_ANALYSIS_API_ROOT', 'STOCK_ANALYSIS_UV'] as const;

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
});
