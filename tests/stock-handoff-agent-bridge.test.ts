import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

type BridgeModule = typeof import('../scripts/stock-handoff-agent-bridge.mjs');

let tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createStockDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE task_chain_agent_handoffs (
      id TEXT PRIMARY KEY,
      source_task_id TEXT,
      source_run_id TEXT,
      task_type TEXT NOT NULL,
      role TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      market TEXT,
      symbols_json TEXT,
      as_of TEXT,
      input_payload_json TEXT,
      input_hash TEXT,
      idempotency_key TEXT,
      allowed_actions_json TEXT,
      forbidden_actions_json TEXT,
      prompt_json TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      claimed_by TEXT,
      claimed_at TEXT,
      lease_expires_at TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO task_chain_agent_handoffs (
      id, source_task_id, source_run_id, task_type, role, status,
      priority, market, symbols_json, as_of, input_payload_json,
      input_hash, idempotency_key, allowed_actions_json,
      forbidden_actions_json, prompt_json, prompt_text, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    'ah-1',
    'task-1',
    'run-1',
    'kol_scan',
    'kol_researcher',
    'pending',
    50,
    'hk_us',
    '["HK.00700"]',
    '2026-05-16',
    JSON.stringify({
      market: 'hk_us',
      symbols: ['HK.00700'],
      prompt_text: 'Build KOL evidence report',
    }),
    'sha256:input-hash-1',
    'task_run:run-1:kol_researcher',
    '["semantic_review","evidence_summary"]',
    '["live_trade","unlock_trade","approve_strategy","activate_strategy"]',
    '{"reply":{"type":"assistant_prompt"}}',
    'Build KOL evidence report',
    '2026-05-16T12:00:00.000Z',
    '2026-05-16T12:00:00.000Z',
  );
  insert.run(
    'ah-done',
    'task-2',
    'run-2',
    'kol_scan',
    'kol_researcher',
    'completed',
    50,
    'hk_us',
    '["HK.09999"]',
    '2026-05-16',
    '{}',
    'sha256:done',
    'task_run:run-2:kol_researcher',
    '["semantic_review","evidence_summary"]',
    '["live_trade","unlock_trade","approve_strategy","activate_strategy"]',
    '{}',
    'Already done',
    '2026-05-16T12:00:00.000Z',
    '2026-05-16T12:00:00.000Z',
  );
  db.close();
}

function createCliClawDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      context_mode TEXT DEFAULT 'isolated',
      execution_type TEXT DEFAULT 'agent',
      script_command TEXT,
      execution_mode TEXT,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      created_by TEXT,
      notify_channels TEXT,
      workspace_jid TEXT,
      workspace_folder TEXT
    );
  `);
  db.close();
}

async function loadBridge(): Promise<BridgeModule> {
  return import('../scripts/stock-handoff-agent-bridge.mjs');
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('stock handoff agent bridge', () => {
  test('creates one deterministic once-agent scheduled task per pending handoff', async () => {
    const dir = tempDir('cli-claw-stock-bridge-');
    const stockDbPath = path.join(dir, 'task_chain.sqlite');
    const cliClawDbPath = path.join(dir, 'messages.db');
    createStockDb(stockDbPath);
    createCliClawDb(cliClawDbPath);

    const { bridgeStockHandoffs } = await loadBridge();
    const result = bridgeStockHandoffs({
      stockDbPath,
      cliClawDbPath,
      stockRepoDir: '/Users/ryan/projects/stock-analysis-api',
      taskDbPathForPrompt: stockDbPath,
      now: '2026-05-16T12:05:00.000Z',
      groupFolder: 'main',
      chatJid: 'web:main',
      createdBy: 'stock-handoff-bridge',
    });

    expect(result).toMatchObject({
      status: 'ok',
      source: 'stock_handoff_agent_bridge',
      created: 1,
      skipped_existing: 0,
      ignored: 1,
    });
    expect(result.tasks).toEqual([
      expect.objectContaining({
        id: 'stock-handoff-ah-1',
        handoff_id: 'ah-1',
        status: 'created',
      }),
    ]);

    const db = new Database(cliClawDbPath);
    const rows = db.prepare('SELECT * FROM scheduled_tasks').all() as Array<{
      id: string;
      group_folder: string;
      chat_jid: string;
      prompt: string;
      schedule_type: string;
      schedule_value: string;
      context_mode: string;
      execution_type: string;
      execution_mode: string | null;
      next_run: string;
      status: string;
      created_at: string;
      created_by: string;
      notify_channels: string | null;
    }>;
    db.close();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'stock-handoff-ah-1',
      group_folder: 'main',
      chat_jid: 'web:main',
      schedule_type: 'once',
      schedule_value: '2026-05-16T12:05:00.000Z',
      context_mode: 'isolated',
      execution_type: 'agent',
      execution_mode: 'host',
      next_run: '2026-05-16T12:05:00.000Z',
      status: 'active',
      created_at: '2026-05-16T12:05:00.000Z',
      created_by: 'stock-handoff-bridge',
    });
    expect(rows[0].prompt).toContain('handoff_id: ah-1');
    expect(rows[0].prompt).toContain('role: kol_researcher');
    expect(rows[0].prompt).toContain('input_hash: sha256:input-hash-1');
    expect(rows[0].prompt).toContain(
      "handoff claim 'ah-1' --claimed-by 'stock-handoff-ah-1' --lease-ttl-seconds 900",
    );
    expect(rows[0].prompt).toContain(
      "handoff complete 'ah-1' --owner-id 'stock-handoff-ah-1' --output-file",
    );
    expect(rows[0].prompt).toContain(
      "handoff fail 'ah-1' --owner-id 'stock-handoff-ah-1'",
    );
    expect(rows[0].prompt).toContain('Build KOL evidence report');
    expect(rows[0].prompt).not.toContain('strategy_registry.py approve');
    expect(rows[0].prompt).not.toContain('strategy_registry.py activate');
  });

  test('is idempotent when run more than once', async () => {
    const dir = tempDir('cli-claw-stock-bridge-idempotent-');
    const stockDbPath = path.join(dir, 'task_chain.sqlite');
    const cliClawDbPath = path.join(dir, 'messages.db');
    createStockDb(stockDbPath);
    createCliClawDb(cliClawDbPath);

    const { bridgeStockHandoffs } = await loadBridge();
    bridgeStockHandoffs({
      stockDbPath,
      cliClawDbPath,
      now: '2026-05-16T12:05:00.000Z',
    });
    const second = bridgeStockHandoffs({
      stockDbPath,
      cliClawDbPath,
      now: '2026-05-16T12:06:00.000Z',
    });

    expect(second).toMatchObject({
      created: 0,
      skipped_existing: 1,
      ignored: 1,
    });
    expect(second.tasks).toEqual([
      expect.objectContaining({
        id: 'stock-handoff-ah-1',
        handoff_id: 'ah-1',
        status: 'skipped_existing',
      }),
    ]);

    const db = new Database(cliClawDbPath);
    const count = db
      .prepare('SELECT COUNT(*) AS count FROM scheduled_tasks')
      .get() as {
      count: number;
    };
    db.close();
    expect(count.count).toBe(1);
  });

  test('can bridge pending handoffs from an exported JSON fixture', async () => {
    const dir = tempDir('cli-claw-stock-bridge-json-');
    const handoffsJsonPath = path.join(dir, 'handoffs.json');
    const cliClawDbPath = path.join(dir, 'messages.db');
    createCliClawDb(cliClawDbPath);
    writeFileSync(
      handoffsJsonPath,
      JSON.stringify({
        handoffs: [
          {
            id: 'json-1',
            source_task_id: 'task-json-1',
            source_run_id: 'run-json-1',
            task_type: 'kol_scan',
            role: 'kol_researcher',
            status: 'pending',
            priority: 10,
            market: 'us',
            symbols: ['US.AAPL'],
            input_payload: { symbols: ['US.AAPL'] },
            input_hash: 'sha256:json-input',
            allowed_actions: ['semantic_review'],
            forbidden_actions: ['live_trade', 'approve_strategy'],
            prompt_json: { reply: { type: 'assistant_prompt' } },
            prompt_text: 'Build JSON KOL evidence report',
            created_at: '2026-05-16T12:00:00.000Z',
          },
          {
            id: 'json-completed',
            task_type: 'kol_scan',
            role: 'kol_researcher',
            status: 'completed',
            prompt_text: 'Already completed',
            created_at: '2026-05-16T12:01:00.000Z',
          },
        ],
      }),
      'utf8',
    );

    const { bridgeStockHandoffs } = await loadBridge();
    const result = bridgeStockHandoffs({
      stockHandoffsJsonPath: handoffsJsonPath,
      cliClawDbPath,
      now: '2026-05-16T12:05:00.000Z',
    });

    expect(result).toMatchObject({
      created: 1,
      skipped_existing: 0,
      ignored: 1,
    });

    const db = new Database(cliClawDbPath);
    const row = db.prepare('SELECT id, prompt FROM scheduled_tasks').get() as {
      id: string;
      prompt: string;
    };
    db.close();
    expect(row.id).toBe('stock-handoff-json-1');
    expect(row.prompt).toContain('handoff_id: json-1');
    expect(row.prompt).toContain('input_hash: sha256:json-input');
    expect(row.prompt).toContain('Build JSON KOL evidence report');
  });
});
