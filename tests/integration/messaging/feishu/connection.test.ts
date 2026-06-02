import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const handlers: Record<string, (payload: any) => Promise<void> | void> = {};
  const resolveImSlashCommandReplySpy = vi.fn(
    async (
      chatJid: string,
      command: string,
      onCommand?: (
        chatJid: string,
        command: string,
        context?: { triggerMessageId?: string | null },
      ) => Promise<string | null>,
      context?: { triggerMessageId?: string | null },
    ) => ({
      kind: 'reply',
      content: (await onCommand?.(chatJid, command, context)) ?? '',
    }),
  );
  return {
    handlers,
    requestSpy: vi.fn().mockResolvedValue({ bot: { open_id: 'bot-open-id' } }),
    replySpy: vi.fn().mockResolvedValue({}),
    createSpy: vi.fn().mockResolvedValue({}),
    messageGetSpy: vi.fn(),
    messageListSpy: vi.fn().mockResolvedValue({ data: { items: [] } }),
    chatGetSpy: vi.fn().mockResolvedValue({ data: null }),
    reactionCreateSpy: vi
      .fn()
      .mockResolvedValue({ data: { reaction_id: 'r1' } }),
    reactionDeleteSpy: vi.fn().mockResolvedValue({}),
    resolveJidByMessageIdSpy: vi.fn(),
    registerMessageIdMappingSpy: vi.fn(),
    abortStreamingSessionsForChatJidSpy: vi.fn(),
    getStreamingSessionSpy: vi.fn(() => null),
    wsStartSpy: vi.fn().mockResolvedValue(undefined),
    wsCloseSpy: vi.fn().mockResolvedValue(undefined),
    wsReadyState: 1,
    wsNextConnectTime: 0,
    wsIsConnecting: false,
    onReadySpy: vi.fn(),
    resolveImSlashCommandReplySpy,
  };
});

vi.mock('@larksuiteoapi/node-sdk', () => {
  class MockClient {
    request = hoisted.requestSpy;
    im = {
      messageReaction: {
        create: hoisted.reactionCreateSpy,
        delete: hoisted.reactionDeleteSpy,
      },
      message: {
        reply: hoisted.replySpy,
      },
      v1: {
        message: {
          create: hoisted.createSpy,
          get: hoisted.messageGetSpy,
          list: hoisted.messageListSpy,
        },
        chat: {
          get: hoisted.chatGetSpy,
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
    wsConfig = {
      getWSInstance: () => ({ readyState: hoisted.wsReadyState }),
    };

    get isConnecting() {
      return hoisted.wsIsConnecting;
    }

    getReconnectInfo() {
      return { nextConnectTime: hoisted.wsNextConnectTime };
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

vi.mock('../../../../src/storage/db.js', () => ({
  getImMessageLifecycleEvents: vi.fn(() => []),
  getMessage: vi.fn(() => null),
  recordImMessageLifecycleEvent: vi.fn(),
  setLastGroupSync: vi.fn(),
  storeChatMetadata: vi.fn(),
  storeMessageDirect: vi.fn(),
  updateChatName: vi.fn(),
}));

vi.mock('../../../../src/messaging/downloader.js', () => ({
  saveDownloadedFile: vi.fn(),
  MAX_FILE_SIZE: 1024 * 1024,
  FileTooLargeError: class FileTooLargeError extends Error {},
}));

vi.mock('../../../../src/messaging/notifier.js', () => ({
  notifyNewImMessage: vi.fn(),
}));

vi.mock('../../../../src/web/app.js', () => ({
  broadcastNewMessage: vi.fn(),
}));

vi.mock('../../../../src/messaging/image-detector.js', () => ({
  detectImageMimeType: vi.fn(),
}));

vi.mock('../../../../src/messaging/slash-command.js', () => ({
  resolveImSlashCommandReply: hoisted.resolveImSlashCommandReplySpy,
}));

vi.mock('../../../../src/messaging/providers/feishu/streaming-card.js', () => ({
  buildStaticReplyCard: vi.fn((text: string, _options?: unknown) => ({
    schema: '2.0',
    body: { text },
  })),
  abortStreamingSessionsForChatJid: hoisted.abortStreamingSessionsForChatJidSpy,
  resolveJidByMessageId: hoisted.resolveJidByMessageIdSpy,
  registerMessageIdMapping: hoisted.registerMessageIdMappingSpy,
  getStreamingSession: hoisted.getStreamingSessionSpy,
}));

vi.mock('../../../../src/messaging/providers/feishu/markdown-style.js', () => ({
  optimizeMarkdownStyle: vi.fn((text: string) => text),
}));

import { createFeishuConnection } from '../../../../src/messaging/providers/feishu/index.ts';
import { buildStaticReplyCard } from '../../../../src/messaging/providers/feishu/streaming-card.js';
import {
  getImMessageLifecycleEvents,
  getMessage,
  recordImMessageLifecycleEvent,
  storeMessageDirect,
} from '../../../../src/storage/db.js';
import { notifyNewImMessage } from '../../../../src/messaging/notifier.js';
import { broadcastNewMessage } from '../../../../src/web/app.js';
import { resolveManagedSelfRestartCommand } from '../../../../shared/service-restart-guard.ts';

const PREBUILT_CARD_WRAPPER = JSON.stringify({
  type: 'interactive',
  card: {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      summary: { content: '配置 OpenAI' },
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
    hoisted.createSpy.mockReset();
    hoisted.createSpy.mockResolvedValue({});
    hoisted.messageGetSpy.mockReset();
    hoisted.messageListSpy.mockReset();
    hoisted.messageListSpy.mockResolvedValue({ data: { items: [] } });
    hoisted.chatGetSpy.mockReset();
    hoisted.chatGetSpy.mockResolvedValue({ data: null });
    hoisted.reactionCreateSpy.mockClear();
    hoisted.reactionDeleteSpy.mockClear();
    hoisted.resolveJidByMessageIdSpy.mockReset();
    hoisted.registerMessageIdMappingSpy.mockClear();
    hoisted.abortStreamingSessionsForChatJidSpy.mockReset();
    hoisted.getStreamingSessionSpy.mockReset();
    hoisted.getStreamingSessionSpy.mockReturnValue(null);
    hoisted.wsStartSpy.mockClear();
    hoisted.wsCloseSpy.mockClear();
    hoisted.wsReadyState = 1;
    hoisted.wsNextConnectTime = 0;
    hoisted.wsIsConnecting = false;
    hoisted.onReadySpy.mockClear();
    hoisted.resolveImSlashCommandReplySpy.mockClear();
    vi.mocked(buildStaticReplyCard).mockClear();
    vi.mocked(getImMessageLifecycleEvents).mockReset();
    vi.mocked(getImMessageLifecycleEvents).mockReturnValue([]);
    vi.mocked(getMessage).mockReset();
    vi.mocked(getMessage).mockReturnValue(null);
    vi.mocked(recordImMessageLifecycleEvent).mockClear();
    vi.mocked(storeMessageDirect).mockClear();
    vi.mocked(notifyNewImMessage).mockClear();
    vi.mocked(broadcastNewMessage).mockClear();
    Object.keys(hoisted.handlers).forEach(
      (key) => delete hoisted.handlers[key],
    );
  });

  afterEach(() => {
    vi.useRealTimers();
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

  test('adds assistant meta footer to static reply cards', async () => {
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    const runtimeIdentity = {
      agentType: 'openai' as const,
      model: 'GPT-5.5',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    };

    await connection.connect({
      onReady: hoisted.onReadySpy,
    });

    await connection.sendMessage('chat-footer', '最终回复', undefined, {
      runtimeIdentity,
      tokenUsage: {
        inputTokens: 900,
        outputTokens: 300,
        durationMs: 2_500,
      },
      routeFooter: 'HK IPO（主线） | 09:42',
    });

    expect(buildStaticReplyCard).toHaveBeenCalledWith('最终回复', {
      footerNote:
        '2s | OpenAI | GPT-5.5 | high | standard (1x) | HK IPO（主线） | 09:42',
      runtimeIdentity,
    });
    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: expect.objectContaining({
        receive_id: 'chat-footer',
        msg_type: 'interactive',
      }),
    });
  });

  test('keeps assistant meta footer when static card delivery falls back to post markdown', async () => {
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
    });

    hoisted.createSpy
      .mockRejectedValueOnce(new Error('interactive failed'))
      .mockResolvedValueOnce({});

    await connection.sendMessage(
      'chat-footer-fallback',
      '最终回复',
      undefined,
      {
        runtimeIdentity: {
          agentType: 'openai',
          model: 'GPT-5.5',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
        tokenUsage: {
          durationMs: 2_500,
        },
        routeFooter: 'HK IPO（主线） | 09:42',
      },
    );

    expect(hoisted.createSpy).toHaveBeenLastCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'chat-footer-fallback',
        msg_type: 'post',
        content: JSON.stringify({
          zh_cn: {
            content: [
              [
                {
                  tag: 'md',
                  text: '最终回复\n\n2s | OpenAI | GPT-5.5 | high | standard (1x) | HK IPO（主线） | 09:42',
                },
              ],
            ],
          },
        }),
      },
    });
  });

  test('rejects when both interactive card delivery and post fallback fail', async () => {
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
    });

    hoisted.createSpy
      .mockRejectedValueOnce(new Error('interactive failed'))
      .mockRejectedValueOnce(new Error('post fallback failed'));

    await expect(connection.sendMessage('chat-fail', 'hello')).rejects.toThrow(
      'post fallback failed',
    );

    expect(hoisted.createSpy).toHaveBeenCalledTimes(2);
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
        content: JSON.stringify({ text: '/openai' }),
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

  test('marks slash-command assistant prompt rewrites as isolated assistant prompts', async () => {
    hoisted.resolveImSlashCommandReplySpy.mockResolvedValueOnce({
      kind: 'rewrite_message',
      content: '请分析当前港股 IPO 池',
      sourceKind: 'assistant_prompt',
    });
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCommand: async () => null,
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_command_chat',
        message_id: 'msg-hkipo',
        create_time: Date.now().toString(),
        message_type: 'text',
        content: JSON.stringify({ text: '/hkipo' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    expect(storeMessageDirect).toHaveBeenCalledWith(
      'msg-hkipo',
      'feishu:oc_command_chat',
      'user-open-id',
      'user-open-id',
      '请分析当前港股 IPO 池',
      expect.any(String),
      false,
      {
        attachments: undefined,
        sourceJid: 'feishu:oc_command_chat',
        meta: { sourceKind: 'assistant_prompt' },
      },
    );
    expect(broadcastNewMessage).toHaveBeenCalledWith(
      'feishu:oc_command_chat',
      expect.objectContaining({ source_kind: 'assistant_prompt' }),
      undefined,
    );
  });

  test('persists Feishu slash commands and immediate replies for web history', async () => {
    const onCommand = vi.fn().mockResolvedValue('🚀 已启动工作流 hkipo');
    hoisted.createSpy.mockResolvedValueOnce({
      data: { message_id: 'msg-hkipo-reply' },
    });
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCommand,
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_command_chat',
        message_id: 'msg-hkipo-command',
        create_time: '1780232946873',
        message_type: 'text',
        content: JSON.stringify({ text: '/hkipo' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    expect(onCommand).toHaveBeenCalledWith(
      'feishu:oc_command_chat',
      'hkipo',
      expect.objectContaining({
        triggerMessageId: 'msg-hkipo-command',
      }),
    );
    expect(storeMessageDirect).toHaveBeenCalledWith(
      'msg-hkipo-command',
      'feishu:oc_command_chat',
      'user-open-id',
      'user-open-id',
      '/hkipo',
      '2026-05-31T13:09:06.873Z',
      false,
      {
        attachments: undefined,
        sourceJid: 'feishu:oc_command_chat',
        meta: { sourceKind: 'user_command' },
      },
    );
    expect(broadcastNewMessage).toHaveBeenCalledWith(
      'feishu:oc_command_chat',
      expect.objectContaining({
        id: 'msg-hkipo-command',
        content: '/hkipo',
        source_kind: 'user_command',
      }),
      undefined,
    );
    expect(storeMessageDirect).toHaveBeenCalledWith(
      'msg-hkipo-reply',
      'feishu:oc_command_chat',
      'cli-claw-agent',
      expect.any(String),
      '🚀 已启动工作流 hkipo',
      expect.any(String),
      true,
      {
        sourceJid: 'feishu:oc_command_chat',
      },
    );
    expect(broadcastNewMessage).toHaveBeenCalledWith(
      'feishu:oc_command_chat',
      expect.objectContaining({
        id: 'msg-hkipo-reply',
        content: '🚀 已启动工作流 hkipo',
        is_from_me: true,
      }),
      undefined,
    );
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

  test('stores mocked Feishu continuation messages instead of routing them as restart commands', async () => {
    const onCommand = vi.fn().mockResolvedValue('自重启受理成功');
    const resolveManagedCommandText = vi.fn((_chatJid: string, text: string) =>
      resolveManagedSelfRestartCommand(text),
    );
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
        chat_id: 'oc_98f0bb60f284627bf20f9386704f8c82',
        message_id: 'om_x100b51ee3e1b50acb3b0af6442e5761',
        create_time: Date.now().toString(),
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

    expect(resolveManagedCommandText).toHaveBeenCalledWith(
      'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      '继续任务 -',
    );
    expect(onCommand).not.toHaveBeenCalled();
    expect(storeMessageDirect).toHaveBeenCalledWith(
      'om_x100b51ee3e1b50acb3b0af6442e5761',
      'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      'ou_c9410c372b8283aacad4b2844c5e401b',
      'ou_c9410c372b8283aacad4b2844c5e401b',
      '继续任务 -',
      expect.any(String),
      false,
      {
        attachments: undefined,
        sourceJid: 'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      },
    );
    expect(notifyNewImMessage).toHaveBeenCalled();
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
        content: JSON.stringify({ text: '/openai' }),
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

  test('aborts all streaming sessions for the same chat when a new message is accepted', async () => {
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_same_chat',
        message_id: 'msg-next',
        create_time: Date.now().toString(),
        message_type: 'text',
        content: JSON.stringify({ text: '继续看这个问题' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    expect(hoisted.abortStreamingSessionsForChatJidSpy).toHaveBeenCalledWith(
      'feishu:oc_same_chat',
      '新的回复已开始',
    );
  });

  test('records lifecycle events for accepted inbound Feishu messages', async () => {
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_lifecycle',
        message_id: 'msg-lifecycle',
        create_time: Date.now().toString(),
        message_type: 'text',
        content: JSON.stringify({ text: 'ping lifecycle' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    expect(
      vi
        .mocked(recordImMessageLifecycleEvent)
        .mock.calls.map(([event]) => event.stage),
    ).toEqual(['received', 'stored', 'notified']);
    expect(recordImMessageLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'feishu',
        chatJid: 'feishu:oc_lifecycle',
        sourceJid: 'feishu:oc_lifecycle',
        messageId: 'msg-lifecycle',
        stage: 'received',
        status: 'ok',
        details: expect.objectContaining({
          source: 'ws',
          messageType: 'text',
          chatType: 'p2p',
        }),
      }),
    );
    expect(recordImMessageLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'feishu',
        chatJid: 'feishu:oc_lifecycle',
        sourceJid: 'feishu:oc_lifecycle',
        messageId: 'msg-lifecycle',
        stage: 'stored',
        status: 'ok',
        details: expect.objectContaining({
          targetJid: 'feishu:oc_lifecycle',
        }),
      }),
    );
    expect(recordImMessageLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'feishu',
        chatJid: 'feishu:oc_lifecycle',
        sourceJid: 'feishu:oc_lifecycle',
        messageId: 'msg-lifecycle',
        stage: 'notified',
        status: 'ok',
      }),
    );
  });

  test('backfills startup-window messages for known chats on initial connect', async () => {
    const startupThreshold = Date.now() - 5_000;
    const liveIgnoreThreshold = startupThreshold + 2_000;
    hoisted.messageListSpy.mockResolvedValueOnce({
      data: {
        items: [
          {
            message_id: 'msg-startup-backfill',
            create_time: String(startupThreshold + 1_000),
            msg_type: 'text',
            body: {
              content: JSON.stringify({ text: 'restart window message' }),
            },
            chat_type: 'p2p',
            sender: {
              sender_id: {
                open_id: 'user-open-id',
              },
            },
          },
        ],
      },
    });

    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      ignoreMessagesBefore: liveIgnoreThreshold,
      startupBackfillIgnoreMessagesBefore: startupThreshold,
      startupBackfillChatIds: ['startup-chat'] as any,
    } as any);

    expect(hoisted.messageListSpy).toHaveBeenCalledWith({
      params: expect.objectContaining({
        container_id: 'startup-chat',
      }),
    });
    expect(storeMessageDirect).toHaveBeenCalledWith(
      'msg-startup-backfill',
      'feishu:startup-chat',
      'user-open-id',
      'user-open-id',
      'restart window message',
      expect.any(String),
      false,
      { attachments: undefined, sourceJid: 'feishu:startup-chat' },
    );
    expect(notifyNewImMessage).toHaveBeenCalled();
  });

  test('resolves private chat type during backfill when message list omits chat_type', async () => {
    const startupThreshold = Date.now() - 5_000;
    hoisted.chatGetSpy.mockResolvedValueOnce({
      data: {
        name: '',
        chat_mode: 'p2p',
        chat_type: '',
      },
    });
    hoisted.messageListSpy.mockResolvedValueOnce({
      data: {
        items: [
          {
            message_id: 'msg-backfill-p2p',
            create_time: String(startupThreshold + 1_000),
            msg_type: 'text',
            body: {
              content: JSON.stringify({ text: 'private restart message' }),
            },
            sender: {
              sender_id: {
                open_id: 'user-open-id',
              },
            },
          },
        ],
      },
    });

    const onNewChat = vi.fn();
    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onNewChat,
      ignoreMessagesBefore: startupThreshold,
      startupBackfillIgnoreMessagesBefore: startupThreshold,
      startupBackfillChatIds: ['startup-private-chat'] as any,
    } as any);

    expect(hoisted.chatGetSpy).toHaveBeenCalledWith({
      path: { chat_id: 'startup-private-chat' },
    });
    expect(onNewChat).toHaveBeenCalledWith(
      'feishu:startup-private-chat',
      '飞书私聊',
    );
    expect(recordImMessageLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'feishu',
        chatJid: 'feishu:startup-private-chat',
        messageId: 'msg-backfill-p2p',
        stage: 'received',
        details: expect.objectContaining({
          source: 'backfill',
          chatType: 'p2p',
        }),
      }),
    );
  });

  test('does not let a stale live ws message suppress startup backfill', async () => {
    const startupThreshold = Date.now() - 5_000;
    const liveIgnoreThreshold = startupThreshold + 2_000;
    const sharedMessage = {
      chat_id: 'startup-chat',
      message_id: 'msg-stale-overlap',
      create_time: String(startupThreshold + 1_000),
      message_type: 'text',
      content: JSON.stringify({ text: 'restart window message' }),
      chat_type: 'p2p',
    };
    hoisted.wsStartSpy.mockImplementationOnce(async () => {
      await hoisted.handlers['im.message.receive_v1']?.({
        message: sharedMessage,
        sender: {
          sender_id: {
            open_id: 'user-open-id',
          },
        },
      });
    });
    hoisted.messageListSpy.mockResolvedValueOnce({
      data: {
        items: [
          {
            message_id: 'msg-stale-overlap',
            create_time: sharedMessage.create_time,
            msg_type: 'text',
            body: {
              content: sharedMessage.content,
            },
            chat_type: 'p2p',
            sender: {
              sender_id: {
                open_id: 'user-open-id',
              },
            },
          },
        ],
      },
    });

    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      ignoreMessagesBefore: liveIgnoreThreshold,
      startupBackfillIgnoreMessagesBefore: startupThreshold,
      startupBackfillChatIds: ['startup-chat'] as any,
    } as any);

    expect(hoisted.messageListSpy).toHaveBeenCalledTimes(1);
    expect(storeMessageDirect).toHaveBeenCalledTimes(1);
    expect(storeMessageDirect).toHaveBeenCalledWith(
      'msg-stale-overlap',
      'feishu:startup-chat',
      'user-open-id',
      'user-open-id',
      'restart window message',
      expect.any(String),
      false,
      { attachments: undefined, sourceJid: 'feishu:startup-chat' },
    );
    expect(notifyNewImMessage).toHaveBeenCalledTimes(1);
  });

  test('retires unavailable startup backfill chats and continues with other chats', async () => {
    const startupThreshold = Date.now() - 5_000;
    const onBotRemovedFromGroup = vi.fn();
    hoisted.messageListSpy
      .mockRejectedValueOnce({
        response: {
          data: {
            code: 230002,
            msg: 'Bot/User can NOT be out of the chat.',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              message_id: 'msg-active-backfill',
              create_time: String(startupThreshold + 1_000),
              msg_type: 'text',
              body: {
                content: JSON.stringify({ text: 'active chat message' }),
              },
              chat_type: 'p2p',
              sender: {
                sender_id: {
                  open_id: 'user-open-id',
                },
              },
            },
          ],
        },
      });

    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      startupBackfillIgnoreMessagesBefore: startupThreshold,
      startupBackfillChatIds: ['stale-chat', 'active-chat'] as any,
      onBotRemovedFromGroup,
    } as any);

    expect(onBotRemovedFromGroup).toHaveBeenCalledWith('feishu:stale-chat');
    expect(hoisted.messageListSpy).toHaveBeenNthCalledWith(1, {
      params: expect.objectContaining({
        container_id: 'stale-chat',
      }),
    });
    expect(hoisted.messageListSpy).toHaveBeenNthCalledWith(2, {
      params: expect.objectContaining({
        container_id: 'active-chat',
      }),
    });
    expect(storeMessageDirect).toHaveBeenCalledWith(
      'msg-active-backfill',
      'feishu:active-chat',
      'user-open-id',
      'user-open-id',
      'active chat message',
      expect.any(String),
      false,
      { attachments: undefined, sourceJid: 'feishu:active-chat' },
    );
    expect(notifyNewImMessage).toHaveBeenCalledTimes(1);
  });

  test('dedupes startup backfill against a message already delivered by live ws during connect', async () => {
    const startupThreshold = Date.now() - 5_000;
    const sharedMessage = {
      chat_id: 'startup-chat',
      message_id: 'msg-overlap',
      create_time: String(startupThreshold + 1_000),
      message_type: 'text',
      content: JSON.stringify({ text: 'overlap message' }),
      chat_type: 'p2p',
    };
    hoisted.wsStartSpy.mockImplementationOnce(async () => {
      await hoisted.handlers['im.message.receive_v1']?.({
        message: sharedMessage,
        sender: {
          sender_id: {
            open_id: 'user-open-id',
          },
        },
      });
    });
    hoisted.messageListSpy.mockResolvedValueOnce({
      data: {
        items: [
          {
            message_id: 'msg-overlap',
            create_time: sharedMessage.create_time,
            msg_type: 'text',
            body: {
              content: sharedMessage.content,
            },
            chat_type: 'p2p',
            sender: {
              sender_id: {
                open_id: 'user-open-id',
              },
            },
          },
        ],
      },
    });

    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      ignoreMessagesBefore: startupThreshold,
      startupBackfillChatIds: ['startup-chat'] as any,
    } as any);

    expect(hoisted.messageListSpy).toHaveBeenCalledTimes(1);
    expect(storeMessageDirect).toHaveBeenCalledTimes(1);
    expect(notifyNewImMessage).toHaveBeenCalledTimes(1);
    expect(broadcastNewMessage).toHaveBeenCalledTimes(1);
    expect(hoisted.reactionCreateSpy).toHaveBeenCalledTimes(1);
  });

  test('skips persisted backfill duplicates before invoking slash commands', async () => {
    const startupThreshold = Date.now() - 5_000;
    hoisted.messageListSpy.mockResolvedValueOnce({
      data: {
        items: [
          {
            message_id: 'msg-backfill-duplicate-slash',
            create_time: String(startupThreshold + 1_000),
            msg_type: 'text',
            body: {
              content: JSON.stringify({ text: '/hkipo' }),
            },
            chat_type: 'p2p',
            sender: {
              sender_id: {
                open_id: 'user-open-id',
              },
            },
          },
        ],
      },
    });
    vi.mocked(getImMessageLifecycleEvents).mockReturnValue([
      {
        id: 1,
        provider: 'feishu',
        chatJid: 'feishu:startup-chat',
        sourceJid: 'feishu:startup-chat',
        messageId: 'msg-backfill-duplicate-slash',
        stage: 'skipped',
        status: 'skipped',
        reason: 'duplicate',
        details: { source: 'backfill' },
        createdAt: new Date(startupThreshold).toISOString(),
      },
    ] as any);
    const onCommand = vi.fn().mockResolvedValue('ack');

    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCommand,
      startupBackfillIgnoreMessagesBefore: startupThreshold,
      startupBackfillChatIds: ['startup-chat'] as any,
    } as any);

    expect(onCommand).not.toHaveBeenCalled();
    expect(hoisted.createSpy).not.toHaveBeenCalled();
    expect(storeMessageDirect).not.toHaveBeenCalled();
    expect(notifyNewImMessage).not.toHaveBeenCalled();
  });

  test('backfills known chats while websocket remains offline awaiting sdk reconnect', async () => {
    vi.useFakeTimers();
    const baseTime = Date.parse('2026-06-02T12:20:00.000Z');
    vi.setSystemTime(baseTime);
    const onCommand = vi.fn().mockResolvedValue('🚀 已启动工作流 kol');

    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
      onCommand,
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_offline_chat',
        message_id: 'msg-before-offline',
        create_time: String(baseTime - 10_000),
        message_type: 'text',
        content: JSON.stringify({ text: 'before offline' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    hoisted.messageListSpy.mockResolvedValueOnce({
      data: {
        items: [
          {
            message_id: 'msg-offline-backfill',
            create_time: String(baseTime + 1_000),
            msg_type: 'text',
            body: {
              content: JSON.stringify({ text: '/kol' }),
            },
            chat_type: 'p2p',
            sender: {
              sender_id: {
                open_id: 'user-open-id',
              },
            },
          },
        ],
      },
    });
    hoisted.wsReadyState = 3;
    hoisted.wsIsConnecting = true;
    hoisted.wsNextConnectTime = baseTime + 10 * 60 * 1000;

    await vi.advanceTimersByTimeAsync(15_000);

    expect(hoisted.wsCloseSpy).not.toHaveBeenCalled();
    expect(hoisted.messageListSpy).toHaveBeenCalledWith({
      params: expect.objectContaining({
        container_id: 'oc_offline_chat',
      }),
    });
    expect(onCommand).toHaveBeenCalledWith(
      'feishu:oc_offline_chat',
      'kol',
      expect.objectContaining({
        triggerMessageId: 'msg-offline-backfill',
      }),
    );

    await connection.stop();
  });

  test('clears every pending ack reaction when multiple requests arrive before reply delivery', async () => {
    hoisted.reactionCreateSpy
      .mockResolvedValueOnce({ data: { reaction_id: 'ack-1' } })
      .mockResolvedValueOnce({ data: { reaction_id: 'ack-2' } });

    const connection = createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: hoisted.onReadySpy,
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_ack_chat',
        message_id: 'msg-1',
        create_time: Date.now().toString(),
        message_type: 'text',
        content: JSON.stringify({ text: '第一条请求' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_ack_chat',
        message_id: 'msg-2',
        create_time: (Date.now() + 1).toString(),
        message_type: 'text',
        content: JSON.stringify({ text: '第二条请求' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'user-open-id',
        },
      },
    });

    await connection.sendMessage('oc_ack_chat', '最终回复');

    expect(hoisted.reactionDeleteSpy).toHaveBeenCalledWith({
      path: { message_id: 'msg-1', reaction_id: 'ack-1' },
    });
    expect(hoisted.reactionDeleteSpy).toHaveBeenCalledWith({
      path: { message_id: 'msg-2', reaction_id: 'ack-2' },
    });
  });

  test.each([
    {
      action: 'set_runtime_model',
      option: 'gpt-5.4-mini',
      reply: '已将当前工作区模型切换为 gpt-5.4-mini',
    },
    {
      action: 'set_runtime_effort',
      option: 'xhigh',
      reply: '已将当前工作区思考强度切换为 xhigh',
    },
    {
      action: 'set_runtime_speed',
      option: 'fast',
      reply: '已将当前工作区速度切换为 fast',
    },
  ])(
    'normalizes Feishu select_static runtime picker action $action',
    async ({ action, option, reply }) => {
      const onCardRuntimeUpdate = vi.fn().mockResolvedValue(reply);
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
          option,
          value: { action },
        },
        context: {
          open_chat_id: 'runtime-chat',
        },
      });

      expect(onCardRuntimeUpdate).toHaveBeenCalledWith('feishu:runtime-chat', {
        action,
        value: option,
      });
      expect(hoisted.createSpy).toHaveBeenCalledWith({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: 'runtime-chat',
          msg_type: 'interactive',
          content: JSON.stringify({
            schema: '2.0',
            body: {
              text: reply,
            },
          }),
        },
      });
    },
  );

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
