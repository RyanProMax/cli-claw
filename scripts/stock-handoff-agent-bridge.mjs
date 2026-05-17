#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

const DEFAULT_STOCK_REPO_DIR = '/Users/ryan/projects/stock-analysis-api';
const DEFAULT_STOCK_DB_PATH = path.join(
  DEFAULT_STOCK_REPO_DIR,
  '.cache',
  'task_chain.sqlite',
);
const DEFAULT_CLI_CLAW_DB_PATH = path.join(
  os.homedir(),
  '.cli-claw',
  'db',
  'messages.db',
);

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseJsonValue(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') return parseJson(value, fallback);
  if (typeof value === 'object') return value;
  return fallback;
}

function parseJsonArray(value, fallback) {
  const parsed = parseJsonValue(value, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function scheduledTaskIdForHandoff(handoffId) {
  const safeId = String(handoffId).replace(/[^A-Za-z0-9_.-]/g, '-');
  return `stock-handoff-${safeId}`;
}

function resultFileForTask(taskId) {
  return `/tmp/${taskId}-result.json`;
}

function normalizeHandoff(row) {
  return {
    id: row.handoff_id || row.id,
    source_task_id: row.source_task_id ?? row.sourceTaskId ?? null,
    source_run_id: row.source_run_id ?? row.sourceRunId ?? null,
    task_type: row.task_type || row.taskType || 'unknown',
    role: row.role || 'kol_researcher',
    status: row.status,
    priority: Number(row.priority ?? 100),
    market: row.market ?? null,
    symbols: parseJsonArray(
      row.symbols ?? row.symbols_json ?? row.symbolsJson,
      [],
    ),
    as_of: row.as_of ?? row.asOf ?? null,
    input_payload: parseJsonValue(
      row.input_payload ??
        row.inputPayload ??
        row.input_payload_json ??
        row.inputPayloadJson,
      {},
    ),
    input_hash: row.input_hash || row.inputHash || '',
    allowed_actions: parseJsonArray(
      row.allowed_actions ??
        row.allowedActions ??
        row.allowed_actions_json ??
        row.allowedActionsJson,
      [],
    ),
    forbidden_actions: parseJsonArray(
      row.forbidden_actions ??
        row.forbiddenActions ??
        row.forbidden_actions_json ??
        row.forbiddenActionsJson,
      [],
    ),
    prompt_json: parseJsonValue(row.prompt_json ?? row.promptJson, {}),
    prompt_text: row.prompt_text || row.promptText || '',
    created_at: row.created_at ?? row.createdAt,
  };
}

function buildAgentPrompt({
  handoff,
  stockRepoDir,
  taskDbPathForPrompt,
  leaseTtlSeconds,
}) {
  const taskId = scheduledTaskIdForHandoff(handoff.id);
  const ownerId = taskId;
  const outputPath = resultFileForTask(taskId);
  const claimCommand = [
    'uv run python scripts/task_chain.py',
    `--task-db ${shellQuote(taskDbPathForPrompt)}`,
    'handoff',
    'claim',
    shellQuote(handoff.id),
    `--claimed-by ${shellQuote(ownerId)}`,
    `--lease-ttl-seconds ${leaseTtlSeconds}`,
  ].join(' ');
  const completeCommand = [
    'uv run python scripts/task_chain.py',
    `--task-db ${shellQuote(taskDbPathForPrompt)}`,
    'handoff',
    'complete',
    shellQuote(handoff.id),
    `--owner-id ${shellQuote(ownerId)}`,
    `--output-file ${shellQuote(outputPath)}`,
  ].join(' ');
  const failCommand = [
    'uv run python scripts/task_chain.py',
    `--task-db ${shellQuote(taskDbPathForPrompt)}`,
    'handoff',
    'fail',
    shellQuote(handoff.id),
    `--owner-id ${shellQuote(ownerId)}`,
    '--error-type agent_failed',
    '--error-message "<short reason>"',
    '--retryable true',
  ].join(' ');

  return [
    'You are executing a stock-analysis-api agent handoff through Cli Claw scheduled agent.',
    '',
    `handoff_id: ${handoff.id}`,
    `source_task_id: ${handoff.source_task_id ?? ''}`,
    `source_run_id: ${handoff.source_run_id ?? ''}`,
    `task_type: ${handoff.task_type}`,
    `role: ${handoff.role}`,
    `input_hash: ${handoff.input_hash}`,
    `market: ${handoff.market ?? ''}`,
    `symbols: ${JSON.stringify(handoff.symbols)}`,
    `allowed_actions: ${JSON.stringify(handoff.allowed_actions)}`,
    `forbidden_actions: ${JSON.stringify(handoff.forbidden_actions)}`,
    '',
    'Hard rules:',
    '- Do not trade, unlock trade, approve strategy, activate strategy, or call broker write APIs.',
    '- Do not edit strategy registry state.',
    '- Do not treat the assistant prompt as final evidence; produce a structured result JSON.',
    '- If claim fails, stop. Do not complete or fail the handoff because another worker may own it.',
    '- If research cannot be completed after a successful claim, call the fail command.',
    '',
    'Step 1: move to the stock-analysis-api repository and claim this exact handoff id.',
    `cd ${shellQuote(stockRepoDir)}`,
    claimCommand,
    '',
    'Step 2: complete the requested semantic review.',
    '',
    'Original handoff prompt:',
    '```',
    handoff.prompt_text,
    '```',
    '',
    'Step 3: write the result JSON object to this file:',
    outputPath,
    '',
    'The result JSON must include at least:',
    JSON.stringify(
      {
        handoff_id: handoff.id,
        agent_role: handoff.role,
        agent_id: ownerId,
        model: 'cli-claw-scheduled-agent',
        input_hash: handoff.input_hash,
        status: 'completed',
        evidence_refs: [{ type: 'task_chain_handoff', id: handoff.id }],
        summary: '<non-empty summary>',
        findings: [],
        confidence: 'medium',
        limitations: [],
        proposed_next_actions: [],
        forbidden_actions_attempted: false,
      },
      null,
      2,
    ),
    '',
    'Step 4: after writing valid JSON, run:',
    completeCommand,
    '',
    'Failure path after a successful claim:',
    failCommand,
    '',
  ].join('\n');
}

function fetchPendingStockHandoffs(stockDb, role, limit) {
  const rows = stockDb
    .prepare(
      `
      SELECT *
      FROM task_chain_agent_handoffs
      WHERE status = 'pending'
        AND (? IS NULL OR role = ?)
      ORDER BY priority ASC, created_at ASC
      LIMIT ?
      `,
    )
    .all(role ?? null, role ?? null, limit);
  return rows.map(normalizeHandoff);
}

function countIgnoredStockHandoffs(stockDb, role) {
  const row = stockDb
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM task_chain_agent_handoffs
      WHERE status != 'pending'
        AND (? IS NULL OR role = ?)
      `,
    )
    .get(role ?? null, role ?? null);
  return Number(row?.count || 0);
}

function loadStockHandoffsFromJson(jsonPath) {
  const payload = JSON.parse(readFileSync(jsonPath, 'utf8'));
  if (Array.isArray(payload)) {
    return payload.map(normalizeHandoff);
  }
  if (Array.isArray(payload.handoffs)) {
    return payload.handoffs.map(normalizeHandoff);
  }
  if (Array.isArray(payload.items)) {
    return payload.items.map(normalizeHandoff);
  }
  throw new Error(
    'Stock handoffs JSON must be an array or an object with handoffs/items array',
  );
}

function filterPendingHandoffs(handoffs, role, limit) {
  return handoffs
    .filter((handoff) => handoff.status === 'pending')
    .filter((handoff) => role == null || handoff.role === role)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return String(a.created_at || '').localeCompare(
        String(b.created_at || ''),
      );
    })
    .slice(0, limit);
}

function countIgnoredHandoffs(handoffs, role) {
  return handoffs.filter(
    (handoff) =>
      handoff.status !== 'pending' && (role == null || handoff.role === role),
  ).length;
}

function insertScheduledTask(cliClawDb, task) {
  cliClawDb
    .prepare(
      `
      INSERT INTO scheduled_tasks (
        id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
        context_mode, execution_type, script_command, next_run,
        status, created_at, created_by, notify_channels
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      task.id,
      task.group_folder,
      task.chat_jid,
      task.prompt,
      task.schedule_type,
      task.schedule_value,
      task.context_mode,
      task.execution_type,
      null,
      task.next_run,
      task.status,
      task.created_at,
      task.created_by,
      task.notify_channels,
    );
}

export function bridgeStockHandoffs(options = {}) {
  const stockDbPath = options.stockDbPath || DEFAULT_STOCK_DB_PATH;
  const stockHandoffsJsonPath = options.stockHandoffsJsonPath || null;
  const cliClawDbPath = options.cliClawDbPath || DEFAULT_CLI_CLAW_DB_PATH;
  const stockRepoDir = options.stockRepoDir || DEFAULT_STOCK_REPO_DIR;
  const taskDbPathForPrompt = options.taskDbPathForPrompt || stockDbPath;
  const now = options.now || new Date().toISOString();
  const groupFolder = options.groupFolder || 'main';
  const chatJid = options.chatJid || 'web:main';
  const createdBy = options.createdBy || 'stock-handoff-bridge';
  const role = options.role || null;
  const limit = Number(options.limit || 50);
  const leaseTtlSeconds = Number(options.leaseTtlSeconds || 900);

  const stockDb = stockHandoffsJsonPath
    ? null
    : new Database(stockDbPath, { readonly: true });
  const cliClawDb = new Database(cliClawDbPath);
  try {
    const allJsonHandoffs = stockHandoffsJsonPath
      ? loadStockHandoffsFromJson(stockHandoffsJsonPath)
      : null;
    const handoffs = allJsonHandoffs
      ? filterPendingHandoffs(allJsonHandoffs, role, limit)
      : fetchPendingStockHandoffs(stockDb, role, limit);
    const tasks = [];
    let created = 0;
    let skippedExisting = 0;
    const ignored = allJsonHandoffs
      ? countIgnoredHandoffs(allJsonHandoffs, role)
      : countIgnoredStockHandoffs(stockDb, role);

    const tx = cliClawDb.transaction(() => {
      for (const handoff of handoffs) {
        const taskId = scheduledTaskIdForHandoff(handoff.id);
        const existing = cliClawDb
          .prepare('SELECT id FROM scheduled_tasks WHERE id = ?')
          .get(taskId);
        if (existing) {
          skippedExisting += 1;
          tasks.push({
            id: taskId,
            handoff_id: handoff.id,
            status: 'skipped_existing',
          });
          continue;
        }
        insertScheduledTask(cliClawDb, {
          id: taskId,
          group_folder: groupFolder,
          chat_jid: chatJid,
          prompt: buildAgentPrompt({
            handoff,
            stockRepoDir,
            taskDbPathForPrompt,
            leaseTtlSeconds,
          }),
          schedule_type: 'once',
          schedule_value: now,
          context_mode: 'isolated',
          execution_type: 'agent',
          next_run: now,
          status: 'active',
          created_at: now,
          created_by: createdBy,
          notify_channels: null,
        });
        created += 1;
        tasks.push({ id: taskId, handoff_id: handoff.id, status: 'created' });
      }
    });
    tx();

    return {
      status: 'ok',
      source: 'stock_handoff_agent_bridge',
      created,
      skipped_existing: skippedExisting,
      ignored,
      tasks,
    };
  } finally {
    stockDb?.close();
    cliClawDb.close();
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    printJson(
      bridgeStockHandoffs({
        stockDbPath: args.stockTaskDb || args.stockDbPath,
        stockHandoffsJsonPath: args.stockHandoffsJson,
        cliClawDbPath: args.cliClawDb || args.cliClawDbPath,
        stockRepoDir: args.stockRepoDir,
        taskDbPathForPrompt: args.taskDbPathForPrompt,
        now: args.now,
        groupFolder: args.groupFolder,
        chatJid: args.chatJid,
        createdBy: args.createdBy,
        role: args.role,
        limit: args.limit,
        leaseTtlSeconds: args.leaseTtlSeconds,
      }),
    );
  } catch (error) {
    printJson({
      status: 'failed',
      source: 'stock_handoff_agent_bridge',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}
