import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

function resolvePython(): string {
  const candidates = [
    process.env.PYTHON_BIN,
    process.env.PYTHON,
    'python3',
    'python',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('No Python executable available for stock-kol command test');
}

function writeLegacyStockKolRepo(root: string): void {
  const commandsDir = path.join(root, 'commands');
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.writeFileSync(
    path.join(commandsDir, 'kol.py'),
    [
      '#!/usr/bin/env python3',
      'import json',
      'import sys',
      'sys.stdin.read()',
      'print(json.dumps({"reply": {"type": "assistant_prompt", "content": "legacy prompt", "ack": "legacy ack"}}, ensure_ascii=False))',
    ].join('\n'),
  );
}

function writeStockKolRepo(root: string): void {
  fs.mkdirSync(path.join(root, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(root, 'references'), { recursive: true });
  fs.writeFileSync(path.join(root, 'commands', 'kol.py'), '');
  fs.writeFileSync(
    path.join(root, 'references', 'kol_whitelist.json'),
    JSON.stringify(
      {
        version: 1,
        default_days: 30,
        authoritative_sources: [],
        kols: [
          {
            id: 'aleabitoreddit',
            display_name: 'Serenity',
            aliases: ['Serenity', 'aleabitoreddit'],
            focus: ['stock-market commentary'],
            primary_links: [
              {
                platform: 'X/Twitter',
                url: 'https://x.com/aleabitoreddit',
                confidence: 'confirmed',
                evidence: 'Existing user-provided target handle.',
              },
            ],
            candidate_links: [],
            notes: 'Existing whitelist entry.',
          },
        ],
      },
      null,
      2,
    ),
  );
}

function runStockKolDispatch(
  command: string,
  argsText: string,
  envRoot: string,
): Record<string, any> {
  const script = path.join(
    process.cwd(),
    '.agents',
    'skills',
    'stock-kol-intel',
    'commands',
    'dispatch.py',
  );
  const payload = {
    version: 1,
    command,
    entrypoint: 'im',
    chatJid: 'feishu:chat-1',
    argsText,
    args: argsText ? argsText.split(/\s+/) : [],
    workspace: {
      jid: 'web:stocks',
      folder: 'stocks',
      name: 'Stocks',
    },
    issuedAt: '2026-05-31T00:00:00.000Z',
  };
  const stdout = execFileSync(resolvePython(), [script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STOCK_KOL_INTEL_ROOT: envRoot,
    },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10_000,
  });
  return JSON.parse(stdout);
}

function runKolDispatch(argsText: string, envRoot: string): Record<string, any> {
  return runStockKolDispatch('kol', argsText, envRoot);
}

function runKolAddDispatch(
  argsText: string,
  envRoot: string,
): Record<string, any> {
  return runStockKolDispatch('kol-add', argsText, envRoot);
}

describe('stock-kol-intel slash command contract', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('/kol returns a workflow trigger instead of a legacy assistant prompt', () => {
    const externalRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'legacy-stock-kol-'),
    );
    tempDirs.push(externalRoot);
    writeLegacyStockKolRepo(externalRoot);

    const parsed = runKolDispatch('--days=7', externalRoot);

    expect(parsed).toEqual({
      reply: {
        type: 'workflow',
        workflowId: 'kol',
        content: '股票 KOL 情报报告',
        input: { days: 7 },
        ack: '已启动 KOL 情报工作流，窗口 7 天。',
      },
    });
  });

  test('/kol rejects unsupported legacy arguments before workflow dispatch', () => {
    const externalRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'legacy-stock-kol-'),
    );
    tempDirs.push(externalRoot);
    writeLegacyStockKolRepo(externalRoot);

    const parsed = runKolDispatch('--platform=x', externalRoot);

    expect(parsed.reply.type).toBe('final_markdown');
    expect(parsed.reply.content).toContain('不支持的参数');
    expect(parsed.reply.content).toContain('/kol [--days=30]');
  });

  test('/kol-add upserts X handles into the workflow whitelist source', () => {
    const externalRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stock-kol-add-'),
    );
    tempDirs.push(externalRoot);
    writeStockKolRepo(externalRoot);

    const parsed = runKolAddDispatch(
      [
        '[@aleabitoreddit](https://x.com/aleabitoreddit)',
        '白毛女神 AI供应链分析师',
        '- 已存在，应该去重。',
        '',
        '[@charliebilello](https://x.com/charliebilello)',
        'Charlie Bilello',
        '- 市场数据图表帝，长期市场数据和图表分析。',
      ].join('\n'),
      externalRoot,
    );

    expect(parsed.reply.type).toBe('final_markdown');
    expect(parsed.reply.content).toContain('新增 1 个');
    expect(parsed.reply.content).toContain('已存在 1 个');
    expect(parsed.reply.content).toContain('@charliebilello');

    const whitelist = JSON.parse(
      fs.readFileSync(
        path.join(externalRoot, 'references', 'kol_whitelist.json'),
        'utf8',
      ),
    );
    expect(whitelist.kols).toHaveLength(2);
    expect(whitelist.kols.map((kol: any) => kol.id)).toEqual([
      'aleabitoreddit',
      'charliebilello',
    ]);
    expect(whitelist.kols[1]).toMatchObject({
      id: 'charliebilello',
      display_name: 'Charlie Bilello',
      aliases: ['Charlie Bilello', 'charliebilello'],
      primary_links: [
        {
          platform: 'X/Twitter',
          url: 'https://x.com/charliebilello',
          confidence: 'confirmed',
        },
      ],
      candidate_links: [],
      notes: expect.stringContaining('市场数据图表帝'),
    });
  });

  test('/kol-add returns usage without mutating when no X handle is provided', () => {
    const externalRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stock-kol-add-empty-'),
    );
    tempDirs.push(externalRoot);
    writeStockKolRepo(externalRoot);
    const whitelistPath = path.join(
      externalRoot,
      'references',
      'kol_whitelist.json',
    );
    const before = fs.readFileSync(whitelistPath, 'utf8');

    const parsed = runKolAddDispatch('--name Nobody', externalRoot);

    expect(parsed.reply.type).toBe('final_markdown');
    expect(parsed.reply.content).toContain('/kol-add');
    expect(parsed.reply.content).toContain('没有识别到 X/Twitter handle');
    expect(fs.readFileSync(whitelistPath, 'utf8')).toBe(before);
  });
});
