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
  const db = await import('../../../src/storage/db.ts');
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

  test('finds recent non-ok lifecycle events even when newer ok events exist', async () => {
    const db = await loadDbModule();

    db.recordImMessageLifecycleEvent({
      provider: 'feishu',
      chatJid: 'web:main',
      sourceJid: 'feishu:chat-1',
      messageId: 'om_failed_delivery',
      stage: 'im_delivered',
      status: 'error',
      reason: 'send_failed_after_retries',
      createdAt: '2026-04-25T12:00:00.000Z',
    });
    db.recordImMessageLifecycleEvent({
      provider: 'feishu',
      chatJid: 'web:main',
      sourceJid: 'feishu:chat-1',
      messageId: 'om_later_ok_1',
      stage: 'cursor_committed',
      status: 'ok',
      createdAt: '2026-04-25T12:01:00.000Z',
    });
    db.recordImMessageLifecycleEvent({
      provider: 'feishu',
      chatJid: 'web:main',
      sourceJid: 'feishu:chat-1',
      messageId: 'om_later_ok_2',
      stage: 'notified',
      status: 'ok',
      createdAt: '2026-04-25T12:02:00.000Z',
    });
    db.recordImMessageLifecycleEvent({
      provider: 'feishu',
      chatJid: 'web:main',
      sourceJid: 'feishu:chat-1',
      messageId: 'om_skipped',
      stage: 'skipped',
      status: 'skipped',
      reason: 'require_mention',
      createdAt: '2026-04-25T12:03:00.000Z',
    });

    const events = db.getRecentImMessageLifecycleIssueEvents({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      limit: 5,
    });

    expect(events.map((event) => event.message_id)).toEqual([
      'om_skipped',
      'om_failed_delivery',
    ]);

    db.closeDatabase();
  });

  test('records post-store lifecycle stages for Feishu-origin routed messages', async () => {
    const db = await loadDbModule();
    const { recordLifecycleForMessages } =
      await import('../../../src/messaging/lifecycle.ts');

    const recorded = recordLifecycleForMessages({
      messages: [
        {
          id: 'msg-feishu-origin',
          chat_jid: 'web:main',
          source_jid: 'feishu:chat-1',
          sender: 'user',
          sender_name: 'User',
          content: 'hello from feishu',
          timestamp: '2026-04-25T00:00:00.000Z',
        },
        {
          id: 'msg-web-origin',
          chat_jid: 'web:main',
          source_jid: 'web:main',
          sender: 'user',
          sender_name: 'User',
          content: 'hello from web',
          timestamp: '2026-04-25T00:00:01.000Z',
        },
      ],
      stage: 'queued',
      details: { route: 'message_loop' },
    });

    expect(recorded).toBe(1);

    const events = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      messageId: 'msg-feishu-origin',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'feishu',
      chat_jid: 'web:main',
      source_jid: 'feishu:chat-1',
      message_id: 'msg-feishu-origin',
      stage: 'queued',
      status: 'ok',
      details: { route: 'message_loop' },
    });

    db.closeDatabase();
  });

  test('records dead-lettered lifecycle events for pending Feishu-origin messages', async () => {
    const db = await loadDbModule();
    const { recordDeadLetteredLifecycleForPendingMessages } =
      await import('../../../src/messaging/lifecycle.ts');

    db.ensureChatExists('web:main');
    db.storeMessageDirect(
      'msg-feishu-dead-letter',
      'web:main',
      'user-1',
      'User',
      'please handle this from Feishu',
      '2026-04-25T01:00:00.000Z',
      false,
      { sourceJid: 'feishu:chat-1' },
    );
    db.storeMessageDirect(
      'msg-web-not-dead-lettered',
      'web:main',
      'user-1',
      'User',
      'web-only work should not create Feishu lifecycle rows',
      '2026-04-25T01:00:01.000Z',
      false,
      { sourceJid: 'web:main' },
    );

    const recorded = recordDeadLetteredLifecycleForPendingMessages({
      chatJid: 'web:main',
      cursor: { timestamp: '', id: '' },
      reason: 'max_retries_exceeded',
      details: { retryLimit: 5 },
    });

    expect(recorded).toBe(1);

    const events = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      messageId: 'msg-feishu-dead-letter',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'feishu',
      chat_jid: 'web:main',
      source_jid: 'feishu:chat-1',
      message_id: 'msg-feishu-dead-letter',
      stage: 'dead_lettered',
      status: 'error',
      reason: 'max_retries_exceeded',
      details: { retryLimit: 5 },
    });

    db.closeDatabase();
  });

  test('records stream-started lifecycle events for Feishu-origin stream init turns', async () => {
    const db = await loadDbModule();
    const { recordStreamStartedLifecycleForMessages } =
      await import('../../../src/messaging/lifecycle.ts');

    const recorded = recordStreamStartedLifecycleForMessages({
      messages: [
        {
          id: 'msg-feishu-stream',
          chat_jid: 'web:main',
          source_jid: 'feishu:chat-1',
          sender: 'user',
          sender_name: 'User',
          content: 'stream this from feishu',
          timestamp: '2026-04-25T02:00:00.000Z',
        },
        {
          id: 'msg-web-stream',
          chat_jid: 'web:main',
          source_jid: 'web:main',
          sender: 'user',
          sender_name: 'User',
          content: 'web-only stream should not create Feishu lifecycle rows',
          timestamp: '2026-04-25T02:00:01.000Z',
        },
      ],
      streamEvent: {
        eventType: 'init',
        turnId: 'turn-1',
        sessionId: 'session-1',
        messageCursor: {
          timestamp: '2026-04-25T02:00:00.000Z',
          id: 'msg-feishu-stream',
        },
      },
      details: { route: 'main' },
    });

    expect(recorded).toBe(1);

    const events = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      messageId: 'msg-feishu-stream',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'feishu',
      chat_jid: 'web:main',
      source_jid: 'feishu:chat-1',
      message_id: 'msg-feishu-stream',
      stage: 'stream_started',
      status: 'ok',
      details: {
        route: 'main',
        turnId: 'turn-1',
        sessionId: 'session-1',
        cursor: {
          timestamp: '2026-04-25T02:00:00.000Z',
          id: 'msg-feishu-stream',
        },
      },
    });

    db.closeDatabase();
  });

  test('records direct IPC image delivery failures for Feishu-origin messages', async () => {
    const db = await loadDbModule();
    const { recordDirectImDeliveryLifecycleForMessages } =
      await import('../../../src/messaging/lifecycle.ts');

    const recorded = recordDirectImDeliveryLifecycleForMessages({
      messages: [
        {
          id: 'msg-feishu-direct-image',
          chat_jid: 'web:main',
          source_jid: 'feishu:chat-1',
          sender: 'user',
          sender_name: 'User',
          content: 'send an image from this Feishu turn',
          timestamp: '2026-04-25T04:00:00.000Z',
        },
        {
          id: 'msg-web-direct-image',
          chat_jid: 'web:main',
          source_jid: 'web:main',
          sender: 'user',
          sender_name: 'User',
          content:
            'web-only direct image should not create Feishu lifecycle rows',
          timestamp: '2026-04-25T04:00:01.000Z',
        },
      ],
      delivery: 'direct_image',
      targetJid: 'feishu:chat-1',
      sent: false,
      details: { fileName: 'plot.png' },
    });

    expect(recorded).toBe(1);

    const events = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      messageId: 'msg-feishu-direct-image',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'feishu',
      chat_jid: 'web:main',
      source_jid: 'feishu:chat-1',
      message_id: 'msg-feishu-direct-image',
      stage: 'im_delivered',
      status: 'error',
      reason: 'send_failed_after_retries',
      details: {
        delivery: 'direct_image',
        targetJid: 'feishu:chat-1',
        fileName: 'plot.png',
      },
    });

    db.closeDatabase();
  });

  test('records direct IPC file delivery skips when no IM route exists', async () => {
    const db = await loadDbModule();
    const { recordDirectImDeliveryLifecycleForMessages } =
      await import('../../../src/messaging/lifecycle.ts');

    const recorded = recordDirectImDeliveryLifecycleForMessages({
      messages: [
        {
          id: 'msg-feishu-direct-file',
          chat_jid: 'web:main',
          source_jid: 'feishu:chat-1',
          sender: 'user',
          sender_name: 'User',
          content: 'send a file from this Feishu turn',
          timestamp: '2026-04-25T04:05:00.000Z',
        },
      ],
      delivery: 'direct_file',
      targetJid: null,
      sent: null,
      reason: 'no_im_route',
      details: { fileName: 'report.pdf' },
    });

    expect(recorded).toBe(1);

    const events = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid: 'feishu:chat-1',
      messageId: 'msg-feishu-direct-file',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: 'im_delivered',
      status: 'skipped',
      reason: 'no_im_route',
      details: {
        delivery: 'direct_file',
        fileName: 'report.pdf',
      },
    });

    db.closeDatabase();
  });
});
