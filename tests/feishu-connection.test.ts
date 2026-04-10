import { beforeEach, describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const handlers: Record<string, (payload: any) => Promise<void> | void> = {};
  const resolveImSlashCommandReplySpy = vi.fn(
    async (
      chatJid: string,
      command: string,
      onCommand?: (chatJid: string, command: string) => Promise<string | null>,
    ) => (await onCommand?.(chatJid, command)) ?? '',
  );
  return {
    handlers,
    requestSpy: vi.fn().mockResolvedValue({ bot: { open_id: 'bot-open-id' } }),
    replySpy: vi.fn().mockResolvedValue({}),
    createSpy: vi.fn().mockResolvedValue({}),
    reactionCreateSpy: vi.fn().mockResolvedValue({ data: { reaction_id: 'r1' } }),
    reactionDeleteSpy: vi.fn().mockResolvedValue({}),
    wsStartSpy: vi.fn().mockResolvedValue(undefined),
    wsCloseSpy: vi.fn().mockResolvedValue(undefined),
    onReadySpy: vi.fn(),
    resolveImSlashCommandReplySpy,
  };
});

vi.mock('@larksuiteoapi/node-sdk', () => {
  class MockClient {
    request = hoisted.requestSpy;
    im = {
      message: {
        reply: hoisted.replySpy,
      },
      v1: {
        message: {
          create: hoisted.createSpy,
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
            create: hoisted.reactionCreateSpy,
            delete: hoisted.reactionDeleteSpy,
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

vi.mock('../src/db.js', () => ({
  setLastGroupSync: vi.fn(),
  storeChatMetadata: vi.fn(),
  storeMessageDirect: vi.fn(),
  updateChatName: vi.fn(),
}));

vi.mock('../src/im-downloader.js', () => ({
  saveDownloadedFile: vi.fn(),
  MAX_FILE_SIZE: 1024 * 1024,
  FileTooLargeError: class FileTooLargeError extends Error {},
}));

vi.mock('../src/message-notifier.js', () => ({
  notifyNewImMessage: vi.fn(),
}));

vi.mock('../src/web.js', () => ({
  broadcastNewMessage: vi.fn(),
}));

vi.mock('../src/image-detector.js', () => ({
  detectImageMimeType: vi.fn(),
}));

vi.mock('../src/im-slash-command.js', () => ({
  resolveImSlashCommandReply: hoisted.resolveImSlashCommandReplySpy,
}));

vi.mock('../src/feishu-streaming-card.js', () => ({
  buildStaticReplyCard: vi.fn((text: string) => ({ schema: '2.0', body: { text } })),
  resolveJidByMessageId: vi.fn(),
  getStreamingSession: vi.fn(() => null),
}));

vi.mock('../src/feishu-markdown-style.js', () => ({
  optimizeMarkdownStyle: vi.fn((text: string) => text),
}));

import { createFeishuConnection } from '../src/feishu.ts';

const PREBUILT_CARD_WRAPPER = JSON.stringify({
  type: 'interactive',
  card: {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      summary: { content: '选择模型' },
    },
    body: {
      elements: [],
    },
  },
});

const EXPECTED_CARD_CONTENT = JSON.stringify(
  JSON.parse(PREBUILT_CARD_WRAPPER).card,
);

describe('feishu connection prebuilt interactive card delivery', () => {
  beforeEach(() => {
    hoisted.requestSpy.mockClear();
    hoisted.replySpy.mockClear();
    hoisted.createSpy.mockClear();
    hoisted.reactionCreateSpy.mockClear();
    hoisted.reactionDeleteSpy.mockClear();
    hoisted.wsStartSpy.mockClear();
    hoisted.wsCloseSpy.mockClear();
    hoisted.onReadySpy.mockClear();
    hoisted.resolveImSlashCommandReplySpy.mockClear();
    Object.keys(hoisted.handlers).forEach((key) => delete hoisted.handlers[key]);
  });

  test('sends only the inner card payload when creating a prebuilt interactive message', async () => {
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
    });

    await connection.sendMessage('chat-create', PREBUILT_CARD_WRAPPER);

    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'chat-create',
        msg_type: 'interactive',
        content: EXPECTED_CARD_CONTENT,
      },
    });
    expect(hoisted.replySpy).not.toHaveBeenCalled();
  });

  test('sends only the inner card payload when replying with a prebuilt interactive message', async () => {
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'chat-reply',
        message_id: 'msg-123',
        create_time: Date.now().toString(),
        message_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
        chat_type: 'group',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    await connection.sendMessage('chat-reply', PREBUILT_CARD_WRAPPER);

    expect(hoisted.replySpy).toHaveBeenCalledWith({
      path: { message_id: 'msg-123' },
      data: {
        content: EXPECTED_CARD_CONTENT,
        msg_type: 'interactive',
      },
    });
  });

  test('sends slash-command interactive replies as interactive cards instead of text', async () => {
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCommand: async () => PREBUILT_CARD_WRAPPER,
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_command_chat',
        message_id: 'msg-command',
        create_time: Date.now().toString(),
        message_type: 'text',
        content: JSON.stringify({ text: '/model' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    expect(hoisted.resolveImSlashCommandReplySpy).toHaveBeenCalled();
    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_command_chat',
        msg_type: 'interactive',
        content: EXPECTED_CARD_CONTENT,
      },
    });
  });

  test('forwards runtime picker card actions when Feishu returns select_static option as a string', async () => {
    const onCardRuntimeUpdate = vi
      .fn()
      .mockResolvedValue('已将当前工作区模型切换为 gpt-5.4-mini');
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCardRuntimeUpdate,
    });

    await hoisted.handlers['card.action.trigger']?.({
      action: {
        tag: 'select_static',
        option: 'gpt-5.4-mini',
        value: {
          action: 'set_runtime_model',
        },
      },
      context: {
        open_chat_id: 'runtime-chat',
      },
    });

    expect(onCardRuntimeUpdate).toHaveBeenCalledWith('feishu:runtime-chat', {
      action: 'set_runtime_model',
      value: 'gpt-5.4-mini',
    });
    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'runtime-chat',
        msg_type: 'interactive',
        content: JSON.stringify({
          schema: '2.0',
          body: {
            text: '已将当前工作区模型切换为 gpt-5.4-mini',
          },
        }),
      },
    });
  });

  test('forwards effort picker card actions when Feishu returns select_static option as a string', async () => {
    const onCardRuntimeUpdate = vi
      .fn()
      .mockResolvedValue('已将当前工作区思考强度切换为 xhigh');
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCardRuntimeUpdate,
    });

    await hoisted.handlers['card.action.trigger']?.({
      action: {
        tag: 'select_static',
        option: 'xhigh',
        value: {
          action: 'set_runtime_effort',
        },
      },
      context: {
        open_chat_id: 'runtime-chat',
      },
    });

    expect(onCardRuntimeUpdate).toHaveBeenCalledWith('feishu:runtime-chat', {
      action: 'set_runtime_effort',
      value: 'xhigh',
    });
    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'runtime-chat',
        msg_type: 'interactive',
        content: JSON.stringify({
          schema: '2.0',
          body: {
            text: '已将当前工作区思考强度切换为 xhigh',
          },
        }),
      },
    });
  });
});
