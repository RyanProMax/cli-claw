import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import { createDefaultWorkflowLocalTasks } from '../../../../src/agent/workflow/local-tasks.ts';

const ENV_KEYS = [
  'STOCK_ANALYSIS_API_ROOT',
  'STOCK_ANALYSIS_UV',
  'STOCK_KOL_INTEL_ROOT',
  'AGENT_FABRIC_CACHE_DIR',
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

  test('prepare_context builds a structured KOL artifact from the stock-kol-intel whitelist and X preflight', async () => {
    const stockKolRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stock-kol-root-'),
    );
    tempDirs.push(stockKolRoot);
    fs.mkdirSync(path.join(stockKolRoot, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(stockKolRoot, 'references'), { recursive: true });
    fs.writeFileSync(
      path.join(stockKolRoot, 'references', 'kol_whitelist.json'),
      JSON.stringify(
        {
          version: 1,
          authoritative_sources: [
            {
              id: 'content',
              platforms: ['X/Twitter', 'official blog'],
            },
          ],
          kols: [
            {
              id: 'sample',
              display_name: 'Sample KOL',
              primary_links: [
                {
                  platform: 'X/Twitter',
                  url: 'https://x.com/sample',
                  confidence: 'confirmed',
                },
              ],
            },
            {
              id: 'second',
              display_name: 'Second Voice',
              primary_links: [
                {
                  platform: 'X/Twitter',
                  url: 'https://x.com/secondvoice',
                  confidence: 'strong',
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(stockKolRoot, 'commands', 'kol.py'),
      [
        'import json',
        'from pathlib import Path',
        '',
        'def load_whitelist():',
        '    return json.loads((Path(__file__).resolve().parents[1] / "references" / "kol_whitelist.json").read_text(encoding="utf-8"))',
        '',
        'def build_x_source_preflight(days, whitelist):',
        '    return {',
        '        "source": "twscrape",',
        '        "status": "ok",',
        '        "window_days": days,',
        '        "results": [{',
        '            "kol_id": whitelist["kols"][0]["id"],',
        '            "status": "ok",',
        '            "posts": [{"url": "https://x.com/sample/status/1", "text": "AI capex signal"}],',
        '        }],',
        '    }',
      ].join('\n'),
    );

    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    process.env.STOCK_KOL_INTEL_ROOT = stockKolRoot;

    const tasks = createDefaultWorkflowLocalTasks();
    const artifact = await tasks['stock.kol.prepare_context']({
      taskId: 'stock.kol.prepare_context',
      nodeId: 'kol_context_preflight',
      input: { command: 'kol', argsText: '--days=7', input: { days: 7 } },
      artifacts: {},
    });

    expect(artifact).toMatchObject({
      status: 'ok',
      source: 'stock-kol-intel',
      window_days: 7,
      whitelist: {
        kols: [
          { id: 'sample', display_name: 'Sample KOL' },
          { id: 'second', display_name: 'Second Voice' },
        ],
      },
      covered_kols: [
        {
          id: 'sample',
          display_name: 'Sample KOL',
          handle: 'sample',
          x_url: 'https://x.com/sample',
        },
        {
          id: 'second',
          display_name: 'Second Voice',
          handle: 'secondvoice',
          x_url: 'https://x.com/secondvoice',
        },
      ],
      covered_kol_summary:
        'Sample KOL（@sample）、Second Voice（@secondvoice）',
      x_preflight: {
        source: 'twscrape',
        status: 'ok',
        window_days: 7,
        results: [
          {
            kol_id: 'sample',
            posts: [{ url: 'https://x.com/sample/status/1' }],
          },
        ],
      },
    });
    expect((artifact as any).report_requirements).toContain('按主题/共识合并');
    expect((artifact as any).report_requirements).toContain('作者原文链接');
    expect((artifact as any).report_requirements).toContain(
      '结论/总结必须放在消息顶部',
    );
    expect((artifact as any).report_requirements).toContain(
      '结论/总结、近期投资方向和每个编号主题之间必须用 --- 分隔',
    );
    expect((artifact as any).report_requirements).toContain(
      '每个 emoji 字段块之间不插入空行',
    );
    expect((artifact as any).report_requirements).toContain(
      '来源标题格式必须为“原文标题 [YYYY-MM-DD]”，不能保留旧版来源后缀',
    );
    expect((artifact as any).report_requirements).toContain(
      '只有来源存疑、低置信或不可访问时才输出来源提醒',
    );
    expect((artifact as any).report_requirements).not.toContain('证据口径');
    expect((artifact as any).report_requirements).not.toContain(
      '账号与来源可信度',
    );
    expect((artifact as any).output_template).toContain(
      '覆盖 KOL（2）：Sample KOL（@sample）、Second Voice（@secondvoice）',
    );
    expect((artifact as any).output_template).not.toContain('覆盖：2 位 KOL');
    expect((artifact as any).output_template).toContain('🧾 **结论/总结**');
    expect((artifact as any).output_template).toContain(
      '🔍 **下一步重点核验**',
    );
    expect((artifact as any).output_template).toContain('🧭 **核心论点**');
    expect((artifact as any).output_template).toContain('📝 **观点摘要**');
    expect((artifact as any).output_template).toContain('🔗 **来源**');
    expect((artifact as any).output_template).toContain(
      '🧾 **结论/总结**\n1. <最高置信共识一，用完整短句说明>\n2. <最高置信共识二，用完整短句说明>\n3. <可跟踪股票方向或行业链变化>\n\n🔍 **下一步重点核验**',
    );
    expect((artifact as any).output_template).toContain(
      '- <作者>：[<原文标题>](<原文链接>) [YYYY-MM-DD]\n---\n**2. <主题>：<整合后的核心判断>**',
    );
    expect((artifact as any).output_template).not.toContain('证据口径');
    expect((artifact as any).output_template).not.toContain('| x');
    expect((artifact as any).output_template).not.toContain('账号与来源可信度');
    expect((artifact as any).output_template).toContain(
      '🧭 **核心论点**：<合并多个 KOL 的共识、分歧和高置信证据>\n📝 **观点摘要**：',
    );
    expect((artifact as any).output_template).toContain(
      '- **推断**：<由事实延伸出的市场叙事或风险>\n🏷️ **关联行业/代表标的**',
    );
    expect(
      (artifact as any).output_template.indexOf('🧾 **结论/总结**'),
    ).toBeLessThan(
      (artifact as any).output_template.indexOf('**近期投资方向与高信号内容**'),
    );
  });

  test('prepare_context reuses in-memory cache for long KOL windows', async () => {
    const stockKolRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stock-kol-cache-root-'),
    );
    tempDirs.push(stockKolRoot);
    fs.mkdirSync(path.join(stockKolRoot, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(stockKolRoot, 'references'), { recursive: true });
    const counterPath = path.join(stockKolRoot, 'counter.txt');
    fs.writeFileSync(
      path.join(stockKolRoot, 'references', 'kol_whitelist.json'),
      JSON.stringify({
        version: 1,
        kols: [
          {
            id: 'sample',
            display_name: 'Sample KOL',
            primary_links: [
              { platform: 'X/Twitter', url: 'https://x.com/sample' },
            ],
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(stockKolRoot, 'commands', 'kol.py'),
      [
        'import json',
        'import sys',
        'from pathlib import Path',
        '',
        'COUNTER = Path(__file__).resolve().parents[1] / "counter.txt"',
        '',
        'def load_whitelist():',
        '    return json.loads((Path(__file__).resolve().parents[1] / "references" / "kol_whitelist.json").read_text(encoding="utf-8"))',
        '',
        'def build_x_source_preflight(days, whitelist):',
        '    count = int(COUNTER.read_text(encoding="utf-8") or "0") + 1 if COUNTER.exists() else 1',
        '    COUNTER.write_text(str(count), encoding="utf-8")',
        '    return {',
        '        "source": "twscrape",',
        '        "status": "ok",',
        '        "window_days": days,',
        '        "results": [{',
        '            "kol_id": "sample",',
        '            "status": "ok",',
        '            "posts": [{"url": "https://x.com/sample/status/1", "text": f"fetch {count}"}],',
        '        }],',
        '    }',
      ].join('\n'),
    );

    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    process.env.STOCK_KOL_INTEL_ROOT = stockKolRoot;

    const tasks = createDefaultWorkflowLocalTasks({
      kolContextCache: {
        minDays: 30,
        ttlMs: 60_000,
        maxEntries: 4,
        now: () => 1_000,
      },
    } as any);
    const input = {
      taskId: 'stock.kol.prepare_context',
      nodeId: 'kol_context_preflight',
      input: { command: 'kol', argsText: '', input: { days: 30 } },
      artifacts: {},
    };

    const first = await tasks['stock.kol.prepare_context'](input);
    const second = await tasks['stock.kol.prepare_context'](input);

    expect(fs.readFileSync(counterPath, 'utf-8')).toBe('1');
    expect((first as any).cache).toMatchObject({
      scope: 'memory',
      status: 'miss',
      cacheable: true,
    });
    expect((second as any).cache).toMatchObject({
      scope: 'memory',
      status: 'hit',
      cacheable: true,
    });
    expect((second as any).x_preflight.results[0].posts[0].text).toBe(
      'fetch 1',
    );
  });

  test('prepare_context does not cache short KOL windows', async () => {
    const stockKolRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stock-kol-short-root-'),
    );
    tempDirs.push(stockKolRoot);
    fs.mkdirSync(path.join(stockKolRoot, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(stockKolRoot, 'references'), { recursive: true });
    const counterPath = path.join(stockKolRoot, 'counter.txt');
    fs.writeFileSync(
      path.join(stockKolRoot, 'references', 'kol_whitelist.json'),
      JSON.stringify({
        version: 1,
        kols: [
          {
            id: 'sample',
            display_name: 'Sample KOL',
            primary_links: [
              { platform: 'X/Twitter', url: 'https://x.com/sample' },
            ],
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(stockKolRoot, 'commands', 'kol.py'),
      [
        'import json',
        'from pathlib import Path',
        'COUNTER = Path(__file__).resolve().parents[1] / "counter.txt"',
        'def load_whitelist():',
        '    return json.loads((Path(__file__).resolve().parents[1] / "references" / "kol_whitelist.json").read_text(encoding="utf-8"))',
        'def build_x_source_preflight(days, whitelist):',
        '    count = int(COUNTER.read_text(encoding="utf-8") or "0") + 1 if COUNTER.exists() else 1',
        '    COUNTER.write_text(str(count), encoding="utf-8")',
        '    return {"source": "twscrape", "status": "ok", "window_days": days, "results": []}',
      ].join('\n'),
    );

    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    process.env.STOCK_KOL_INTEL_ROOT = stockKolRoot;

    const tasks = createDefaultWorkflowLocalTasks({
      kolContextCache: {
        minDays: 30,
        ttlMs: 60_000,
        maxEntries: 4,
        now: () => 1_000,
      },
    } as any);
    const input = {
      taskId: 'stock.kol.prepare_context',
      nodeId: 'kol_context_preflight',
      input: { command: 'kol', argsText: '--days=7', input: { days: 7 } },
      artifacts: {},
    };

    const first = await tasks['stock.kol.prepare_context'](input);
    const second = await tasks['stock.kol.prepare_context'](input);

    expect(fs.readFileSync(counterPath, 'utf-8')).toBe('2');
    expect((first as any).cache).toMatchObject({
      scope: 'memory',
      status: 'disabled',
      cacheable: false,
    });
    expect((second as any).cache).toMatchObject({
      scope: 'memory',
      status: 'disabled',
      cacheable: false,
    });
  });

  test('prepare_context expires stale long KOL cache entries', async () => {
    const stockKolRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stock-kol-expire-root-'),
    );
    tempDirs.push(stockKolRoot);
    fs.mkdirSync(path.join(stockKolRoot, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(stockKolRoot, 'references'), { recursive: true });
    const counterPath = path.join(stockKolRoot, 'counter.txt');
    fs.writeFileSync(
      path.join(stockKolRoot, 'references', 'kol_whitelist.json'),
      JSON.stringify({
        version: 1,
        kols: [
          {
            id: 'sample',
            display_name: 'Sample KOL',
            primary_links: [
              { platform: 'X/Twitter', url: 'https://x.com/sample' },
            ],
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(stockKolRoot, 'commands', 'kol.py'),
      [
        'import json',
        'from pathlib import Path',
        'COUNTER = Path(__file__).resolve().parents[1] / "counter.txt"',
        'def load_whitelist():',
        '    return json.loads((Path(__file__).resolve().parents[1] / "references" / "kol_whitelist.json").read_text(encoding="utf-8"))',
        'def build_x_source_preflight(days, whitelist):',
        '    count = int(COUNTER.read_text(encoding="utf-8") or "0") + 1 if COUNTER.exists() else 1',
        '    COUNTER.write_text(str(count), encoding="utf-8")',
        '    return {"source": "twscrape", "status": "ok", "window_days": days, "results": [{"posts": [{"text": f"fetch {count}"}]}]}',
      ].join('\n'),
    );

    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
    process.env.STOCK_KOL_INTEL_ROOT = stockKolRoot;

    let now = 1_000;
    const tasks = createDefaultWorkflowLocalTasks({
      kolContextCache: {
        minDays: 30,
        ttlMs: 100,
        maxEntries: 4,
        now: () => now,
      },
    } as any);
    const input = {
      taskId: 'stock.kol.prepare_context',
      nodeId: 'kol_context_preflight',
      input: { command: 'kol', argsText: '', input: { days: 30 } },
      artifacts: {},
    };

    const first = await tasks['stock.kol.prepare_context'](input);
    now += 101;
    const second = await tasks['stock.kol.prepare_context'](input);

    expect(fs.readFileSync(counterPath, 'utf-8')).toBe('2');
    expect((first as any).cache.status).toBe('miss');
    expect((second as any).cache.status).toBe('miss');
    expect((second as any).x_preflight.results[0].posts[0].text).toBe(
      'fetch 2',
    );
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
    const cacheRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'agent-fabric-cache-'),
    );
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
    process.env.AGENT_FABRIC_CACHE_DIR = cacheRoot;

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
      Object.keys(tasks).filter((taskId) =>
        taskId.startsWith('stock.strategy.'),
      ),
    ).toEqual([]);
  });
});
