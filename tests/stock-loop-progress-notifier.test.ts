import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

const scriptPath = path.resolve('scripts/stock-loop-progress-notifier.mjs');

function setupTaskDb(stockRoot: string): string {
  const cacheDir = path.join(stockRoot, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const dbPath = path.join(cacheDir, 'task_chain.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE task_chain_tasks (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      due_at TEXT,
      result_json TEXT,
      error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE task_chain_summaries (
      id TEXT PRIMARY KEY,
      summary_type TEXT NOT NULL,
      summary_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO task_chain_tasks
      (id, task_type, status, due_at, result_json, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const base = Date.parse('2026-05-15T00:00:00.000Z');
  for (let index = 0; index < 50; index += 1) {
    const updatedAt = new Date(base + index * 60_000)
      .toISOString()
      .replace('.000Z', '+00:00');
    insert.run(
      `old-${String(index).padStart(2, '0')}`,
      'market_observe',
      'completed',
      updatedAt,
      '{}',
      null,
      updatedAt,
    );
  }

  insert.run(
    'new-news',
    'news_scan',
    'completed',
    '2026-05-15T01:00:00+00:00',
    JSON.stringify({
      status: 'collected',
      result_count: 2,
      queries: ['港股 热点', 'US stocks AI'],
    }),
    null,
    '2026-05-15T01:00:00+00:00',
  );
  insert.run(
    'new-strategy',
    'strategy_iteration',
    'completed',
    '2026-05-15T01:05:00+00:00',
    JSON.stringify({
      summary: {
        human_review_ready: 1,
        needs_iteration: 1,
      },
    }),
    null,
    '2026-05-15T01:05:00+00:00',
  );
  insert.run(
    'next-news',
    'news_scan',
    'pending',
    '2026-05-15T01:15:00+00:00',
    '{}',
    null,
    '2026-05-15T01:05:00+00:00',
  );
  db.close();
  return dbPath;
}

describe('stock-loop-progress-notifier', () => {
  test('reports rows after the cursor even when completed history exceeds the old page size', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'cli-claw-progress-'));
    try {
      const stockRoot = path.join(tempDir, 'stock-analysis-api');
      setupTaskDb(stockRoot);
      const stateFile = path.join(tempDir, 'state.json');
      fs.writeFileSync(
        stateFile,
        `${JSON.stringify(
          {
            lastCompletedCursor: {
              updatedAt: '2026-05-15T00:49:00+00:00',
              taskId: 'old-49',
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = spawnSync(
        process.execPath,
        [
          scriptPath,
          `--stock-root=${stockRoot}`,
          `--state-file=${stateFile}`,
          '--max-items=8',
        ],
        {
          cwd: path.resolve('.'),
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('股票系统 loop 进展');
      expect(result.stdout).toContain('新闻热点扫描');
      expect(result.stdout).toContain('策略迭代');

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      expect(state.lastCompletedCursor).toEqual({
        updatedAt: '2026-05-15T01:05:00+00:00',
        taskId: 'new-strategy',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
