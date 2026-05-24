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
  fs.writeFileSync(path.join(stockApiRoot, 'scripts', 'futu_market_data.py'), '');
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
    });
    expect(db.getTaskById('stock-strategy-us-candidate-validation')).toMatchObject(
      {
        group_folder: 'stock-strategy',
        chat_jid: 'web:stock-strategy',
        script_command: 'stock-strategy-us-candidate-validation',
        schedule_type: 'interval',
        schedule_value: String(2 * 60 * 60 * 1000),
        status: 'active',
        workspace_jid: 'web:stock-strategy',
        workspace_folder: 'stock-strategy',
        notify_channels: ['feishu:private'],
      },
    );
    expect(db.getTaskById('stock-strategy-daily-progress-summary')).toMatchObject(
      {
        group_folder: 'stock-strategy',
        chat_jid: 'web:stock-strategy',
        script_command: 'stock-strategy-daily-progress-summary',
        schedule_type: 'interval',
        schedule_value: String(24 * 60 * 60 * 1000),
        status: 'active',
        workspace_jid: 'web:stock-strategy',
        workspace_folder: 'stock-strategy',
        notify_channels: ['feishu:private'],
      },
    );
    expect(db.getTaskById('stock-strategy-hk-design-review')).toMatchObject({
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      script_command: 'stock-strategy-hk-design-review',
      schedule_type: 'interval',
      schedule_value: String(6 * 60 * 60 * 1000),
      status: 'active',
    });
    expect(db.getTaskById('stock-strategy-cn-coverage-check')).toMatchObject({
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      script_command: 'stock-strategy-cn-coverage-check',
      schedule_type: 'interval',
      schedule_value: String(60 * 60 * 1000),
      status: 'active',
    });

    db.closeDatabase();
  });

  test('resumes legacy paused discovery when usability was not proven', async () => {
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
      status: 'active',
      schedule_type: 'interval',
      schedule_value: String(30 * 60 * 1000),
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
    });

    db.closeDatabase();
  });

  test('normalizes legacy active discovery back to the short orchestrator cadence', async () => {
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
      status: 'active',
      schedule_type: 'interval',
      schedule_value: String(30 * 60 * 1000),
      next_run: '2026-05-24T00:40:00.000Z',
    });

    db.closeDatabase();
  });

  test('normalizes legacy downstream schedules from old cadence-only decisions', async () => {
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

    db.ensureStockStrategyWorkspaceAndSchedules({
      now: '2026-05-24T00:10:00.000Z',
    });

    expect(db.getTaskById('stock-strategy-us-candidate-validation')).toMatchObject(
      {
        status: 'active',
        schedule_type: 'interval',
        schedule_value: String(2 * 60 * 60 * 1000),
        next_run: '2026-05-24T02:10:00.000Z',
      },
    );
    expect(db.getTaskById('stock-strategy-cn-coverage-check')).toMatchObject({
      status: 'active',
      schedule_type: 'interval',
      schedule_value: String(60 * 60 * 1000),
      next_run: '2026-05-24T01:10:00.000Z',
    });

    db.closeDatabase();
  });
});
