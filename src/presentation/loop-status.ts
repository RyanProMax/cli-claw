import fs from 'node:fs';
import path from 'node:path';

import Database from '../storage/sqlite-compat.js';
import type { ScheduledTask, TaskRunLog } from '../domain/types.js';
import type { UsageProviderResult } from '../core/runtime/usage-command.js';

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

type SqliteDatabase = {
  prepare: (sql: string) => { get: () => unknown };
  pragma?: (sql: string) => void;
  exec?: (sql: string) => void;
  close?: () => void;
};

export interface LoopStatusOptions {
  taskReader: LoopTaskReader;
  runtimeUsage: UsageProviderResult | null;
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

function formatEmpty(value = '无'): string {
  return value;
}

function formatLoopRunState(value: string): string {
  const map: Record<string, string> = {
    active: '运行中',
    degraded: '降级',
    active_no_heartbeat: '运行中（等待心跳）',
    not_started: '未启动',
  };
  return map[value] ?? value;
}

function formatTaskStatus(value: string): string {
  const map: Record<string, string> = {
    active: '运行中',
    paused: '已暂停',
    completed: '已完成',
    parsing: '解析中',
    pending: '待执行',
    running: '执行中',
    success: '成功',
    error: '失败',
  };
  return map[value] ?? value;
}

function formatTaskType(value: string): string {
  const map: Record<string, string> = {
    market_observe: '行情观察',
    alpha_mine: 'Alpha 挖掘',
    judge_review: '评委复核',
    paper_trade: '模拟交易',
    position_review: '持仓复核',
    hourly_report: '小时汇报',
    post_market_research: '盘后研究入口',
    daily_report: '每日复盘',
    news_scan: '新闻热点扫描',
    kol_scan: 'KOL 观点扫描',
    sector_review: '板块复盘',
    strategy_analysis: '策略分析',
    strategy_iteration: '策略迭代',
  };
  return map[value] ?? value.replaceAll('_', ' ');
}

function formatMarketError(value: string): string {
  const map: Record<string, string> = {
    task_chain_db_missing: '任务链数据库未找到',
    task_chain_read_failed: '任务链读取失败',
  };
  return map[value] ?? value;
}

function formatFocus(value: string): string {
  const map: Record<string, string> = {
    'market-aware loop policy, usage guard, self-iteration workers':
      '市场感知调度、用量护栏、自迭代 workers',
    pending: '待初始化',
  };
  return map[value] ?? value;
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
  let db: SqliteDatabase | null = null;
  try {
    const isBunRuntime = typeof (globalThis as any).Bun !== 'undefined';
    db = new Database(
      dbPath,
      isBunRuntime
        ? { readonly: true, create: false }
        : { readonly: true, fileMustExist: true },
    ) as SqliteDatabase;
    if (typeof db.pragma === 'function') {
      db.pragma('busy_timeout = 1000');
    } else {
      db.exec?.('PRAGMA busy_timeout = 1000');
    }
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
    return { latest: null, next: null, error: 'task_chain_read_failed' };
  } finally {
    db?.close?.();
  }
}

function formatScheduledTaskStatus(
  task: ScheduledTask | undefined,
  logs: TaskRunLog[],
): string {
  if (!task) return '未注册';
  const latestLog = logs[0];
  const latestError = latestLog?.error ? `，错误=${latestLog.error}` : '';
  return `${formatTaskStatus(task.status)}，上次=${formatTime(task.last_run)}，下次=${formatTime(task.next_run)}${latestError}`;
}

function formatUsageGuard(runtimeUsage: UsageProviderResult | null): string {
  if (!runtimeUsage?.available) {
    return `未知（${runtimeUsage?.reason ?? '用量不可读'}）`;
  }
  const remaining = runtimeUsage.secondaryRemainingPct;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) {
    return '未知（7d 不可读）';
  }
  if (remaining < 30) return `需要暂停，7d=${remaining}%`;
  return `正常，7d=${remaining}%`;
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
      ? `${formatLoopRunState('degraded')}（${formatMarketError(marketRows.error)}）`
      : notifierTask?.status === 'active'
        ? formatLoopRunState('active')
        : formatLoopRunState('degraded');
  const marketNext = marketRows.next
    ? `${formatTaskType(marketRows.next.task_type)} ${formatTaskStatus(marketRows.next.status)} ${formatTime(marketRows.next.due_at)}`
    : formatEmpty();
  const marketLatest = marketRows.latest
    ? `${formatTaskType(marketRows.latest.task_type)} ${formatTaskStatus(marketRows.latest.status)} ${formatTime(marketRows.latest.updated_at)}`
    : formatEmpty();

  const maintenanceLoopStatus =
    maintenanceTask?.status === 'active' && maintenanceState
      ? formatLoopRunState('active')
      : maintenanceTask?.status === 'active'
        ? formatLoopRunState('active_no_heartbeat')
        : formatLoopRunState('not_started');
  const maintenanceHeartbeat = maintenanceState?.last_tick_at
    ? formatTime(maintenanceState.last_tick_at)
    : formatEmpty();
  const maintenanceFocus = formatFocus(
    maintenanceState?.current_focus || 'pending',
  );

  return [
    '',
    '',
    '🔁 循环状态',
    '━━━━━━━━━━',
    `📈 市场策略循环：${marketLoopStatus}｜下一步=${marketNext}｜最近=${marketLatest}`,
    `   进展通知：${formatScheduledTaskStatus(notifierTask, notifierLogs)}`,
    `🛠️ 自迭代维护循环：${maintenanceLoopStatus}｜心跳=${maintenanceHeartbeat}｜当前重点=${maintenanceFocus}`,
    `   调度器：${formatScheduledTaskStatus(maintenanceTask, maintenanceLogs)}`,
    `🛡️ 用量护栏：${formatUsageGuard(options.runtimeUsage)}`,
  ].join('\n');
}
