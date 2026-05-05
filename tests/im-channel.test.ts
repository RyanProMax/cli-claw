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
    telegramInner: makeInner(),
    qqInner: makeInner(),
    wechatInner: makeInner(),
    dingtalkInner: makeInner(),
  };
});

vi.mock('../src/feishu.ts', () => ({
  createFeishuConnection: vi.fn(() => hoisted.feishuInner),
}));

vi.mock('../src/telegram.ts', () => ({
  createTelegramConnection: vi.fn(() => hoisted.telegramInner),
}));

vi.mock('../src/qq.ts', () => ({
  createQQConnection: vi.fn(() => hoisted.qqInner),
}));

vi.mock('../src/wechat.ts', () => ({
  createWeChatConnection: vi.fn(() => hoisted.wechatInner),
}));

vi.mock('../src/dingtalk.ts', () => ({
  createDingTalkConnection: vi.fn(() => hoisted.dingtalkInner),
}));

import {
  createFeishuChannel,
  createDingTalkChannel,
  createQQChannel,
  createTelegramChannel,
  createWeChatChannel,
} from '../src/im-channel.ts';

describe('IM channel footer consumption', () => {
  const connectOpts = {
    onReady: vi.fn(),
    onNewChat: vi.fn(),
  };

  const messageMeta = {
    runtimeIdentity: {
      agentType: 'codex',
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
    'Hello world\n\n2s | Codex | GPT-5.4 | high | standard (1x)';

  beforeEach(() => {
    hoisted.feishuInner.connect.mockReset();
    hoisted.feishuInner.connect.mockResolvedValue(true);
    hoisted.feishuInner.sendMessage.mockReset();
    hoisted.feishuInner.sendMessage.mockResolvedValue(undefined);
    hoisted.telegramInner.connect.mockClear();
    hoisted.telegramInner.sendMessage.mockClear();
    hoisted.qqInner.connect.mockClear();
    hoisted.qqInner.sendMessage.mockClear();
    hoisted.wechatInner.connect.mockClear();
    hoisted.wechatInner.sendMessage.mockClear();
    hoisted.dingtalkInner.connect.mockClear();
    hoisted.dingtalkInner.sendMessage.mockClear();
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

  test('telegram appends footer before delegating to the connection', async () => {
    const channel = createTelegramChannel({ botToken: 'token' });
    await channel.connect(connectOpts as any);

    await channel.sendMessage('123', 'Hello world', undefined, messageMeta);

    expect(hoisted.telegramInner.sendMessage).toHaveBeenCalledWith(
      '123',
      expectedText,
      undefined,
    );
  });

  test('qq appends footer before delegating to the connection', async () => {
    const channel = createQQChannel({ appId: 'app', appSecret: 'secret' });
    await channel.connect(connectOpts as any);

    await channel.sendMessage('group:123', 'Hello world', undefined, messageMeta);

    expect(hoisted.qqInner.sendMessage).toHaveBeenCalledWith(
      'group:123',
      expectedText,
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

  test('dingtalk appends footer before delegating to the connection', async () => {
    const channel = createDingTalkChannel({
      clientId: 'client',
      clientSecret: 'secret',
    });
    await channel.connect(connectOpts as any);

    await channel.sendMessage('group:123', 'Hello world', undefined, messageMeta);

    expect(hoisted.dingtalkInner.sendMessage).toHaveBeenCalledWith(
      'group:123',
      expectedText,
    );
  });
});
