import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const handlers: Record<string, (payload: any) => Promise<void> | void> = {};
  return {
    handlers,
    requestSpy: vi.fn().mockResolvedValue({ bot: { open_id: 'bot-open-id' } }),
    createSpy: vi.fn().mockResolvedValue({ data: { message_id: 'msg-reply' } }),
    messageListSpy: vi.fn().mockResolvedValue({ data: { items: [] } }),
    wsStartSpy: vi.fn().mockResolvedValue(undefined),
    wsCloseSpy: vi.fn().mockResolvedValue(undefined),
    executeWorkflowCommandSpy: vi
      .fn()
      .mockResolvedValue(
        [
          '🚀 已启动：股票 KOL 情报工作流',
          '🧩 Workflow：kol',
          '🆔 Run：wfrun_test_kol',
          '📝 任务：股票 KOL 情报报告',
          '📬 完成、失败或超时后，我会回到这里通知你。',
        ].join('\n'),
      ),
    runAgentProcess: vi.fn(),
    writeGroupsSnapshot: vi.fn(),
    writeTasksSnapshot: vi.fn(),
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
      v1: {
        message: {
          create: hoisted.createSpy,
          get: vi.fn(),
          list: hoisted.messageListSpy,
        },
        chat: {
          get: vi.fn().mockResolvedValue({ data: { chat_type: 'p2p' } }),
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
    cardkit = {
      v1: {
        card: {
          create: vi.fn(),
          update: vi.fn(),
          settings: vi.fn(),
        },
        cardElement: {
          content: vi.fn(),
          update: vi.fn(),
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
    wsConfig = {
      getWSInstance: () => ({ readyState: 1 }),
    };

    get isConnecting() {
      return false;
    }

    getReconnectInfo() {
      return { nextConnectTime: 0 };
    }

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

vi.mock('../../../../src/web/app.js', () => ({
  startWebServer: vi.fn(),
  broadcastToWebClients: vi.fn(),
  broadcastNewMessage: vi.fn(),
  broadcastTyping: vi.fn(),
  broadcastStreamEvent: vi.fn(),
  broadcastAgentStatus: vi.fn(),
  broadcastGroupCreated: vi.fn(),
  shutdownWebServer: vi.fn(),
  getActiveStreamingTexts: vi.fn(() => new Map()),
  clearStreamingSnapshot: vi.fn(),
}));

vi.mock('../../../../src/agent/runner/container-runner.js', () => ({
  runAgentProcess: hoisted.runAgentProcess,
  writeGroupsSnapshot: hoisted.writeGroupsSnapshot,
  writeTasksSnapshot: hoisted.writeTasksSnapshot,
}));

vi.mock('../../../../src/agent/workflow/command.js', () => ({
  executeWorkflowCommand: hoisted.executeWorkflowCommandSpy,
}));

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fabric-kol-e2e-'));
  tempHomes.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
  Object.keys(hoisted.handlers).forEach((key) => delete hoisted.handlers[key]);
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Feishu /kol command E2E simulation', () => {
  test('routes /kol through real IM command handling, skill dispatch, workflow command, and visible Feishu reply', async () => {
    const home = createTempHome();
    vi.stubEnv('HOME', home);

    const [{ initDatabase, setRegisteredGroup }, indexModule, feishu] =
      await Promise.all([
        import('../../../../src/storage/db.ts'),
        import('../../../../src/index.ts'),
        import('../../../../src/messaging/providers/feishu/index.ts'),
      ]);

    initDatabase();
    const chatId = 'oc_kol_e2e';
    const chatJid = `feishu:${chatId}`;
    setRegisteredGroup(chatJid, {
      name: 'Feishu KOL E2E',
      folder: 'kol-e2e',
      added_at: '2026-06-05T08:30:00.000Z',
      agentType: 'openai',
      customCwd: process.cwd(),
      created_by: 'user-1',
    });

    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    try {
      await connection.connect({
        onReady: vi.fn(),
        onNewChat: vi.fn(),
        onCommand: indexModule.handleImCommandForTests,
      } as any);

      await hoisted.handlers['im.message.receive_v1']?.({
        message: {
          chat_id: chatId,
          message_id: 'om_kol_e2e',
          create_time: String(Date.parse('2026-06-05T08:31:00.000Z')),
          message_type: 'text',
          content: JSON.stringify({ text: '/kol --days=7' }),
          chat_type: 'p2p',
        },
        sender: {
          sender_id: {
            open_id: 'ou_kol_e2e',
          },
        },
      });

      expect(hoisted.executeWorkflowCommandSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          chatJid,
          argsText: 'kol 股票 KOL 情报报告',
          background: true,
          triggerMessageId: 'om_kol_e2e',
          initialInput: {
            command: 'kol',
            argsText: '--days=7',
            input: { days: 7 },
          },
        }),
      );

      const sentTextPayload = hoisted.createSpy.mock.calls.at(-1)?.[0]?.data;
      expect(sentTextPayload).toMatchObject({
        receive_id: chatId,
        msg_type: 'text',
      });
      expect(JSON.parse(sentTextPayload.content).text).toContain(
        '🚀 已启动：股票 KOL 情报工作流',
      );
    } finally {
      await connection.stop();
    }
  });
});
