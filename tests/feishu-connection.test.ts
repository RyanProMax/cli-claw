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
    messageGetSpy: vi.fn(),
    reactionCreateSpy: vi
      .fn()
      .mockResolvedValue({ data: { reaction_id: 'r1' } }),
    reactionDeleteSpy: vi.fn().mockResolvedValue({}),
    resolveJidByMessageIdSpy: vi.fn(),
    registerMessageIdMappingSpy: vi.fn(),
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
          get: hoisted.messageGetSpy,
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
  buildStaticReplyCard: vi.fn((text: string) => ({
    schema: '2.0',
    body: { text },
  })),
  resolveJidByMessageId: hoisted.resolveJidByMessageIdSpy,
  registerMessageIdMapping: hoisted.registerMessageIdMappingSpy,
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
    hoisted.messageGetSpy.mockReset();
    hoisted.reactionCreateSpy.mockClear();
    hoisted.reactionDeleteSpy.mockClear();
    hoisted.resolveJidByMessageIdSpy.mockReset();
    hoisted.registerMessageIdMappingSpy.mockClear();
    hoisted.wsStartSpy.mockClear();
    hoisted.wsCloseSpy.mockClear();
    hoisted.onReadySpy.mockClear();
    hoisted.resolveImSlashCommandReplySpy.mockClear();
    Object.keys(hoisted.handlers).forEach(
      (key) => delete hoisted.handlers[key],
    );
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

  test('sends standalone prebuilt interactive cards even when the chat has a previous inbound message', async () => {
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

    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'chat-reply',
        content: EXPECTED_CARD_CONTENT,
        msg_type: 'interactive',
      },
    });
    expect(hoisted.replySpy).not.toHaveBeenCalled();
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

  test('routes explicit managed restart phrases through the command handler before normal message storage', async () => {
    const onCommand = vi.fn().mockResolvedValue('自重启受理成功');
    const resolveManagedCommandText = vi.fn().mockReturnValue('self-restart');
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCommand,
      resolveManagedCommandText,
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_restart_chat',
        message_id: 'msg-managed-restart',
        create_time: Date.now().toString(),
        message_type: 'text',
        content: JSON.stringify({ text: '重启服务' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    expect(resolveManagedCommandText).toHaveBeenCalledWith(
      'feishu:oc_restart_chat',
      '重启服务',
    );
    expect(onCommand).toHaveBeenCalledWith(
      'feishu:oc_restart_chat',
      'self-restart',
    );
    expect(hoisted.resolveImSlashCommandReplySpy).not.toHaveBeenCalled();
    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_restart_chat',
        msg_type: 'text',
        content: JSON.stringify({ text: '自重启受理成功' }),
      },
    });
  });

  test('registers slash-command runtime picker message ids for later card action routing', async () => {
    hoisted.createSpy.mockResolvedValueOnce({
      data: { message_id: 'msg-runtime-picker' },
    });
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
        chat_id: 'oc_runtime_picker_chat',
        message_id: 'msg-command',
        create_time: Date.now().toString(),
        message_type: 'text',
        content: JSON.stringify({ text: '/effort' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    expect(hoisted.registerMessageIdMappingSpy).toHaveBeenCalledWith(
      'msg-runtime-picker',
      'feishu:oc_runtime_picker_chat',
    );
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

  test('infers effort picker actions when Feishu omits the element action value', async () => {
    const onCardRuntimeUpdate = vi
      .fn()
      .mockResolvedValue('已将当前工作区思考强度切换为 high');
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
        value: 'high',
      },
      context: {
        open_chat_id: 'runtime-chat',
      },
    });

    expect(onCardRuntimeUpdate).toHaveBeenCalledWith('feishu:runtime-chat', {
      action: 'set_runtime_effort',
      value: 'high',
    });
    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'runtime-chat',
        msg_type: 'interactive',
        content: JSON.stringify({
          schema: '2.0',
          body: {
            text: '已将当前工作区思考强度切换为 high',
          },
        }),
      },
    });
  });

  test('routes SDK-style root open_message_id picker callbacks through message mapping', async () => {
    hoisted.resolveJidByMessageIdSpy.mockReturnValue('feishu:runtime-chat');
    const onCardRuntimeUpdate = vi
      .fn()
      .mockResolvedValue('已将当前工作区思考强度切换为 high');
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCardRuntimeUpdate,
    });

    await hoisted.handlers['card.action.trigger']?.({
      open_message_id: 'msg-runtime-picker',
      action: {
        tag: 'select_static',
        option: 'high',
        value: {
          action: 'set_runtime_effort',
        },
      },
    });

    expect(hoisted.resolveJidByMessageIdSpy).toHaveBeenCalledWith(
      'msg-runtime-picker',
    );
    expect(onCardRuntimeUpdate).toHaveBeenCalledWith('feishu:runtime-chat', {
      action: 'set_runtime_effort',
      value: 'high',
    });
  });

  test('resolves SDK-style card callbacks through Feishu message lookup when in-memory mapping is missing', async () => {
    hoisted.messageGetSpy.mockResolvedValueOnce({
      data: {
        items: [
          {
            message_id: 'msg-runtime-picker',
            chat_id: 'runtime-chat',
          },
        ],
      },
    });
    const onCardRuntimeUpdate = vi
      .fn()
      .mockResolvedValue('已将当前工作区思考强度切换为 high');
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCardRuntimeUpdate,
    });

    await hoisted.handlers['card.action.trigger']?.({
      open_message_id: 'msg-runtime-picker',
      action: {
        tag: 'select_static',
        option: 'high',
        value: {
          action: 'set_runtime_effort',
        },
      },
    });

    expect(hoisted.messageGetSpy).toHaveBeenCalledWith({
      path: { message_id: 'msg-runtime-picker' },
    });
    expect(onCardRuntimeUpdate).toHaveBeenCalledWith('feishu:runtime-chat', {
      action: 'set_runtime_effort',
      value: 'high',
    });
  });
});
