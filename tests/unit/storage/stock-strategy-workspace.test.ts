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

async function loadStorage(home = tempDir('cli-claw-retired-stock-home-')) {
  vi.stubEnv('HOME', home);
  const db = await import('../../../src/storage/db.ts');
  db.initDatabase();
  return { db, home };
}

describe('retired stock strategy automation cleanup', () => {
  test('does not seed the retired stock strategy workspace or schedules on startup', async () => {
    const { db } = await loadStorage();

    expect(db.getRegisteredGroup('web:stock-strategy')).toBeUndefined();
    expect(db.getThread('thread-stock-strategy-main')).toBeNull();
    expect(
      db
        .getAllTasks()
        .filter(
          (task) =>
            task.id.startsWith('stock-strategy-') ||
            task.script_command?.startsWith('stock-strategy-'),
        ),
    ).toEqual([]);

    db.closeDatabase();
  });

  test('deletes legacy stock strategy schedules and task logs on the next startup', async () => {
    const first = await loadStorage();
    first.db.createTask({
      id: 'stock-strategy-control-loop',
      group_folder: 'stock-strategy',
      chat_jid: 'web:stock-strategy',
      prompt: 'Retired control loop.',
      schedule_type: 'interval',
      schedule_value: String(30 * 60 * 1000),
      context_mode: 'isolated',
      execution_type: 'workflow',
      script_command: 'stock-strategy-control-loop',
      next_run: '2026-05-27T13:00:00.000Z',
      status: 'paused',
      created_at: '2026-05-27T12:00:00.000Z',
      created_by: 'instance-1',
      notify_channels: ['feishu:private'],
    });
    first.db.logTaskRun({
      task_id: 'stock-strategy-control-loop',
      run_at: '2026-05-27T12:05:00.000Z',
      duration_ms: 25,
      status: 'success',
      result: 'retired task audit stays available',
      error: null,
    });
    first.db.closeDatabase();

    vi.resetModules();
    const second = await loadStorage(first.home);

    expect(
      second.db.getTaskById('stock-strategy-control-loop'),
    ).toBeUndefined();
    expect(
      second.db.getTaskRunLogs('stock-strategy-control-loop', 10),
    ).toHaveLength(0);

    second.db.closeDatabase();
  });
});
