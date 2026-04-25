import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-lifecycle-'));
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

describe('IM message lifecycle ledger', () => {
  test('records ordered lifecycle events for one inbound Feishu message', async () => {
    const db = await loadDbModule();

    db.recordImMessageLifecycleEvent({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      sourceJid: 'feishu:chat-1',
      messageId: 'om_1',
      stage: 'received',
      status: 'ok',
      details: { source: 'ws', messageType: 'text' },
    });
    db.recordImMessageLifecycleEvent({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      sourceJid: 'feishu:chat-1',
      messageId: 'om_1',
      stage: 'stored',
      status: 'ok',
      details: { targetJid: 'feishu:chat-1' },
    });

    const events = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      messageId: 'om_1',
    });

    expect(events.map((event) => event.stage)).toEqual(['received', 'stored']);
    expect(events[0]?.details).toEqual({
      source: 'ws',
      messageType: 'text',
    });

    db.closeDatabase();
  });

  test('finds routed lifecycle events through the original source chat jid', async () => {
    const db = await loadDbModule();

    db.recordImMessageLifecycleEvent({
      provider: 'feishu',
      chatJid: 'web:main',
      sourceJid: 'feishu:chat-1',
      messageId: 'om_routed',
      stage: 'stored',
      status: 'ok',
      details: { targetJid: 'web:main' },
    });

    const events = db.getRecentImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      limit: 5,
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.chat_jid).toBe('web:main');
    expect(events[0]?.source_jid).toBe('feishu:chat-1');
    expect(events[0]?.stage).toBe('stored');

    db.closeDatabase();
  });
});
