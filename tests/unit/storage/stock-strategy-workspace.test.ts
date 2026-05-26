import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function loadStorage() {
  const home = tempDir('cli-claw-stock-workspace-home-');
  const stockApiRoot = tempDir('cli-claw-stock-api-');
  fs.mkdirSync(path.join(stockApiRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(stockApiRoot, 'scripts', 'futu_market_data.py'),
    '',
  );
  vi.stubEnv('HOME', home);
  vi.stubEnv('STOCK_ANALYSIS_API_ROOT', stockApiRoot);
  const db = await import('../../../src/storage/db.ts');
  db.initDatabase();
  return { db, stockApiRoot };
}

describe('stock strategy workspace migration', () => {
  test('creates a stable stock workspace and migrates existing stock workflow schedules', async () => {
    const { db, stockApiRoot } = await loadStorage();

    db.setRegisteredGroup('web:main', {
      name: '主工作区',
      folder: 'main',
      added_at: '2026-05-24T00:00:00.000Z',
      customCwd: '/Users/ryan/projects/cli-claw',
      is_home: true,
    });
    db.setRegisteredGroup('feishu:private', {
      name: '飞书私聊',
      folder: 'main',
      added_at: '2026-05-24T00:00:01.000Z',
      customCwd: '/Users/ryan/projects/cli-claw',
    });
    db.deleteTask('stock-strategy-discovery-loop');
    db.createTask({
      id: 'stock-strategy-discovery-loop',
      group_folder: 'main',
      chat_jid: 'feishu:private',
      prompt: 'Run stock strategy discovery',
      schedule_type: 'interval',
      schedule_value: String(30 * 60 * 1000),
      context_mode: 'isolated',
      execution_type: 'workflow',
      script_command: 'stock-strategy-discovery-loop',
      next_run: '2026-05-24T01:00:00.000Z',
      status: 'active',
      created_at: '2026-05-24T00:05:00.000Z',
      created_by: 'instance-1',
      notify_channels: null,
    });

    const result = db.ensureStockStrategyWorkspaceAndSchedules({
      now: '2026-05-24T00:10:00.000Z',
    });

    expect(result.workspaceJid).toBe('web:stock-strategy');
    expect(db.getRegisteredGroup('web:stock-strategy')).toMatchObject({
      name: '股票策略',
      folder: 'stock-strategy',
      customCwd: fs.realpathSync(stockApiRoot),
      is_home: true,
    });
    expect(db.getThread('thread-stock-strategy-main')).toMatchObject({
      workspace_jid: 'web:stock-strategy',
      kind: 'main',
      title: '主线',
    });
    expect(db.getTaskById('stock-strategy-discovery-loop')).toMatchObject({
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      workspace_jid: 'web:stock-strategy',
      workspace_folder: 'stock-strategy',
      notify_channels: ['feishu:private'],
      status: 'paused',
      next_run: null,
    });
    expect(db.getTaskById('stock-strategy-control-loop')).toMatchObject({
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      script_command: 'stock-strategy-control-loop',
      schedule_type: 'interval',
      schedule_value: String(30 * 60 * 1000),
      status: 'active',
      workspace_jid: 'web:stock-strategy',
      workspace_folder: 'stock-strategy',
      notify_channels: ['feishu:private'],
    });
    expect(
      db.getTaskById('stock-strategy-daily-progress-summary'),
    ).toMatchObject({
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      script_command: 'stock-strategy-daily-progress-summary',
      schedule_type: 'cron',
      schedule_value: '0 21 * * *',
      next_run: expect.any(String),
      status: 'active',
      workspace_jid: 'web:stock-strategy',
      workspace_folder: 'stock-strategy',
      notify_channels: ['feishu:private'],
    });
    expect(
      db.getTaskById('stock-strategy-us-candidate-validation'),
    ).toBeUndefined();
    expect(db.getTaskById('stock-strategy-hk-design-review')).toBeUndefined();
    expect(db.getTaskById('stock-strategy-cn-coverage-check')).toBeUndefined();
    expect(db.getTaskById('stock-strategy-paper-validation')).toBeUndefined();

    db.closeDatabase();
  });

  test('migrates an existing daily progress task to the 21:00 cron schedule', async () => {
    const { db } = await loadStorage();

    db.updateTask('stock-strategy-daily-progress-summary', {
      schedule_type: 'interval',
      schedule_value: String(24 * 60 * 60 * 1000),
      next_run: '2026-05-24T12:00:00.000Z',
    });

    db.ensureStockStrategyWorkspaceAndSchedules({
      now: '2026-05-24T00:10:00.000Z',
    });

    expect(
      db.getTaskById('stock-strategy-daily-progress-summary'),
    ).toMatchObject({
      schedule_type: 'cron',
      schedule_value: '0 21 * * *',
      next_run: '2026-05-24T01:00:00.000Z',
      status: 'active',
    });

    db.closeDatabase();
  });

  test('pauses legacy invalid stock strategy workflow tasks instead of letting them rerun', async () => {
    const { db } = await loadStorage();

    db.deleteTask('stock-strategy-design-review');
    db.createTask({
      id: 'stock-strategy-design-review',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      prompt: 'Review HK design.',
      schedule_type: 'interval',
      schedule_value: String(2 * 60 * 60 * 1000),
      context_mode: 'isolated',
      execution_type: 'workflow',
      script_command: 'stock-strategy-design-review',
      next_run: '2026-05-26T16:00:00.000Z',
      last_result: 'workflow stock-strategy-design-review not found',
      status: 'active',
      created_at: '2026-05-26T15:00:00.000Z',
      created_by: 'instance-1',
      notify_channels: ['feishu:private'],
    });

    db.ensureStockStrategyWorkspaceAndSchedules({
      now: '2026-05-26T15:10:00.000Z',
    });

    expect(db.getTaskById('stock-strategy-design-review')).toMatchObject({
      status: 'paused',
      next_run: null,
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      workspace_jid: 'web:stock-strategy',
    });

    db.closeDatabase();
  });

  test('keeps legacy paused discovery as a worker and relies on the control loop heartbeat', async () => {
    const { db } = await loadStorage();

    db.deleteTask('stock-strategy-discovery-loop');
    db.createTask({
      id: 'stock-strategy-discovery-loop',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      prompt: 'Run stock strategy discovery',
      schedule_type: 'interval',
      schedule_value: String(30 * 60 * 1000),
      context_mode: 'isolated',
      execution_type: 'workflow',
      script_command: 'stock-strategy-discovery-loop',
      next_run: '2026-05-24T01:00:00.000Z',
      status: 'active',
      created_at: '2026-05-24T00:05:00.000Z',
      created_by: 'instance-1',
      notify_channels: null,
    });
    db.updateTaskAfterRun(
      'stock-strategy-discovery-loop',
      '2026-05-24T01:00:00.000Z',
      'Paused by Codex: stock strategy discovery is being migrated to state-driven orchestrator',
    );
    db.updateTask('stock-strategy-discovery-loop', { status: 'paused' });

    db.ensureStockStrategyWorkspaceAndSchedules({
      now: '2026-05-24T00:10:00.000Z',
    });

    expect(db.getTaskById('stock-strategy-discovery-loop')).toMatchObject({
      status: 'paused',
      next_run: null,
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
    });
    expect(db.getTaskById('stock-strategy-control-loop')).toMatchObject({
      status: 'active',
      schedule_type: 'interval',
      schedule_value: String(30 * 60 * 1000),
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
    });

    db.closeDatabase();
  });

  test('pauses legacy active discovery and hands the fixed heartbeat to the control loop', async () => {
    const { db } = await loadStorage();

    db.deleteTask('stock-strategy-discovery-loop');
    db.createTask({
      id: 'stock-strategy-discovery-loop',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      prompt: 'Run stock strategy discovery',
      schedule_type: 'interval',
      schedule_value: String(6 * 60 * 60 * 1000),
      context_mode: 'isolated',
      execution_type: 'workflow',
      script_command: 'stock-strategy-discovery-loop',
      next_run: '2026-05-24T06:00:00.000Z',
      last_result:
        'No new evidence: stock strategy discovery short-circuited before workflow execution.',
      status: 'active',
      created_at: '2026-05-24T00:05:00.000Z',
      created_by: 'instance-1',
      notify_channels: null,
    });

    db.ensureStockStrategyWorkspaceAndSchedules({
      now: '2026-05-24T00:10:00.000Z',
    });

    expect(db.getTaskById('stock-strategy-discovery-loop')).toMatchObject({
      status: 'paused',
      next_run: null,
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
    });
    expect(db.getTaskById('stock-strategy-control-loop')).toMatchObject({
      status: 'active',
      schedule_type: 'interval',
      schedule_value: String(30 * 60 * 1000),
      next_run: expect.any(String),
    });

    db.closeDatabase();
  });

  test('pauses legacy fixed worker schedules from old cadence-only decisions', async () => {
    const { db } = await loadStorage();

    db.deleteTask('stock-strategy-us-candidate-validation');
    db.createTask({
      id: 'stock-strategy-us-candidate-validation',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      prompt: 'Validate US candidate',
      schedule_type: 'interval',
      schedule_value: String(6 * 60 * 60 * 1000),
      context_mode: 'isolated',
      execution_type: 'workflow',
      script_command: 'stock-strategy-us-candidate-validation',
      next_run: '2026-05-24T06:00:00.000Z',
      last_result:
        '✅ 工作流完成：{"action":"slow_down","next_workflow":"stock-strategy-us-candidate-validation","cadence":"6h"}',
      status: 'active',
      created_at: '2026-05-24T00:05:00.000Z',
      created_by: 'instance-1',
      notify_channels: null,
    });

    db.deleteTask('stock-strategy-cn-coverage-check');
    db.createTask({
      id: 'stock-strategy-cn-coverage-check',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      prompt: 'Check CN coverage',
      schedule_type: 'interval',
      schedule_value: String(6 * 60 * 60 * 1000),
      context_mode: 'isolated',
      execution_type: 'workflow',
      script_command: 'stock-strategy-cn-coverage-check',
      next_run: '2026-05-24T06:00:00.000Z',
      last_result:
        '✅ 工作流完成：{"action":"slow_down","next_workflow":"stock-strategy-cn-coverage-check","cadence":"6h"}',
      status: 'active',
      created_at: '2026-05-24T00:05:00.000Z',
      created_by: 'instance-1',
      notify_channels: null,
    });

    db.deleteTask('stock-strategy-loop-review');
    db.createTask({
      id: 'stock-strategy-loop-review',
      group_folder: 'main',
      chat_jid: 'feishu:private',
      prompt: 'Review stock strategy loop',
      schedule_type: 'interval',
      schedule_value: String(6 * 60 * 60 * 1000),
      context_mode: 'isolated',
      execution_type: 'workflow',
      script_command: 'stock-strategy-loop',
      next_run: '2026-05-24T06:00:00.000Z',
      last_result:
        '✅ 工作流完成：{"action":"slow_down","next_workflow":"stock-strategy-loop","cadence":"6h"}',
      status: 'active',
      created_at: '2026-05-24T00:05:00.000Z',
      created_by: 'instance-1',
      notify_channels: null,
    });

    db.deleteTask('stock-strategy-candidate-validation');
    db.createTask({
      id: 'stock-strategy-candidate-validation',
      group_folder: 'main',
      chat_jid: 'feishu:private',
      prompt: 'Validate stock strategy candidate',
      schedule_type: 'interval',
      schedule_value: String(2 * 60 * 60 * 1000),
      context_mode: 'isolated',
      execution_type: 'workflow',
      script_command: 'stock-strategy-candidate-validation',
      next_run: '2026-05-24T02:00:00.000Z',
      last_result: null,
      status: 'active',
      created_at: '2026-05-24T00:05:00.000Z',
      created_by: 'instance-1',
      notify_channels: null,
    });

    db.ensureStockStrategyWorkspaceAndSchedules({
      now: '2026-05-24T00:10:00.000Z',
    });

    expect(
      db.getTaskById('stock-strategy-us-candidate-validation'),
    ).toMatchObject({
      status: 'paused',
      next_run: null,
    });
    expect(db.getTaskById('stock-strategy-cn-coverage-check')).toMatchObject({
      status: 'paused',
      next_run: null,
    });
    expect(db.getTaskById('stock-strategy-loop-review')).toMatchObject({
      status: 'paused',
      next_run: null,
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      workspace_jid: 'web:stock-strategy',
    });
    expect(db.getTaskById('stock-strategy-candidate-validation')).toMatchObject(
      {
        status: 'paused',
        next_run: null,
        group_folder: 'stock-strategy',
        chat_jid: 'web:stock-strategy',
        workspace_jid: 'web:stock-strategy',
      },
    );

    db.closeDatabase();
  });

  test('marks only stale scheduled task and workflow runs as failed during watchdog cleanup', async () => {
    const { db } = await loadStorage();

    const staleTaskLogId = db.logTaskRunStart(
      'stock-strategy-control-loop',
      '2026-05-25T03:47:27.876Z',
    );
    const freshTaskLogId = db.logTaskRunStart(
      'stock-strategy-daily-progress-summary',
      '2026-05-25T14:22:29.732Z',
    );
    db.upsertWorkflowContext({
      id: 'ctx-stock-stale',
      folder: 'stock-strategy',
      workflowId: 'stock-strategy-control-loop',
      threadId: 'thread-stock-stale',
      runtimeAgentId: 'runtime-stock-strategy-control',
    });
    db.upsertWorkflowContext({
      id: 'ctx-stock-fresh',
      folder: 'stock-strategy',
      workflowId: 'stock-strategy-daily-progress-summary',
      threadId: 'thread-stock-fresh',
      runtimeAgentId: 'runtime-stock-strategy-daily',
    });
    db.insertWorkflowRun({
      id: 'stale-stock-run',
      contextId: 'ctx-stock-stale',
      folder: 'stock-strategy',
      workflowId: 'stock-strategy-control-loop',
      threadId: 'thread-stock-stale',
      triggerChatJid: 'web:stock-strategy',
      prompt: 'Run stock control loop',
      status: 'running',
      startedAt: '2026-05-25T03:47:34.000Z',
      createdAt: '2026-05-25T03:47:34.000Z',
      updatedAt: '2026-05-25T03:47:34.000Z',
    });
    db.insertWorkflowRun({
      id: 'fresh-stock-run',
      contextId: 'ctx-stock-fresh',
      folder: 'stock-strategy',
      workflowId: 'stock-strategy-daily-progress-summary',
      threadId: 'thread-stock-fresh',
      triggerChatJid: 'web:stock-strategy',
      prompt: 'Summarize stock progress',
      status: 'running',
      startedAt: '2026-05-25T14:22:30.000Z',
      createdAt: '2026-05-25T14:22:30.000Z',
      updatedAt: '2026-05-25T14:22:30.000Z',
    });

    expect(
      db.cleanupStaleRunningTaskAndWorkflowRuns({
        now: '2026-05-25T15:30:00.000Z',
        olderThanMs: 2 * 60 * 60 * 1000,
      }),
    ).toEqual({
      taskLogs: 1,
      workflowRuns: 1,
    });

    expect(db.getTaskRunLogById(staleTaskLogId)).toMatchObject({
      status: 'error',
      error: 'Process exceeded scheduled workflow watchdog timeout',
    });
    expect(db.getTaskRunLogById(freshTaskLogId)).toMatchObject({
      status: 'running',
      error: null,
    });
    expect(db.getWorkflowRunById('stale-stock-run')).toMatchObject({
      status: 'error',
      error: 'Process exceeded scheduled workflow watchdog timeout',
    });
    expect(db.getWorkflowRunById('fresh-stock-run')).toMatchObject({
      status: 'running',
      error: null,
    });

    db.closeDatabase();
  });
});
