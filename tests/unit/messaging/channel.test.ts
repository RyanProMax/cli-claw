import { beforeEach, describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const makeInner = () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(() => true),
    getUpdatesBuf: vi.fn(() => ''),
  });

  return {
    feishuInner: {
      connect: vi.fn().mockResolvedValue(true),
      stop: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendImage: vi.fn().mockResolvedValue(undefined),
      sendFile: vi.fn().mockResolvedValue(undefined),
      sendReaction: vi.fn().mockResolvedValue(undefined),
      clearAckReaction: vi.fn(),
      syncGroups: vi.fn().mockResolvedValue(undefined),
      getChatInfo: vi.fn().mockResolvedValue(null),
      getLarkClient: vi.fn(() => null),
      getLastMessageId: vi.fn(() => undefined),
      isConnected: vi.fn(() => true),
    },
    wechatInner: makeInner(),
  };
});

vi.mock('../../../src/messaging/providers/feishu/index.ts', () => ({
  createFeishuConnection: vi.fn(() => hoisted.feishuInner),
}));

vi.mock('../../../src/messaging/providers/wechat/index.ts', () => ({
  createWeChatConnection: vi.fn(() => hoisted.wechatInner),
}));

import {
  createFeishuChannel,
  createWeChatChannel,
} from '../../../src/messaging/channel.ts';

describe('IM channel footer consumption', () => {
  const connectOpts = {
    onReady: vi.fn(),
    onNewChat: vi.fn(),
  };

  const messageMeta = {
    runtimeIdentity: {
      agentType: 'openai',
      model: 'GPT-5.4',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    },
    tokenUsage: {
      inputTokens: 900,
      outputTokens: 300,
      durationMs: 2_500,
    },
  };

  const expectedText =
    'Hello world\n\n2s | OpenAI | GPT-5.4 | high | standard (1x)';

  beforeEach(() => {
    hoisted.feishuInner.connect.mockReset();
    hoisted.feishuInner.connect.mockResolvedValue(true);
    hoisted.feishuInner.sendMessage.mockReset();
    hoisted.feishuInner.sendMessage.mockResolvedValue(undefined);
    hoisted.wechatInner.connect.mockClear();
    hoisted.wechatInner.sendMessage.mockClear();
  });

  test('feishu forwards runtime card update callbacks to the connection adapter', async () => {
    const onCardRuntimeUpdate = vi.fn().mockResolvedValue('ok');
    const channel = createFeishuChannel({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await channel.connect({
      ...connectOpts,
      onCardRuntimeUpdate,
    } as any);

    expect(hoisted.feishuInner.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        onCardRuntimeUpdate,
      }),
    );
  });

  test('feishu rejects sends before the channel is connected', async () => {
    const channel = createFeishuChannel({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await expect(channel.sendMessage('chat-1', 'hello')).rejects.toThrow(
      'Feishu channel not connected',
    );
    expect(hoisted.feishuInner.sendMessage).not.toHaveBeenCalled();
  });

  test('feishu propagates connection adapter send failures', async () => {
    const channel = createFeishuChannel({
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    await channel.connect(connectOpts as any);
    hoisted.feishuInner.sendMessage.mockRejectedValueOnce(
      new Error('Feishu API failed'),
    );

    await expect(channel.sendMessage('chat-1', 'hello')).rejects.toThrow(
      'Feishu API failed',
    );
  });

  test('feishu forwards footer metadata to the connection adapter', async () => {
    const channel = createFeishuChannel({
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    await channel.connect(connectOpts as any);

    await channel.sendMessage('chat-1', 'Hello world', undefined, messageMeta);

    expect(hoisted.feishuInner.sendMessage).toHaveBeenCalledWith(
      'chat-1',
      'Hello world',
      undefined,
      messageMeta,
    );
  });

  test('wechat appends footer before delegating to the connection', async () => {
    const channel = createWeChatChannel({
      botToken: 'token',
      ilinkBotId: 'bot',
    });
    await channel.connect(connectOpts as any);

    await channel.sendMessage('alice', 'Hello world', undefined, messageMeta);

    expect(hoisted.wechatInner.sendMessage).toHaveBeenCalledWith(
      'alice',
      expectedText,
    );
  });
});
