import { beforeEach, describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getRegisteredGroup: vi.fn((jid: string) =>
    jid === 'wechat:alice'
      ? { created_by: 'user-1', folder: 'home' }
      : null,
  ),
  getJidsByFolder: vi.fn(() => []),
}));

vi.mock('../src/db.js', () => ({
  getRegisteredGroup: hoisted.getRegisteredGroup,
  getJidsByFolder: hoisted.getJidsByFolder,
}));

import { imManager } from '../src/im-manager.ts';

describe('imManager messageMeta forwarding', () => {
  beforeEach(() => {
    (imManager as any).connections = new Map();
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

    (imManager as any).connections.set('user-1', {
      userId: 'user-1',
      channels: new Map([['wechat', fakeChannel]]),
    });

    const messageMeta = {
      turnId: 'turn-1',
      sessionId: 'session-1',
      runtimeIdentity: {
        agentType: 'codex',
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
