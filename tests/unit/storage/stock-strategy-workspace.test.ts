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
      schedule_value: String(6 * 60 * 60 * 1000),
      status: 'active',
    });

    db.closeDatabase();
  });
});
