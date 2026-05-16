import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const dingtalkCallbacks: Record<string, (downstream: any) => Promise<void>> =
    {};

  return {
    dingtalkCallbacks,
    dingtalkConnectSpy: vi.fn().mockResolvedValue(undefined),
    dingtalkDisconnectSpy: vi.fn(),
    dingtalkAckSpy: vi.fn(),
    fetchSpy: vi.fn(),
    resolveImSlashCommandReplySpy: vi.fn(),
  };
});

vi.mock('axios', () => ({
  default: {
    defaults: {
      proxy: true,
    },
  },
}));

vi.mock('dingtalk-stream', () => {
  class MockDWClient {
    connected = true;
    registered = true;

    constructor(_: unknown) {}

    registerCallbackListener(
      topic: string,
      callback: (downstream: any) => Promise<void>,
    ) {
      hoisted.dingtalkCallbacks[topic] = callback;
    }

    connect() {
      return hoisted.dingtalkConnectSpy();
    }

    disconnect() {
      return hoisted.dingtalkDisconnectSpy();
    }

    socketCallBackResponse(messageId: string, payload: unknown) {
      return hoisted.dingtalkAckSpy(messageId, payload);
    }
  }

  return {
    DWClient: MockDWClient,
    TOPIC_ROBOT: 'robot-topic',
    EventAck: {},
  };
});

vi.mock('../../../../src/storage/db.js', () => ({
  storeChatMetadata: vi.fn(),
  storeMessageDirect: vi.fn(),
  updateChatName: vi.fn(),
}));

vi.mock('../../../../src/messaging/notifier.js', () => ({
  notifyNewImMessage: vi.fn(),
}));

vi.mock('../../../../src/web/app.js', () => ({
  broadcastNewMessage: vi.fn(),
}));

vi.mock('../../../../src/messaging/downloader.js', () => ({
  saveDownloadedFile: vi.fn(),
  MAX_FILE_SIZE: 1024 * 1024,
}));

vi.mock('../../../../src/messaging/image-detector.js', () => ({
  detectImageMimeType: vi.fn(() => 'image/png'),
}));

vi.mock('../../../../src/messaging/providers/wechat/crypto.js', () => ({
  downloadAndDecryptMedia: vi.fn(),
}));

vi.mock('../../../../src/messaging/slash-command.js', () => ({
  resolveImSlashCommandReply: hoisted.resolveImSlashCommandReplySpy,
}));

vi.mock('../../../../src/core/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { storeMessageDirect } from '../../../../src/storage/db.js';
import { broadcastNewMessage } from '../../../../src/web/app.js';
import { createDingTalkConnection } from '../../../../src/messaging/providers/dingtalk.ts';
import { createWeChatConnection } from '../../../../src/messaging/providers/wechat/index.ts';

function mockJsonFetchResponses(responses: Array<Record<string, unknown>>) {
  hoisted.fetchSpy.mockImplementation(async () => {
    const response = responses.shift() ?? { ret: -14 };
    return {
      text: async () => JSON.stringify(response),
    };
  });
  vi.stubGlobal('fetch', hoisted.fetchSpy);
}

describe('IM skill command assistant_prompt sourceKind propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(hoisted.dingtalkCallbacks)) {
      delete hoisted.dingtalkCallbacks[key];
    }
    hoisted.resolveImSlashCommandReplySpy.mockResolvedValue({
      kind: 'rewrite_message',
      content: 'analyze current IPO pool',
      sourceKind: 'assistant_prompt',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('marks WeChat assistant_prompt rewrites on stored and broadcast messages', async () => {
    mockJsonFetchResponses([
      {
        msgs: [
          {
            message_id: 101,
            from_user_id: 'user@wechat',
            create_time_ms: 1_700_000_000_000,
            context_token: 'ctx-1',
            item_list: [
              {
                type: 1,
                text_item: { text: '/hkipo' },
              },
            ],
          },
        ],
        get_updates_buf: 'next-cursor',
      },
      { ret: -14 },
    ]);

    const connection = createWeChatConnection({
      botToken: 'bot-token',
      ilinkBotId: 'ilink-bot',
      baseUrl: 'https://wechat.test/',
    });

    try {
      await connection.connect({
        onNewChat: vi.fn(),
        onCommand: vi.fn().mockResolvedValue(null),
      });

      await vi.waitFor(() => {
        expect(storeMessageDirect).toHaveBeenCalledTimes(1);
      });

      expect(storeMessageDirect).toHaveBeenCalledWith(
        expect.any(String),
        'wechat:user@wechat',
        'wechat:user@wechat',
        'user',
        'analyze current IPO pool',
        expect.any(String),
        false,
        {
          attachments: undefined,
          sourceJid: 'wechat:user@wechat',
          meta: { sourceKind: 'assistant_prompt' },
        },
      );
      expect(broadcastNewMessage).toHaveBeenCalledWith(
        'wechat:user@wechat',
        expect.objectContaining({ source_kind: 'assistant_prompt' }),
        undefined,
      );
    } finally {
      await connection.disconnect();
    }
  });

  test('marks DingTalk assistant_prompt rewrites on stored and broadcast messages', async () => {
    const connection = createDingTalkConnection({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    try {
      await expect(
        connection.connect({
          onNewChat: vi.fn(),
          onCommand: vi.fn().mockResolvedValue(null),
        }),
      ).resolves.toBe(true);

      await hoisted.dingtalkCallbacks['robot-topic']?.({
        headers: { messageId: 'downstream-1' },
        data: JSON.stringify({
          msgId: 'dt-msg-1',
          conversationId: 'cid-1',
          conversationType: '1',
          senderId: 'sender-1',
          senderNick: 'Ding User',
          createAt: 1_700_000_000_000,
          msgtype: 'text',
          text: { content: '/hkipo' },
        }),
      });

      await vi.waitFor(() => {
        expect(storeMessageDirect).toHaveBeenCalledTimes(1);
      });

      expect(storeMessageDirect).toHaveBeenCalledWith(
        expect.any(String),
        'dingtalk:c2c:sender-1',
        'dingtalk:sender-1',
        'Ding User',
        'analyze current IPO pool',
        expect.any(String),
        false,
        {
          attachments: undefined,
          sourceJid: 'dingtalk:c2c:sender-1',
          meta: { sourceKind: 'assistant_prompt' },
        },
      );
      expect(broadcastNewMessage).toHaveBeenCalledWith(
        'dingtalk:c2c:sender-1',
        expect.objectContaining({ source_kind: 'assistant_prompt' }),
        undefined,
      );
    } finally {
      await connection.disconnect();
    }
  });
});
