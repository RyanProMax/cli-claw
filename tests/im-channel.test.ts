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
    telegramInner: makeInner(),
    qqInner: makeInner(),
    wechatInner: makeInner(),
    dingtalkInner: makeInner(),
  };
});

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
    'Hello world\n\n2.5s | GPT-5.4 | high | 1.2K tokens';

  beforeEach(() => {
    hoisted.telegramInner.connect.mockClear();
    hoisted.telegramInner.sendMessage.mockClear();
    hoisted.qqInner.connect.mockClear();
    hoisted.qqInner.sendMessage.mockClear();
    hoisted.wechatInner.connect.mockClear();
    hoisted.wechatInner.sendMessage.mockClear();
    hoisted.dingtalkInner.connect.mockClear();
    hoisted.dingtalkInner.sendMessage.mockClear();
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
