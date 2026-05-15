#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DEFAULT_STOCK_ROOT = '/Users/ryan/projects/stock-analysis-api';
const TASK_LABELS = {
  market_observe: '行情观察',
  alpha_mine: 'Alpha挖掘',
  judge_review: '评委Review',
  paper_trade: '模拟交易',
  hourly_report: '小时报告',
  post_market_research: '盘后研究入口',
  news_scan: '新闻热点扫描',
  kol_scan: 'KOL观点扫描',
  sector_review: '板块复盘',
  strategy_analysis: '策略分析',
  strategy_iteration: '策略迭代',
  daily_report: '每日复盘',
  daily_summary: '日终汇总',
};
const REPORT_TASK_TYPES = new Set([
  'hourly_report',
  'post_market_research',
  'news_scan',
  'kol_scan',
  'sector_review',
  'strategy_analysis',
  'strategy_iteration',
  'daily_report',
  'daily_summary',
]);

function parseArgs(argv) {
  const args = {
    force: false,
    includeProgress: false,
    maxItems: 8,
    stockRoot: DEFAULT_STOCK_ROOT,
    stateFile: path.join(
      process.cwd(),
      '.cli-claw',
      'stock-loop-progress-notifier.json',
    ),
  };

  for (const arg of argv) {
    if (arg === '--force') {
      args.force = true;
    } else if (arg === '--include-progress') {
      args.includeProgress = true;
    } else if (arg.startsWith('--stock-root=')) {
      args.stockRoot = arg.slice('--stock-root='.length);
    } else if (arg.startsWith('--state-file=')) {
      args.stateFile = arg.slice('--state-file='.length);
    } else if (arg.startsWith('--max-items=')) {
      const value = Number.parseInt(arg.slice('--max-items='.length), 10);
      if (Number.isFinite(value) && value > 0) args.maxItems = value;
    }
  }

  args.taskDb = path.join(args.stockRoot, '.cache', 'task_chain.sqlite');
  return args;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function parseJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function formatTime(value) {
  if (!value) return '未知时间';
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

function describeTask(row) {
  const result = parseJson(row.result_json);
  if (row.status !== 'completed') {
    return row.error ? `失败：${row.error}` : `状态：${row.status}`;
  }

  if (row.task_type === 'market_observe') {
    return '收集市场上下文，准备 Alpha 研究';
  }
  if (row.task_type === 'alpha_mine') {
    return '只读研究/回测排队，禁止实盘动作';
  }
  if (row.task_type === 'judge_review') {
    return '进入独立评委评估，未通过不进入交易建议';
  }
  if (row.task_type === 'paper_trade') {
    return '仅模拟盘账本，未触发实盘下单';
  }
  if (row.task_type === 'hourly_report') {
    const summary = result.summary || {};
    const riskEvents = Array.isArray(summary.risk_events)
      ? summary.risk_events.length
      : 0;
    return `任务 ${summary.tasks_total ?? 0}，模拟下单 ${summary.simulated_orders ?? 0}，风险 ${riskEvents}`;
  }
  if (row.task_type === 'post_market_research') {
    return '已进入盘后新闻/KOL/板块/策略分析链路';
  }
  if (row.task_type === 'news_scan') {
    if (result.status === 'collected') {
      return `搜索引擎扫描完成，成功 ${result.result_count ?? 0}/${Array.isArray(result.queries) ? result.queries.length : 0}`;
    }
    return `新闻扫描降级：${result.reason || row.error || 'unknown'}`;
  }
  if (row.task_type === 'kol_scan') {
    if (result.status === 'agent_required') {
      return 'KOL skill 已完成预检，等待 Agent 执行报告生成';
    }
    if (result.status === 'collected') {
      return `KOL 情报已生成，正文 ${result.content_chars ?? 0} 字符`;
    }
    return `KOL 扫描降级：${result.reason || row.error || 'unknown'}`;
  }
  if (row.task_type === 'sector_review') {
    return '板块观点已汇总，等待策略分析消费';
  }
  if (row.task_type === 'strategy_analysis') {
    const summary = result.summary || {};
    return `策略分析完成，待审核 ${summary.human_review_ready ?? 0}，需迭代 ${summary.needs_iteration ?? 0}`;
  }
  if (row.task_type === 'strategy_iteration') {
    const summary = result.summary || {};
    return `策略迭代完成，待审核 ${summary.human_review_ready ?? 0}，需迭代 ${summary.needs_iteration ?? 0}`;
  }
  if (row.task_type === 'daily_report') {
    return '已生成每日复盘，包含操作、持仓、市场观点和纠偏 review';
  }
  if (row.task_type === 'daily_summary') {
    return '生成当日操作、持仓和板块观点汇总';
  }
  return result.objective || result.task_type || '已完成';
}

function latestCursor(rows) {
  if (!rows.length) return null;
  const row = rows[rows.length - 1];
  return {
    updatedAt: row.updated_at,
    taskId: row.id,
  };
}

function fetchRows(db, state, args) {
  if (args.force || !state.lastCompletedCursor?.updatedAt) {
    const rows = db
      .prepare(
        `
        SELECT id, task_type, status, due_at, result_json, error, updated_at
        FROM task_chain_tasks
        WHERE status NOT IN ('pending', 'running')
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      )
      .all(args.maxItems)
      .reverse();
    return rows;
  }

  const rows = db
    .prepare(
      `
      SELECT id, task_type, status, due_at, result_json, error, updated_at
      FROM task_chain_tasks
      WHERE status NOT IN ('pending', 'running')
        AND (
          updated_at > ?
          OR (updated_at = ? AND id > ?)
        )
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    )
    .all(
      state.lastCompletedCursor.updatedAt,
      state.lastCompletedCursor.updatedAt,
      state.lastCompletedCursor.taskId || '',
      args.maxItems,
    );

  return rows.reverse();
}

function fetchPending(db) {
  return db
    .prepare(
      `
      SELECT task_type, status, due_at
      FROM task_chain_tasks
      WHERE status IN ('pending', 'running')
      ORDER BY due_at ASC
      LIMIT 3
    `,
    )
    .all();
}

function fetchLatestHourlySummary(db) {
  const row = db
    .prepare(
      `
      SELECT summary_json
      FROM task_chain_summaries
      WHERE summary_type = 'hourly'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    )
    .get();
  return parseJson(row?.summary_json);
}

function hasReportableProgress(rows, args) {
  if (args.force || args.includeProgress) return true;
  return rows.some(
    (row) => row.status !== 'completed' || REPORT_TASK_TYPES.has(row.task_type),
  );
}

function buildOutput(rows, pendingRows, hourlySummary) {
  const lines = ['股票系统 loop 进展'];
  lines.push(`新完成：${rows.length} 个`);
  for (const row of rows) {
    const label = TASK_LABELS[row.task_type] || row.task_type;
    lines.push(
      `- ${formatTime(row.updated_at)} ${label}：${describeTask(row)}`,
    );
  }

  if (pendingRows.length) {
    const pendingText = pendingRows
      .map((row) => {
        const label = TASK_LABELS[row.task_type] || row.task_type;
        return `${label} ${row.status} ${formatTime(row.due_at)}`;
      })
      .join('；');
    lines.push(`下一步：${pendingText}`);
  } else {
    lines.push('下一步：暂无 pending/running 任务');
  }

  const summary = hourlySummary.summary || {};
  if (Object.keys(summary).length) {
    const risks = Array.isArray(summary.risk_events)
      ? summary.risk_events.length
      : 0;
    lines.push(
      `小时摘要：任务 ${summary.tasks_total ?? 0}，模拟下单 ${summary.simulated_orders ?? 0}，风险 ${risks}，下一焦点 ${summary.next_focus ?? '未记录'}`,
    );
  }
  lines.push('安全边界：paper_only / readonly，未开放实盘下单。');

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.taskDb)) {
    console.error(`stock task-chain DB 不存在：${args.taskDb}`);
    process.exit(2);
  }

  const state = readJsonFile(args.stateFile);
  const db = new Database(args.taskDb, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 1000');

  try {
    const rows = fetchRows(db, state, args);
    if (!rows.length) return;
    const cursor = latestCursor(rows);
    if (!hasReportableProgress(rows, args)) {
      if (cursor) {
        writeJsonFile(args.stateFile, {
          lastCompletedCursor: cursor,
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }

    const pendingRows = fetchPending(db);
    const hourlySummary = fetchLatestHourlySummary(db);
    const output = buildOutput(rows, pendingRows, hourlySummary);
    if (cursor) {
      writeJsonFile(args.stateFile, {
        lastCompletedCursor: cursor,
        updatedAt: new Date().toISOString(),
      });
    }
    process.stdout.write(`${output}\n`);
  } finally {
    db.close();
  }
}

main();
