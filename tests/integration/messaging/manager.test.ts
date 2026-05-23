import { beforeEach, describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getRegisteredGroup: vi.fn(),
  getJidsByFolder: vi.fn(),
}));

vi.mock('../../../src/storage/db.js', () => ({
  getRegisteredGroup: hoisted.getRegisteredGroup,
  getJidsByFolder: hoisted.getJidsByFolder,
}));

import { imManager } from '../../../src/messaging/manager.ts';

describe('imManager messageMeta forwarding', () => {
  beforeEach(() => {
    (imManager as any).channels = new Map();
    hoisted.getRegisteredGroup.mockClear();
    hoisted.getJidsByFolder.mockClear();
  });

  test('forwards messageMeta to the resolved IM channel', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const fakeChannel = {
      channelType: 'wechat',
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendMessage,
      setTyping: vi.fn(),
      isConnected: vi.fn(() => true),
    };

    (imManager as any).channels.set('wechat', fakeChannel);

    const messageMeta = {
      turnId: 'turn-1',
      sessionId: 'session-1',
      runtimeIdentity: {
        agentType: 'openai',
        model: 'GPT-5.4',
        reasoningEffort: 'high',
        supportsReasoningEffort: true,
      },
      tokenUsage: {
        inputTokens: 120,
        outputTokens: 30,
        durationMs: 800,
      },
    };

    await imManager.sendMessage('wechat:alice', 'hello', undefined, messageMeta);

    expect(sendMessage).toHaveBeenCalledWith(
      'alice',
      'hello',
      undefined,
      messageMeta,
    );
  });
});
