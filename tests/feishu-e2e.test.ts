import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const handlers: Record<string, (payload: any) => Promise<void> | void> = {};
  return {
    handlers,
    requestSpy: vi.fn().mockResolvedValue({ bot: { open_id: 'bot-open-id' } }),
    createSpy: vi.fn().mockResolvedValue({}),
    messageListSpy: vi.fn().mockResolvedValue({ data: { items: [] } }),
    wsStartSpy: vi.fn().mockResolvedValue(undefined),
    wsCloseSpy: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@larksuiteoapi/node-sdk', () => {
  class MockClient {
    request = hoisted.requestSpy;
    im = {
      messageReaction: {
        create: vi.fn().mockResolvedValue({ data: { reaction_id: 'r1' } }),
        delete: vi.fn().mockResolvedValue({}),
      },
      message: {
        reply: vi.fn().mockResolvedValue({}),
      },
      v1: {
        message: {
          create: hoisted.createSpy,
          get: vi.fn(),
          list: hoisted.messageListSpy,
        },
        chat: {
          get: vi.fn(),
          list: vi.fn(),
        },
        image: {
          create: vi.fn(),
        },
        file: {
          create: vi.fn(),
        },
        messageResource: {
          reaction: {
            create: vi.fn().mockResolvedValue({ data: { reaction_id: 'r1' } }),
            delete: vi.fn().mockResolvedValue({}),
          },
        },
      },
    };

    constructor(_: unknown) {}
  }

  class MockEventDispatcher {
    constructor(_: unknown) {}

    register(map: Record<string, (payload: any) => Promise<void> | void>) {
      Object.assign(hoisted.handlers, map);
      return this;
    }
  }

  class MockWSClient {
    start = hoisted.wsStartSpy;
    close = hoisted.wsCloseSpy;

    constructor(_: unknown) {}
  }

  return {
    Client: MockClient,
    EventDispatcher: MockEventDispatcher,
    WSClient: MockWSClient,
    AppType: {
      SelfBuild: 'SelfBuild',
    },
    LoggerLevel: {
      info: 'info',
    },
  };
});

vi.mock('../src/web.js', () => ({
  broadcastNewMessage: vi.fn(),
}));

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-feishu-e2e-'));
  tempHomes.push(dir);
  return dir;
}

async function loadFeishuE2EModules() {
  const home = createTempHome();
  vi.stubEnv('HOME', home);
  const [db, notifier, feishu, restartGuard] = await Promise.all([
    import('../src/db.ts'),
    import('../src/message-notifier.ts'),
    import('../src/feishu.ts'),
    import('../shared/service-restart-guard.ts'),
  ]);
  db.initDatabase();
  return { db, notifier, feishu, restartGuard };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
  hoisted.createSpy.mockResolvedValue({});
  hoisted.messageListSpy.mockResolvedValue({ data: { items: [] } });
  Object.keys(hoisted.handlers).forEach((key) => delete hoisted.handlers[key]);
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Feishu in-process E2E harness', () => {
  test('replays a continuation message through real storage, lifecycle, and notifier wakeup', async () => {
    const { db, notifier, feishu, restartGuard } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    const onCommand = vi.fn();

    await connection.connect({
      onReady: vi.fn(),
      onCommand,
      onNewChat: vi.fn(),
      resolveManagedCommandText: (_chatJid, text) =>
        restartGuard.resolveManagedSelfRestartCommand(text),
    });

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_98f0bb60f284627bf20f9386704f8c82',
        message_id: 'om_x100b51ee3e1b50acb3b0af6442e5761',
        create_time: '1777070333296',
        message_type: 'text',
        content: JSON.stringify({ text: '继续任务 -' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_c9410c372b8283aacad4b2844c5e401b',
        },
      },
    });

    await expect(wakeup).resolves.toBe('woke');
    expect(onCommand).not.toHaveBeenCalled();

    const messages = db.getMessagesSince(
      'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      { timestamp: '', id: '' },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'om_x100b51ee3e1b50acb3b0af6442e5761',
      chat_jid: 'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      source_jid: 'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      sender: 'ou_c9410c372b8283aacad4b2844c5e401b',
      content: '继续任务 -',
    });

    const lifecycle = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid: 'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      messageId: 'om_x100b51ee3e1b50acb3b0af6442e5761',
    });
    expect(lifecycle.map((event) => event.stage)).toEqual([
      'received',
      'stored',
      'notified',
    ]);
    expect(lifecycle.every((event) => event.status === 'ok')).toBe(true);
  });

  test('routes explicit managed restart phrases without storing them as model messages', async () => {
    const { db, feishu, restartGuard } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    const onCommand = vi.fn().mockResolvedValue('自重启受理成功');

    await connection.connect({
      onReady: vi.fn(),
      onCommand,
      onNewChat: vi.fn(),
      resolveManagedCommandText: (_chatJid, text) =>
        restartGuard.resolveManagedSelfRestartCommand(text),
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_restart_chat',
        message_id: 'om_managed_restart',
        create_time: '1777070334000',
        message_type: 'text',
        content: JSON.stringify({ text: '重启服务' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_restart',
        },
      },
    });

    expect(onCommand).toHaveBeenCalledWith(
      'feishu:oc_restart_chat',
      'self-restart',
    );
    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_restart_chat',
        msg_type: 'text',
        content: JSON.stringify({ text: '自重启受理成功' }),
      },
    });
    expect(
      db.getMessagesSince('feishu:oc_restart_chat', { timestamp: '', id: '' }),
    ).toHaveLength(0);
  });

  test('records duplicate Feishu deliveries without storing or notifying twice', async () => {
    const { db, notifier, feishu } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: vi.fn(),
      onNewChat: vi.fn(),
    });

    const payload = {
      message: {
        chat_id: 'oc_duplicate_chat',
        message_id: 'om_duplicate_message',
        create_time: '1777070335000',
        message_type: 'text',
        content: JSON.stringify({ text: '继续任务' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_duplicate',
        },
      },
    };

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');
    await hoisted.handlers['im.message.receive_v1']?.(payload);
    await expect(wakeup).resolves.toBe('woke');
    await hoisted.handlers['im.message.receive_v1']?.(payload);

    expect(
      db.getMessagesSince('feishu:oc_duplicate_chat', {
        timestamp: '',
        id: '',
      }),
    ).toHaveLength(1);
    expect(
      db
        .getImMessageLifecycleEvents({
          provider: 'feishu',
          chatJid: 'feishu:oc_duplicate_chat',
          messageId: 'om_duplicate_message',
        })
        .map((event) => [event.stage, event.status, event.reason]),
    ).toEqual([
      ['received', 'ok', null],
      ['stored', 'ok', null],
      ['notified', 'ok', null],
      ['received', 'ok', null],
      ['skipped', 'skipped', 'duplicate'],
    ]);
  });

  test('skips stale startup backfill messages before they poison duplicate detection', async () => {
    const { db, feishu } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    hoisted.messageListSpy.mockResolvedValueOnce({
      data: {
        items: [
          {
            message_id: 'om_stale_message',
            create_time: '1777070335000',
            msg_type: 'text',
            body: { content: JSON.stringify({ text: '旧消息' }) },
            chat_type: 'p2p',
            sender: {
              sender_id: {
                open_id: 'ou_stale',
              },
            },
          },
        ],
      },
    });

    await connection.connect({
      onReady: vi.fn(),
      onNewChat: vi.fn(),
      startupBackfillChatIds: ['oc_stale_chat'],
      startupBackfillIgnoreMessagesBefore: 1_777_070_336_000,
    });

    expect(
      db.getMessagesSince('feishu:oc_stale_chat', { timestamp: '', id: '' }),
    ).toHaveLength(0);
    expect(
      db
        .getImMessageLifecycleEvents({
          provider: 'feishu',
          chatJid: 'feishu:oc_stale_chat',
          messageId: 'om_stale_message',
        })
        .map((event) => [event.stage, event.status, event.reason]),
    ).toEqual([
      ['received', 'ok', null],
      ['skipped', 'skipped', 'stale_before_reconnection'],
    ]);

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_stale_chat',
        message_id: 'om_stale_message',
        create_time: '1777070335000',
        message_type: 'text',
        content: JSON.stringify({ text: '旧消息重新实时送达' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_stale',
        },
      },
    });

    const liveMessages = db.getMessagesSince('feishu:oc_stale_chat', {
      timestamp: '',
      id: '',
    });
    expect(liveMessages).toHaveLength(1);
    expect(liveMessages[0]?.content).toBe('旧消息重新实时送达');
    expect(
      db
        .getImMessageLifecycleEvents({
          provider: 'feishu',
          chatJid: 'feishu:oc_stale_chat',
          messageId: 'om_stale_message',
        })
        .map((event) => [event.stage, event.status, event.reason]),
    ).toEqual([
      ['received', 'ok', null],
      ['skipped', 'skipped', 'stale_before_reconnection'],
      ['received', 'ok', null],
      ['stored', 'ok', null],
      ['notified', 'ok', null],
    ]);
  });

  test('skips unmentioned group messages when mention-gating rejects the chat', async () => {
    const { db, feishu } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: vi.fn(),
      onNewChat: vi.fn(),
      shouldProcessGroupMessage: vi.fn(() => false),
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_group_chat',
        message_id: 'om_group_unmentioned',
        create_time: '1777070336000',
        message_type: 'text',
        content: JSON.stringify({ text: '没有 @ bot 的群消息' }),
        chat_type: 'group',
        mentions: [],
      },
      sender: {
        sender_id: {
          open_id: 'ou_group',
        },
      },
    });

    expect(
      db.getMessagesSince('feishu:oc_group_chat', { timestamp: '', id: '' }),
    ).toHaveLength(0);
    expect(
      db
        .getImMessageLifecycleEvents({
          provider: 'feishu',
          chatJid: 'feishu:oc_group_chat',
          messageId: 'om_group_unmentioned',
        })
        .map((event) => [event.stage, event.status, event.reason]),
    ).toEqual([
      ['received', 'ok', null],
      ['skipped', 'skipped', 'mention_required'],
    ]);
  });
});
