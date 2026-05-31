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

function runKolDispatch(argsText: string, envRoot: string): Record<string, any> {
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
    command: 'kol',
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
});
