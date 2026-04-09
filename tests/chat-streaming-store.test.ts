import { beforeEach, describe, expect, test, vi } from 'vitest';

const { sessionStorageMock, flushAnimationFrames } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const animationFrames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  const sessionStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };

  Object.defineProperty(globalThis, 'sessionStorage', {
    value: sessionStorageMock,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      animationFrames.set(frameId, callback);
      return frameId;
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: (frameId: number) => {
      animationFrames.delete(frameId);
    },
    configurable: true,
  });

  return {
    sessionStorageMock,
    flushAnimationFrames: () => {
      for (const [frameId, callback] of [...animationFrames.entries()]) {
        animationFrames.delete(frameId);
        callback(0);
      }
    },
  };
});

vi.mock('../web/src/api/client.ts', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  apiFetch: vi.fn(),
}));

vi.mock('../web/src/api/ws.ts', () => ({
  wsManager: {
    on: vi.fn(() => () => {}),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => false),
    send: vi.fn(() => false),
  },
}));

import { useChatStore, type StreamingState } from '../web/src/stores/chat.ts';

function createStreamingState(
  overrides: Partial<StreamingState> = {},
): StreamingState {
  return {
    turnId: overrides.turnId,
    sessionId: overrides.sessionId,
    runtimeIdentity: overrides.runtimeIdentity ?? null,
    tokenUsage: overrides.tokenUsage,
    partialText: overrides.partialText ?? '',
    thinkingText: overrides.thinkingText ?? '',
    isThinking: overrides.isThinking ?? false,
    activeTools: overrides.activeTools ?? [],
    activeHook: overrides.activeHook ?? null,
    systemStatus: overrides.systemStatus ?? null,
    recentEvents: overrides.recentEvents ?? [],
    todos: overrides.todos,
    interrupted: overrides.interrupted,
  };
}

describe('chat streaming store', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    useChatStore.setState(useChatStore.getInitialState());
  });

  test('resets buffered text deltas when a new turn starts', () => {
    useChatStore.setState((state) => ({
      ...state,
      streaming: {
        'web:proj-home': createStreamingState({
          turnId: 'turn-old',
          sessionId: 'session-old',
          partialText: 'old output',
        }),
      },
      waiting: {
        'web:proj-home': false,
      },
    }));

    useChatStore.getState().handleStreamEvent('web:proj-home', {
      eventType: 'text_delta',
      text: 'new output',
      turnId: 'turn-new',
      sessionId: 'session-new',
    });
    flushAnimationFrames();

    const next = useChatStore.getState().streaming['web:proj-home'];
    expect(next?.partialText).toBe('new output');
    expect(next?.turnId).toBe('turn-new');
    expect(next?.sessionId).toBe('session-new');
  });
});
