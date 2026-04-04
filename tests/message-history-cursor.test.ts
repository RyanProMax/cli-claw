import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-history-'));
  tempHomes.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function loadDbModule() {
  const home = createTempHome();
  vi.stubEnv('HOME', home);
  const db = await import('../src/db.ts');
  db.initDatabase();
  return db;
}

describe('message history cursor queries', () => {
  test('getMessagesAfterMulti includes same-timestamp rows from other chat_jid when full cursor is provided', async () => {
    const db = await loadDbModule();

    db.ensureChatExists('feishu:group-1');
    db.ensureChatExists('web:main');

    const timestamp = '2026-04-04T10:00:00.000Z';
    db.storeMessageDirect(
      'msg-feishu',
      'feishu:group-1',
      'user-1',
      'User',
      'from feishu',
      timestamp,
      false,
    );
    db.storeMessageDirect(
      'msg-web',
      'web:main',
      'user-2',
      'User',
      'from web',
      timestamp,
      false,
    );

    const rows = db.getMessagesAfterMulti(
      ['feishu:group-1', 'web:main'],
      {
        timestamp,
        chat_jid: 'feishu:group-1',
        id: 'msg-feishu',
      },
      50,
    );

    expect(rows.map((row) => `${row.chat_jid}:${row.id}`)).toEqual([
      'web:main:msg-web',
    ]);

    db.closeDatabase();
  });

  test('getMessagesPageMulti includes same-timestamp older rows when full before cursor is provided', async () => {
    const db = await loadDbModule();

    db.ensureChatExists('feishu:group-1');
    db.ensureChatExists('web:main');

    const timestamp = '2026-04-04T10:00:00.000Z';
    db.storeMessageDirect(
      'msg-feishu',
      'feishu:group-1',
      'user-1',
      'User',
      'from feishu',
      timestamp,
      false,
    );
    db.storeMessageDirect(
      'msg-web',
      'web:main',
      'user-2',
      'User',
      'from web',
      timestamp,
      false,
    );

    const rows = db.getMessagesPageMulti(
      ['feishu:group-1', 'web:main'],
      {
        timestamp,
        chat_jid: 'web:main',
        id: 'msg-web',
      },
      50,
    );

    expect(rows.map((row) => `${row.chat_jid}:${row.id}`)).toEqual([
      'feishu:group-1:msg-feishu',
    ]);

    db.closeDatabase();
  });
});
