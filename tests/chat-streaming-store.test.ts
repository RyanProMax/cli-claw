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
import { api } from '../web/src/api/client.ts';

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

  test('clears orphaned streaming residue on restore when backend no longer has an active runner', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ groups: [] } as any);
    sessionStorageMock.setItem(
      'hc_streaming',
      JSON.stringify({
        'web:proj-home': {
          partialText: 'stale output',
          activeTools: [],
          recentEvents: [],
          systemStatus: null,
          turnId: 'turn-old',
          runtimeIdentity: null,
          ts: Date.now(),
        },
      }),
    );

    useChatStore.setState((state) => ({
      ...state,
      streaming: {
        'web:proj-home': createStreamingState({
          turnId: 'turn-old',
          partialText: 'stale output',
          interrupted: true,
        }),
      },
      pendingThinking: {
        'web:proj-home': 'stale thinking',
      },
    }));

    await useChatStore.getState().restoreActiveState();

    expect(useChatStore.getState().streaming['web:proj-home']).toBeUndefined();
    expect(useChatStore.getState().waiting['web:proj-home']).toBeUndefined();
    expect(
      useChatStore.getState().pendingThinking['web:proj-home'],
    ).toBeUndefined();
    expect(sessionStorageMock.getItem('hc_streaming')).toBe('{}');
  });

  test('replaces stale local streaming state when reconnect snapshot belongs to a new session', () => {
    useChatStore.setState((state) => ({
      ...state,
      waiting: {
        'web:proj-home': true,
      },
      streaming: {
        'web:proj-home': createStreamingState({
          turnId: 'turn-old',
          sessionId: 'session-old',
          partialText: 'old output',
        }),
      },
    }));

    useChatStore.getState().handleStreamSnapshot('web:proj-home', {
      partialText: 'fresh output',
      activeTools: [],
      recentEvents: [],
      systemStatus: null,
      turnId: 'turn-new',
      sessionId: 'session-new',
      runtimeIdentity: null,
    });

    const next = useChatStore.getState().streaming['web:proj-home'];
    expect(next?.partialText).toBe('fresh output');
    expect(next?.turnId).toBe('turn-new');
    expect(next?.sessionId).toBe('session-new');
  });
});
