import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import type { ScheduledTask, TaskRunLog } from './types.js';
import type { UsageProviderResult } from './usage-command.js';

const STOCK_TASK_DB =
  '/Users/ryan/projects/stock-analysis-api/.cache/task_chain.sqlite';
const MAINTENANCE_STATE_FILE = path.join(
  process.cwd(),
  '.cli-claw',
  'maintenance-loop-state.json',
);

type LoopTaskReader = {
  getTaskById: (id: string) => ScheduledTask | undefined;
  getTaskRunLogs: (taskId: string, limit?: number) => TaskRunLog[];
};

type TaskChainRow = {
  task_type: string;
  status: string;
  due_at: string;
  updated_at: string;
  error: string | null;
};

type MaintenanceState = {
  status?: string;
  last_tick_at?: string;
  phase?: string;
  current_focus?: string;
};

export interface LoopStatusOptions {
  taskReader: LoopTaskReader;
  codexUsage: UsageProviderResult | null;
  stockTaskDb?: string;
  maintenanceStateFile?: string;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function readMarketLoopRows(dbPath: string): {
  latest: TaskChainRow | null;
  next: TaskChainRow | null;
  error?: string;
} {
  if (!fs.existsSync(dbPath)) {
    return { latest: null, next: null, error: 'task_chain_db_missing' };
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 1000');
    const latest =
      (db
        .prepare(
          `
          SELECT task_type, status, due_at, updated_at, error
          FROM task_chain_tasks
          WHERE status NOT IN ('pending', 'running')
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        )
        .get() as TaskChainRow | undefined) ?? null;
    const next =
      (db
        .prepare(
          `
          SELECT task_type, status, due_at, updated_at, error
          FROM task_chain_tasks
          WHERE status IN ('pending', 'running')
          ORDER BY due_at ASC
          LIMIT 1
        `,
        )
        .get() as TaskChainRow | undefined) ?? null;
    return { latest, next };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { latest: null, next: null, error: message };
  } finally {
    db?.close();
  }
}

function formatScheduledTaskStatus(
  task: ScheduledTask | undefined,
  logs: TaskRunLog[],
): string {
  if (!task) return 'not_registered';
  const latestLog = logs[0];
  const latestError = latestLog?.error ? ` error=${latestLog.error}` : '';
  return `${task.status}, last=${formatTime(task.last_run)}, next=${formatTime(task.next_run)}${latestError}`;
}

function formatUsageGuard(codexUsage: UsageProviderResult | null): string {
  if (!codexUsage?.available) {
    return `unknown (${codexUsage?.reason ?? 'usage_unavailable'})`;
  }
  const remaining = codexUsage.secondaryRemainingPct;
  if (remaining === undefined) return 'unknown (7d unavailable)';
  if (remaining < 30) return `paused_required, 7d=${remaining}%`;
  return `ok, 7d=${remaining}%`;
}

export function formatLoopStatusSection(options: LoopStatusOptions): string {
  const taskDb = options.stockTaskDb ?? STOCK_TASK_DB;
  const maintenanceStateFile =
    options.maintenanceStateFile ?? MAINTENANCE_STATE_FILE;

  const marketRows = readMarketLoopRows(taskDb);
  const notifierTask = options.taskReader.getTaskById(
    'stock-loop-progress-notifier',
  );
  const notifierLogs = options.taskReader.getTaskRunLogs(
    'stock-loop-progress-notifier',
    1,
  );
  const maintenanceTask = options.taskReader.getTaskById(
    'maintenance-loop-heartbeat',
  );
  const maintenanceLogs = options.taskReader.getTaskRunLogs(
    'maintenance-loop-heartbeat',
    1,
  );
  const maintenanceState = readJsonFile<MaintenanceState>(maintenanceStateFile);

  const marketLoopStatus =
    marketRows.error !== undefined
      ? `error (${marketRows.error})`
      : notifierTask?.status === 'active'
        ? 'active'
        : 'degraded';
  const marketNext = marketRows.next
    ? `${marketRows.next.task_type} ${marketRows.next.status} ${formatTime(marketRows.next.due_at)}`
    : 'none';
  const marketLatest = marketRows.latest
    ? `${marketRows.latest.task_type} ${marketRows.latest.status} ${formatTime(marketRows.latest.updated_at)}`
    : 'none';

  const maintenanceLoopStatus =
    maintenanceTask?.status === 'active' && maintenanceState
      ? 'active'
      : maintenanceTask?.status === 'active'
        ? 'active_no_heartbeat'
        : 'not_started';
  const maintenanceHeartbeat = maintenanceState?.last_tick_at
    ? formatTime(maintenanceState.last_tick_at)
    : 'none';
  const maintenanceFocus = maintenanceState?.current_focus || 'pending';

  return [
    '',
    '🔁 Loop',
    '━━━━━━━━━━',
    `📈 market_loop: ${marketLoopStatus} | next=${marketNext} | last=${marketLatest}`,
    `   notifier: ${formatScheduledTaskStatus(notifierTask, notifierLogs)}`,
    `🛠️ maintenance_loop: ${maintenanceLoopStatus} | heartbeat=${maintenanceHeartbeat} | focus=${maintenanceFocus}`,
    `   scheduler: ${formatScheduledTaskStatus(maintenanceTask, maintenanceLogs)}`,
    `🛡️ usage_guard: ${formatUsageGuard(options.codexUsage)}`,
  ].join('\n');
}
