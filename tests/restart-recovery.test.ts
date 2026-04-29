import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];
const runnerMocks = vi.hoisted(() => ({
  runHostAgent: vi.fn(),
  runContainerAgent: vi.fn(),
  writeGroupsSnapshot: vi.fn(),
  writeTasksSnapshot: vi.fn(),
}));
const imMocks = vi.hoisted(() => {
  const sessions: Array<{
    currentMessageId: string;
    appended: string[];
    commentary: string[];
    thinking: string[];
    finalText?: string;
    abortReason?: string;
    active: boolean;
    isActive: () => boolean;
    setRuntimeIdentity: (identity: unknown) => void;
    append: (text: string) => void;
    appendCommentary: (text: string) => void;
    appendThinking: (text: string) => void;
    setThinking: () => void;
    startTool: (id: string, name: string) => void;
    getToolInfo: (id: string) => { name: string } | undefined;
    endTool: (id: string) => void;
    pushRecentEvent: (text: string) => void;
    updateToolSummary: (id: string, summary: string) => void;
    setSystemStatus: (text: string) => void;
    setHook: (hook: unknown) => void;
    setTodos: (todos: unknown) => void;
    patchUsageNote: (usage: unknown) => void;
    complete: (text: string) => Promise<void>;
    fail: (text: string) => Promise<void>;
    abort: (reason?: string) => Promise<void>;
    dispose: () => void;
    getAllMessageIds: () => string[];
  }> = [];
  return {
    sessions,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    setTyping: vi.fn().mockResolvedValue(undefined),
    clearAckReaction: vi.fn(),
    isChannelAvailableForJid: vi.fn(() => true),
    createStreamingSession: vi.fn(
      (jid: string, onCardCreated?: (messageId: string) => void) => {
        if (!jid.startsWith('feishu:')) return undefined;
        const session = {
          currentMessageId: `card-${sessions.length + 1}`,
          appended: [] as string[],
          commentary: [] as string[],
          thinking: [] as string[],
          active: true,
          isActive() {
            return this.active;
          },
          setRuntimeIdentity() {},
          append(text: string) {
            this.appended.push(text);
          },
          appendCommentary(text: string) {
            this.commentary.push(text);
          },
          appendThinking(text: string) {
            this.thinking.push(text);
          },
          setThinking() {},
          startTool() {},
          getToolInfo(_id: string) {
            return undefined;
          },
          endTool() {},
          pushRecentEvent() {},
          updateToolSummary() {},
          setSystemStatus() {},
          setHook() {},
          setTodos() {},
          patchUsageNote() {},
          async complete(text: string) {
            this.finalText = text;
            this.active = false;
          },
          async fail(text: string) {
            this.finalText = text;
            this.active = false;
          },
          async abort(reason?: string) {
            this.abortReason = reason;
            this.active = false;
          },
          dispose() {
            this.active = false;
          },
          getAllMessageIds() {
            return [this.currentMessageId];
          },
        };
        sessions.push(session);
        onCardCreated?.(session.currentMessageId);
        return session;
      },
    ),
  };
});

vi.mock('../src/container-runner.js', () => ({
  runHostAgent: runnerMocks.runHostAgent,
  runContainerAgent: runnerMocks.runContainerAgent,
  writeGroupsSnapshot: runnerMocks.writeGroupsSnapshot,
  writeTasksSnapshot: runnerMocks.writeTasksSnapshot,
}));

vi.mock('../src/im-manager.js', () => ({
  imManager: {
    sendMessage: imMocks.sendMessage,
    setTyping: imMocks.setTyping,
    clearAckReaction: imMocks.clearAckReaction,
    createStreamingSession: imMocks.createStreamingSession,
    isChannelAvailableForJid: imMocks.isChannelAvailableForJid,
    getConnectedUserIds: vi.fn(() => []),
    getConnectedChannelTypes: vi.fn(() => []),
    isFeishuConnected: vi.fn(() => false),
    isAnyFeishuConnected: vi.fn(() => false),
    isAnyTelegramConnected: vi.fn(() => false),
    isTelegramConnected: vi.fn(() => false),
    isQQConnected: vi.fn(() => false),
    isWeChatConnected: vi.fn(() => false),
    isDingTalkConnected: vi.fn(() => false),
  },
}));

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-recovery-'));
  tempHomes.push(dir);
  return dir;
}

async function loadIndexModule() {
  const home = createTempHome();
  vi.stubEnv('HOME', home);
  return import('../src/index.ts');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
  imMocks.sessions.splice(0);
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('restart recovery cursor handling', () => {
  test('uses the same primary runtime session for web and IM-origin main turns', async () => {
    const { resolvePrimaryRuntimeSessionId } = await loadIndexModule();
    const sessions = { main: 'web-session-1' };
    const loadSession = vi.fn(() => 'db-session-1');

    expect(
      resolvePrimaryRuntimeSessionId({
        folder: 'main',
        sessions,
        loadSession,
      }),
    ).toBe('web-session-1');
    expect(loadSession).not.toHaveBeenCalled();
  });

  test('falls back to the persisted primary session when memory cache is empty', async () => {
    const { resolvePrimaryRuntimeSessionId } = await loadIndexModule();
    const loadSession = vi.fn(() => 'persisted-primary-session');

    expect(
      resolvePrimaryRuntimeSessionId({
        folder: 'main',
        sessions: {},
        loadSession,
      }),
    ).toBe('persisted-primary-session');
    expect(loadSession).toHaveBeenCalledWith('main');
  });

  test('isolates command-generated assistant prompts from the primary runtime session', async () => {
    const { shouldIsolatePrimaryRuntimeForTurn } = await loadIndexModule();

    expect(
      shouldIsolatePrimaryRuntimeForTurn([{ source_kind: 'assistant_prompt' }]),
    ).toBe(true);
    expect(
      shouldIsolatePrimaryRuntimeForTurn([
        { source_kind: null },
        { source_kind: 'scheduled_task_prompt' },
      ]),
    ).toBe(false);
  });

  test('only ignores an assistant-prompt session when it actually polluted primary session state', async () => {
    const { shouldIgnoreAssistantPromptPrimarySession } =
      await loadIndexModule();
    const previousMessages = [
      {
        id: 'skill-final',
        is_from_me: true,
        source_kind: 'sdk_final',
        session_id: 'sess-skill',
      },
      {
        id: 'skill-user',
        is_from_me: false,
        source_kind: 'assistant_prompt',
        session_id: null,
      },
    ];

    expect(
      shouldIgnoreAssistantPromptPrimarySession({
        previousMessages,
        primarySessionId: 'sess-skill',
      }),
    ).toBe(true);
    expect(
      shouldIgnoreAssistantPromptPrimarySession({
        previousMessages,
        primarySessionId: 'sess-normal-before-skill',
      }),
    ).toBe(false);
  });

  test('selects only the leading contiguous source batch for a primary turn', async () => {
    const { selectLeadingSourceTurnMessages } = await loadIndexModule();
    const messages = [
      { id: 'a1', chat_jid: 'web:main', source_jid: 'feishu:A' },
      { id: 'a2', chat_jid: 'web:main', source_jid: 'feishu:A' },
      { id: 'b1', chat_jid: 'web:main', source_jid: 'feishu:B' },
      { id: 'a3', chat_jid: 'web:main', source_jid: 'feishu:A' },
      { id: 'b2', chat_jid: 'web:main', source_jid: 'feishu:B' },
      { id: 'b3', chat_jid: 'web:main', source_jid: 'feishu:B' },
    ].map((message, index) => ({
      ...message,
      sender: 'user',
      sender_name: 'User',
      content: message.id,
      timestamp: `2026-04-27T10:00:0${index}.000Z`,
    }));

    expect(
      selectLeadingSourceTurnMessages(messages, 'web:main').map((m) => m.id),
    ).toEqual(['a1', 'a2']);
  });

  test('keeps assistant-prompt skill rewrites as their own primary turn', async () => {
    const { selectLeadingSourceTurnMessages } = await loadIndexModule();
    const base = {
      chat_jid: 'web:main',
      source_jid: 'feishu:A',
      sender: 'user',
      sender_name: 'User',
      timestamp: '2026-04-29T10:00:00.000Z',
      is_from_me: false,
    };

    expect(
      selectLeadingSourceTurnMessages(
        [
          {
            ...base,
            id: 'skill',
            content: 'skill prompt',
            source_kind: 'assistant_prompt',
          },
          {
            ...base,
            id: 'normal',
            content: 'normal follow-up',
            source_kind: null,
          },
        ] as any,
        'web:main',
      ).map((message: any) => message.id),
    ).toEqual(['skill']);

    expect(
      selectLeadingSourceTurnMessages(
        [
          {
            ...base,
            id: 'normal',
            content: 'normal question',
            source_kind: null,
          },
          {
            ...base,
            id: 'skill',
            content: 'skill prompt',
            source_kind: 'assistant_prompt',
          },
        ] as any,
        'web:main',
      ).map((message: any) => message.id),
    ).toEqual(['normal']);
  });

  test('creates a late-bound streaming session once the IM channel becomes available', async () => {
    const { ensureLateBoundStreamingSession } = await loadIndexModule();
    const createdSession = { id: 'stream-1' };
    const isChannelAvailable = vi.fn((jid: string) => jid === 'feishu:chat-1');
    const createSession = vi.fn((jid: string) =>
      jid === 'feishu:chat-1' ? createdSession : undefined,
    );
    const registerSession = vi.fn();

    const next = ensureLateBoundStreamingSession(undefined, {
      createJid: 'feishu:chat-1',
      registerJid: 'feishu:chat-1',
      isChannelAvailable,
      createSession,
      registerSession,
    });

    expect(next).toBe(createdSession);
    expect(isChannelAvailable).toHaveBeenCalledWith('feishu:chat-1');
    expect(createSession).toHaveBeenCalledWith('feishu:chat-1');
    expect(registerSession).toHaveBeenCalledWith(
      'feishu:chat-1',
      createdSession,
    );
  });

  test('keeps the streaming session empty until the IM channel is available', async () => {
    const { ensureLateBoundStreamingSession } = await loadIndexModule();
    const isChannelAvailable = vi.fn(() => false);
    const createSession = vi.fn();
    const registerSession = vi.fn();

    const next = ensureLateBoundStreamingSession(undefined, {
      createJid: 'feishu:chat-1',
      registerJid: 'feishu:chat-1',
      isChannelAvailable,
      createSession,
      registerSession,
    });

    expect(next).toBeUndefined();
    expect(isChannelAvailable).toHaveBeenCalledWith('feishu:chat-1');
    expect(createSession).not.toHaveBeenCalled();
    expect(registerSession).not.toHaveBeenCalled();
  });

  test('normalizes main-conversation shutdown keys onto sibling web chats', async () => {
    const { buildStreamingShutdownKey } = await loadIndexModule();

    expect(
      buildStreamingShutdownKey('feishu:chat-1', ['feishu:chat-1', 'web:main']),
    ).toBe('web:main');
  });

  test('keeps agent shutdown keys distinct per agent while still normalizing to web chat', async () => {
    const { buildStreamingShutdownKey } = await loadIndexModule();

    expect(
      buildStreamingShutdownKey(
        'feishu:chat-1',
        ['feishu:chat-1', 'web:main'],
        'agent-42',
      ),
    ).toBe('web:main#agent:agent-42');
  });

  test('builds recovery entries for active turns even when no text delta has been emitted yet', async () => {
    const { buildStreamingRecoveryEntries } = await loadIndexModule();

    expect(
      buildStreamingRecoveryEntries(
        {
          'web:main': {
            commitJid: 'feishu:chat-1',
            replyJid: 'feishu:chat-1',
            snapshotJid: 'web:main',
            cursor: {
              timestamp: '2026-04-19T09:05:00.000Z',
              id: 'msg-2',
            },
          },
        },
        new Map([
          ['web:main', { partialText: '', commentaryText: '' }],
          [
            'web:orphan',
            {
              partialText: 'partial text without active turn',
              commentaryText: '',
            },
          ],
        ]),
      ),
    ).toEqual([
      {
        streamingKey: 'web:main',
        commitJid: 'feishu:chat-1',
        replyJid: 'feishu:chat-1',
        snapshotJid: 'web:main',
        cursor: {
          timestamp: '2026-04-19T09:05:00.000Z',
          id: 'msg-2',
        },
        partialText: '',
        commentaryText: '',
      },
    ]);
  });

  test('does not recover conversation agent history when no committed cursor exists', async () => {
    const { resolveConversationAgentRecoveryCursor } = await loadIndexModule();

    expect(
      resolveConversationAgentRecoveryCursor({}, 'web:main#agent:agent-1'),
    ).toBeNull();
    expect(
      resolveConversationAgentRecoveryCursor(
        {
          'web:main#agent:agent-1': {
            timestamp: '2026-04-28T07:00:00.000Z',
            id: 'committed-message',
          },
        },
        'web:main#agent:agent-1',
      ),
    ).toEqual({
      timestamp: '2026-04-28T07:00:00.000Z',
      id: 'committed-message',
    });
  });

  test('preserves the IM reply target when a shared runner uses a normalized web streaming key', async () => {
    const { buildStreamingRecoveryEntries } = await loadIndexModule();

    expect(
      buildStreamingRecoveryEntries(
        {
          'feishu:chat-1': {
            commitJid: 'feishu:chat-1',
            replyJid: 'feishu:chat-1',
            snapshotJid: 'web:main',
            cursor: {
              timestamp: '2026-04-22T04:04:26.364Z',
              id: 'msg-feishu-1',
            },
          },
        } as any,
        new Map([
          [
            'web:main',
            {
              partialText: 'partial from shared runner',
              commentaryText: '',
            },
          ],
        ]),
      ),
    ).toEqual([
      {
        streamingKey: 'feishu:chat-1',
        commitJid: 'feishu:chat-1',
        replyJid: 'feishu:chat-1',
        snapshotJid: 'web:main',
        cursor: {
          timestamp: '2026-04-22T04:04:26.364Z',
          id: 'msg-feishu-1',
        },
        partialText: 'partial from shared runner',
        commentaryText: '',
      },
    ]);
  });

  test('advances the committed cursor for the real chat when recovery is saved under the normalized streaming key', async () => {
    const { applyActiveStreamingTurnCommittedCursor } = await loadIndexModule();

    const next = applyActiveStreamingTurnCommittedCursor(
      {
        'feishu:chat-1': {
          timestamp: '2026-04-19T09:00:00.000Z',
          id: 'msg-1',
        },
      },
      {
        commitJid: 'feishu:chat-1',
        cursor: {
          timestamp: '2026-04-19T09:05:00.000Z',
          id: 'msg-2',
        },
      },
    );

    expect(next).toEqual({
      'feishu:chat-1': {
        timestamp: '2026-04-19T09:05:00.000Z',
        id: 'msg-2',
      },
    });
  });

  test('does not regress a newer committed cursor when a stale recovery cursor is applied', async () => {
    const { applyActiveStreamingTurnCommittedCursor } = await loadIndexModule();
    const committed = {
      'feishu:chat-1': {
        timestamp: '2026-04-19T09:10:00.000Z',
        id: 'msg-3',
      },
    };

    const next = applyActiveStreamingTurnCommittedCursor(committed, {
      commitJid: 'feishu:chat-1',
      cursor: {
        timestamp: '2026-04-19T09:05:00.000Z',
        id: 'msg-2',
      },
    });

    expect(next).toBe(committed);
  });

  test('keeps shutdown interrupted cursors uncommitted so startup can replay pending turns', async () => {
    const { applyShutdownInterruptedStreamingCommittedCursor } =
      await loadIndexModule();
    const committed = {
      'feishu:chat-1': {
        timestamp: '2026-04-26T04:35:00.000Z',
        id: 'msg-before-restart',
      },
    };

    const next = applyShutdownInterruptedStreamingCommittedCursor(
      committed,
      {
        commitJid: 'feishu:chat-1',
        replyJid: 'feishu:chat-1',
        cursor: {
          timestamp: '2026-04-26T04:40:04.065Z',
          id: 'om_x100b51ed3cf378a0b2df988b2f86630',
        },
      },
      { imDeliverySuppressed: true },
    );

    expect(next).toBe(committed);
  });

  test('uses the committed cursor when replaying a recovered chat after restart', async () => {
    const { resolveMessageProcessingCursor } = await loadIndexModule();

    expect(
      resolveMessageProcessingCursor(
        'feishu:chat-1',
        {
          'feishu:chat-1': {
            timestamp: '2026-04-24T06:44:55.553Z',
            id: 'msg-latest-seen',
          },
        },
        {
          'feishu:chat-1': {
            timestamp: '2026-04-24T05:37:35.279Z',
            id: 'msg-last-committed',
          },
        },
        true,
      ),
    ).toEqual({
      timestamp: '2026-04-24T05:37:35.279Z',
      id: 'msg-last-committed',
    });
  });

  test('does not migrate accepted IPC cursors into committed recovery cursors on load', async () => {
    const { normalizeCommittedCursorsOnLoad } = await loadIndexModule();

    expect(
      normalizeCommittedCursorsOnLoad(
        {
          'feishu:chat-1': {
            timestamp: '2026-04-28T09:05:00.000Z',
            id: 'accepted-but-uncommitted',
          },
        },
        {},
      ),
    ).toEqual({});
  });

  test('startup recovery includes accepted but uncommitted IPC messages', async () => {
    const { resolveStartupRecoveryCursor } = await loadIndexModule();

    expect(
      resolveStartupRecoveryCursor('feishu:chat-1', {
        accepted: {
          'feishu:chat-1': {
            timestamp: '2026-04-28T09:05:00.000Z',
            id: 'accepted-but-uncommitted',
          },
        },
        committed: {},
      }),
    ).toEqual({
      timestamp: '',
      id: '',
    });
  });

  test('blocks cursor commit when required routed IM delivery fails', async () => {
    const { shouldCommitCursorAfterRoutedImDelivery } = await loadIndexModule();

    expect(
      shouldCommitCursorAfterRoutedImDelivery({
        requiresRoutedImDelivery: true,
        routedImDeliverySucceeded: false,
      }),
    ).toBe(false);
    expect(
      shouldCommitCursorAfterRoutedImDelivery({
        requiresRoutedImDelivery: true,
        routedImDeliverySucceeded: true,
      }),
    ).toBe(true);
    expect(
      shouldCommitCursorAfterRoutedImDelivery({
        requiresRoutedImDelivery: false,
        routedImDeliverySucceeded: null,
      }),
    ).toBe(true);
  });

  test('blocks conversation-agent cursor commit when static IM delivery fails', async () => {
    const { shouldCommitAgentConversationCursorAfterImDelivery } =
      await loadIndexModule();

    expect(
      shouldCommitAgentConversationCursorAfterImDelivery({
        replySourceImJid: 'feishu:chat-1',
        streamingCardHandledIm: false,
        staticImDeliverySucceeded: false,
      }),
    ).toBe(false);
    expect(
      shouldCommitAgentConversationCursorAfterImDelivery({
        replySourceImJid: 'feishu:chat-1',
        streamingCardHandledIm: false,
        staticImDeliverySucceeded: true,
      }),
    ).toBe(true);
    expect(
      shouldCommitAgentConversationCursorAfterImDelivery({
        replySourceImJid: 'feishu:chat-1',
        streamingCardHandledIm: true,
        staticImDeliverySucceeded: null,
      }),
    ).toBe(true);
    expect(
      shouldCommitAgentConversationCursorAfterImDelivery({
        replySourceImJid: null,
        streamingCardHandledIm: false,
        staticImDeliverySucceeded: null,
      }),
    ).toBe(true);
  });

  test('blocks interrupted partial cursor commit when static IM delivery fails', async () => {
    const { shouldCommitCursorAfterInterruptedPartialDelivery } =
      await loadIndexModule();

    expect(
      shouldCommitCursorAfterInterruptedPartialDelivery({
        replyImJid: 'feishu:chat-1',
        streamingCardHandledIm: false,
        staticImDeliverySucceeded: false,
      }),
    ).toBe(false);
    expect(
      shouldCommitCursorAfterInterruptedPartialDelivery({
        replyImJid: 'feishu:chat-1',
        streamingCardHandledIm: false,
        staticImDeliverySucceeded: true,
      }),
    ).toBe(true);
    expect(
      shouldCommitCursorAfterInterruptedPartialDelivery({
        replyImJid: 'feishu:chat-1',
        streamingCardHandledIm: true,
        staticImDeliverySucceeded: null,
      }),
    ).toBe(true);
    expect(
      shouldCommitCursorAfterInterruptedPartialDelivery({
        replyImJid: null,
        streamingCardHandledIm: false,
        staticImDeliverySucceeded: null,
      }),
    ).toBe(true);
  });

  test('records lifecycle evidence when fire-and-forget mirror IM delivery fails', async () => {
    const { sendImWithFailTracking } = await loadIndexModule();
    const sendWithRetry = vi.fn().mockResolvedValue(false);
    const recordLifecycle = vi.fn();
    const lifecycleMessages = [
      {
        id: 'msg-feishu-mirror',
        chat_jid: 'web:main',
        source_jid: 'feishu:chat-1',
        sender: 'user',
        sender_name: 'User',
        content: 'mirror this reply',
        timestamp: '2026-04-25T03:00:00.000Z',
      },
    ];

    await sendImWithFailTracking('feishu:mirror', 'reply text', [], {
      lifecycleMessages,
      lifecycleDetails: { delivery: 'mirror_message' },
      sendWithRetry,
      recordLifecycle,
    });

    expect(sendWithRetry).toHaveBeenCalledWith(
      'feishu:mirror',
      'reply text',
      [],
    );
    expect(recordLifecycle).toHaveBeenCalledWith({
      messages: lifecycleMessages,
      stage: 'im_delivered',
      status: 'error',
      reason: 'send_failed_after_retries',
      details: {
        delivery: 'mirror_message',
        targetJid: 'feishu:mirror',
      },
    });
  });

  test('does not save conversation-agent partial text after a final reply already exists', async () => {
    const { shouldSaveAgentConversationPartialReply } = await loadIndexModule();

    expect(
      shouldSaveAgentConversationPartialReply({
        currentTurnCommitted: false,
        hasFinalReply: true,
        hasAccumulatedText: true,
      }),
    ).toBe(false);
    expect(
      shouldSaveAgentConversationPartialReply({
        currentTurnCommitted: false,
        hasFinalReply: false,
        hasAccumulatedText: true,
      }),
    ).toBe(true);
    expect(
      shouldSaveAgentConversationPartialReply({
        currentTurnCommitted: true,
        hasFinalReply: false,
        hasAccumulatedText: true,
      }),
    ).toBe(false);
  });

  test('treats normal user and IM rows as restart-recoverable pending work', async () => {
    const { isRecoverableRestartPendingMessage } = await loadIndexModule();

    expect(
      isRecoverableRestartPendingMessage({
        sender: 'user-1',
        source_kind: null,
      }),
    ).toBe(true);
    expect(
      isRecoverableRestartPendingMessage({
        sender: 'ou_feishu_user',
        source_kind: 'legacy',
      }),
    ).toBe(true);
  });

  test('ignores internal prompt and command mirror rows during restart recovery', async () => {
    const { isRecoverableRestartPendingMessage } = await loadIndexModule();

    expect(
      isRecoverableRestartPendingMessage({
        sender: 'task-scheduler',
        source_kind: 'scheduled_task_prompt',
      }),
    ).toBe(false);
    expect(
      isRecoverableRestartPendingMessage({
        sender: 'admin',
        source_kind: 'user_command',
      }),
    ).toBe(false);
  });

  test('ignores assistant and system rows during restart recovery', async () => {
    const { isRecoverableRestartPendingMessage } = await loadIndexModule();

    expect(
      isRecoverableRestartPendingMessage({
        sender: 'cli-claw-agent',
        source_kind: 'interrupt_partial',
        is_from_me: true,
      }),
    ).toBe(false);
    expect(
      isRecoverableRestartPendingMessage({
        sender: '__system__',
        source_kind: null,
      }),
    ).toBe(false);
  });

  test('selects only recoverable rows for restart replay', async () => {
    const { selectRecoverableRestartPendingMessages } = await loadIndexModule();
    const pending = [
      {
        id: 'cmd-1',
        sender: 'admin',
        source_kind: 'user_command' as const,
      },
      {
        id: 'task-1',
        sender: 'task-scheduler',
        source_kind: 'scheduled_task_prompt' as const,
      },
      {
        id: 'user-1',
        sender: 'ou_feishu_user',
        source_kind: null,
      },
    ];

    expect(
      selectRecoverableRestartPendingMessages(pending).map((m) => m.id),
    ).toEqual(['user-1']);
  });

  test('drops restart recovery history before the latest assistant boundary', async () => {
    const { selectRecoverableRestartPendingMessages } = await loadIndexModule();
    const pending = [
      {
        id: 'old-user',
        sender: 'ou_old',
        source_kind: null,
      },
      {
        id: 'assistant-final',
        sender: 'cli-claw-agent',
        source_kind: 'sdk_final' as const,
        is_from_me: true,
      },
      {
        id: 'fresh-user',
        sender: 'ou_fresh',
        source_kind: null,
      },
    ];

    expect(
      selectRecoverableRestartPendingMessages(pending).map((m) => m.id),
    ).toEqual(['fresh-user']);
  });

  test('uses fresh messages instead of prompting with older interrupted context', async () => {
    const { resolveInterruptedResumeDecision } = await loadIndexModule();
    const interruptedBatch = [
      {
        id: 'old-user',
        chat_jid: 'feishu:chat-1',
        sender: 'ou_user',
        sender_name: 'Ryan',
        content: '继续任务',
        timestamp: '2026-04-26T10:00:00.000Z',
      },
      {
        id: 'old-interrupt',
        chat_jid: 'feishu:chat-1',
        sender: 'cli-claw-agent',
        sender_name: 'Cli Claw',
        content: '旧任务执行过程',
        timestamp: '2026-04-26T10:01:00.000Z',
        source_kind: 'interrupt_partial' as const,
        finalization_reason: 'interrupted' as const,
      },
      {
        id: 'fresh-user',
        chat_jid: 'feishu:chat-1',
        source_jid: 'feishu:A',
        sender: 'ou_user',
        sender_name: 'Ryan',
        content: '现在 ROADMAP 还有哪些任务',
        timestamp: '2026-04-26T10:05:00.000Z',
      },
      {
        id: 'other-source-user',
        chat_jid: 'feishu:chat-1',
        source_jid: 'feishu:B',
        sender: 'ou_other',
        sender_name: 'Other',
        content: '另一个来源的消息',
        timestamp: '2026-04-26T10:05:01.000Z',
      },
    ];

    const decision = resolveInterruptedResumeDecision({
      chatJid: 'feishu:chat-1',
      missedMessages: interruptedBatch,
    });

    expect(decision.action).toBe('use_current');
    expect(decision.messagesForAgent.map((m) => m.id)).toEqual(['fresh-user']);
  });

  test('startup recovery prompt includes only current pending user messages', async () => {
    const { processGroupMessages } = await loadIndexModule();
    const db = await import('../src/db.ts');

    db.initDatabase();
    db.setRegisteredGroup('web:main', {
      name: 'Main',
      folder: 'main',
      added_at: '2026-04-28T08:00:00.000Z',
      executionMode: 'host',
      is_home: true,
      activation_mode: 'auto',
    });
    db.ensureChatExists('web:main');
    db.storeMessageDirect(
      'committed',
      'web:main',
      'ou_old',
      'Old',
      '已提交的旧消息',
      '2026-04-28T08:00:00.000Z',
      false,
      { sourceJid: 'web:A' },
    );
    db.storeMessageDirect(
      'old-user',
      'web:main',
      'ou_old',
      'Old',
      '旧任务历史上下文',
      '2026-04-28T08:01:00.000Z',
      false,
      { sourceJid: 'web:A' },
    );
    db.storeMessageDirect(
      'old-interrupt',
      'web:main',
      'cli-claw-agent',
      'Cli Claw',
      '旧任务中断过程文本',
      '2026-04-28T08:02:00.000Z',
      true,
      {
        meta: {
          sourceKind: 'interrupt_partial',
          finalizationReason: 'interrupted',
        },
      },
    );
    db.storeMessageDirect(
      'current-a',
      'web:main',
      'ou_a',
      'A',
      '当前来源 A 的新问题',
      '2026-04-28T08:03:00.000Z',
      false,
      { sourceJid: 'web:A' },
    );
    db.storeMessageDirect(
      'current-b',
      'web:main',
      'ou_b',
      'B',
      '当前来源 B 的新问题',
      '2026-04-28T08:04:00.000Z',
      false,
      { sourceJid: 'web:B' },
    );
    db.setRouterState(
      'last_committed_cursor',
      JSON.stringify({
        'web:main': {
          timestamp: '2026-04-28T08:00:00.000Z',
          id: 'committed',
        },
      }),
    );
    db.setRouterState(
      'last_agent_timestamp',
      JSON.stringify({
        'web:main': {
          timestamp: '2026-04-28T08:00:00.000Z',
          id: 'committed',
        },
      }),
    );

    runnerMocks.runHostAgent.mockImplementation(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: '只回答当前来源 A',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        } as never);
        return { status: 'success' };
      },
    );

    await expect(processGroupMessages('web:main')).resolves.toBe(true);

    expect(runnerMocks.runHostAgent).toHaveBeenCalledOnce();
    const prompt = runnerMocks.runHostAgent.mock.calls[0][1].prompt;
    expect(prompt).toContain('当前来源 A 的新问题');
    expect(prompt).not.toContain('已提交的旧消息');
    expect(prompt).not.toContain('旧任务历史上下文');
    expect(prompt).not.toContain('旧任务中断过程文本');
    expect(prompt).not.toContain('当前来源 B 的新问题');
  });

  test('startup recovery replays accepted but uncommitted IPC messages without old interrupted context', async () => {
    vi.stubEnv('CLI_CLAW_SELF_CHECK', '1');
    const {
      loadRouterStateForTests,
      recoverPendingMessagesForTests,
      processGroupMessages,
    } = await loadIndexModule();
    const db = await import('../src/db.ts');

    db.initDatabase();
    db.setRegisteredGroup('web:main', {
      name: 'Main',
      folder: 'main',
      added_at: '2026-04-28T09:00:00.000Z',
      executionMode: 'host',
      is_home: true,
      activation_mode: 'auto',
    });
    db.ensureChatExists('web:main');
    db.storeMessageDirect(
      'old-user',
      'web:main',
      'ou_old',
      'Old',
      '上一轮历史上下文',
      '2026-04-28T09:00:00.000Z',
      false,
      { sourceJid: 'web:A' },
    );
    db.storeMessageDirect(
      'old-interrupt',
      'web:main',
      'cli-claw-agent',
      'Cli Claw',
      '上一轮中断正文',
      '2026-04-28T09:01:00.000Z',
      true,
      {
        sourceJid: 'web:A',
        meta: {
          sourceKind: 'interrupt_partial',
          finalizationReason: 'interrupted',
        },
      },
    );
    db.storeMessageDirect(
      'accepted-current',
      'web:main',
      'ou_a',
      'A',
      '当前重启后必须处理的问题',
      '2026-04-28T09:05:00.000Z',
      false,
      { sourceJid: 'web:A' },
    );
    db.setRouterState(
      'last_agent_timestamp',
      JSON.stringify({
        'web:main': {
          timestamp: '2026-04-28T09:05:00.000Z',
          id: 'accepted-current',
        },
      }),
    );
    db.setRouterState('last_committed_cursor', JSON.stringify({}));

    runnerMocks.runHostAgent.mockImplementation(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: '只处理当前消息',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        } as never);
        return { status: 'success' };
      },
    );

    loadRouterStateForTests();
    recoverPendingMessagesForTests();
    await expect(processGroupMessages('web:main')).resolves.toBe(true);

    expect(runnerMocks.runHostAgent).toHaveBeenCalledOnce();
    const prompt = runnerMocks.runHostAgent.mock.calls[0][1].prompt;
    expect(prompt).toContain('当前重启后必须处理的问题');
    expect(prompt).not.toContain('上一轮历史上下文');
    expect(prompt).not.toContain('上一轮中断正文');
  });

  test('startup recovery discards stale streaming buffer before first Feishu-origin turn', async () => {
    vi.stubEnv('CLI_CLAW_SELF_CHECK', '1');
    const {
      encodeJidForFilename,
      loadRouterStateForTests,
      processGroupMessages,
      recoverPendingMessagesForTests,
      recoverStreamingBufferForTests,
    } = await loadIndexModule();
    const { DATA_DIR } = await import('../src/config.ts');
    const db = await import('../src/db.ts');

    const previousCursor = {
      timestamp: '2026-04-29T06:10:03.249Z',
      id: 'previous-message',
    };
    const currentCursor = {
      timestamp: '2026-04-29T06:13:52.860Z',
      id: 'current-feishu-message',
    };

    db.initDatabase();
    db.setRegisteredGroup('web:main', {
      name: 'Main',
      folder: 'main',
      added_at: '2026-04-29T06:00:00.000Z',
      executionMode: 'host',
      is_home: true,
      activation_mode: 'auto',
    });
    db.setRegisteredGroup('feishu:oc_test', {
      name: 'Feishu',
      folder: 'main',
      added_at: '2026-04-29T06:00:00.000Z',
      executionMode: 'host',
      activation_mode: 'auto',
      target_main_jid: 'web:main',
      reply_policy: 'source_only',
    });
    db.ensureChatExists('web:main');
    db.storeMessageDirect(
      'current-feishu-message',
      'web:main',
      'ou_user',
      'User',
      '检查 clic-claw PLANS/ 的 ACTIVE 和 ROADMAP',
      currentCursor.timestamp,
      false,
      { sourceJid: 'feishu:oc_test' },
    );
    db.setRouterState(
      'last_agent_timestamp',
      JSON.stringify({ 'web:main': currentCursor }),
    );
    db.setRouterState(
      'last_committed_cursor',
      JSON.stringify({ 'web:main': previousCursor }),
    );
    db.setRouterState(
      'active_streaming_turns',
      JSON.stringify({
        'web:main': {
          commitJid: 'web:main',
          replyJid: 'feishu:oc_test',
          snapshotJid: 'web:main',
          cursor: currentCursor,
        },
      }),
    );

    const bufferDir = path.join(DATA_DIR, 'streaming-buffer');
    fs.mkdirSync(bufferDir, { recursive: true });
    const bufferPath = path.join(
      bufferDir,
      `${encodeJidForFilename('web:main')}.json`,
    );
    fs.writeFileSync(
      bufferPath,
      JSON.stringify({
        text: '港股 IPO 旧正文不允许恢复到首条消息',
        commentaryText: 'site:www1.hkexnews.hk 旧工具 steps',
        streamingKey: 'web:main',
        snapshotJid: 'web:main',
        commitJid: 'web:main',
        replyJid: 'feishu:oc_test',
        cursor: currentCursor,
      }),
    );

    runnerMocks.runHostAgent.mockImplementation(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'stream',
          streamEvent: {
            eventType: 'init',
            messageCursor: currentCursor,
            runtimeIdentity: { agentType: 'codex' },
          },
        } as never);
        await onOutput?.({
          status: 'stream',
          streamEvent: {
            eventType: 'text_delta',
            text: '当前 PLANS 分析中',
            runtimeIdentity: { agentType: 'codex' },
          },
        } as never);
        await onOutput?.({
          status: 'success',
          result: '当前 PLANS 清理结论',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
          runtimeIdentity: { agentType: 'codex' },
        } as never);
        return { status: 'success' };
      },
    );

    loadRouterStateForTests();
    recoverStreamingBufferForTests();

    expect(fs.existsSync(bufferPath)).toBe(false);
    expect(
      JSON.parse(db.getRouterState('active_streaming_turns') || '{}'),
    ).toEqual({});
    expect(
      JSON.parse(db.getRouterState('last_committed_cursor') || '{}'),
    ).toEqual({ 'web:main': previousCursor });

    recoverPendingMessagesForTests();
    await expect(processGroupMessages('web:main')).resolves.toBe(true);

    expect(runnerMocks.runHostAgent).toHaveBeenCalledOnce();
    const prompt = runnerMocks.runHostAgent.mock.calls[0][1].prompt;
    expect(prompt).toContain('检查 clic-claw PLANS/');
    expect(prompt).not.toContain('港股 IPO');
    expect(prompt).not.toContain('hkexnews');

    const messages = db.getMessagesPage('web:main', undefined, 20);
    const storedText = messages.map((message) => message.content).join('\n');
    expect(storedText).toContain('当前 PLANS 清理结论');
    expect(storedText).not.toContain('港股 IPO');
    expect(storedText).not.toContain('hkexnews');
    expect(
      messages.some((message) => message.source_kind === 'interrupt_partial'),
    ).toBe(false);

    const completedCard = imMocks.sessions.find(
      (session) => session.finalText === '当前 PLANS 清理结论',
    );
    expect(completedCard).toBeTruthy();
    expect(
      [
        completedCard?.finalText,
        ...(completedCard?.appended ?? []),
        ...(completedCard?.commentary ?? []),
      ].join('\n'),
    ).not.toContain('港股 IPO');
  });

  test('processes only the current leading source after interrupted context', async () => {
    const { processGroupMessages } = await loadIndexModule();
    const db = await import('../src/db.ts');

    db.initDatabase();
    db.setRegisteredGroup('web:main', {
      name: 'Main',
      folder: 'main',
      added_at: '2026-04-28T08:00:00.000Z',
      executionMode: 'host',
      is_home: true,
      activation_mode: 'auto',
    });
    db.ensureChatExists('web:main');
    db.storeMessageDirect(
      'old-user',
      'web:main',
      'ou_old',
      'Old',
      '旧任务历史上下文',
      '2026-04-28T08:00:00.000Z',
      false,
      { sourceJid: 'web:A' },
    );
    db.storeMessageDirect(
      'old-interrupt',
      'web:main',
      'cli-claw-agent',
      'Cli Claw',
      '旧任务中断过程文本',
      '2026-04-28T08:01:00.000Z',
      true,
      {
        sourceJid: 'web:A',
        meta: {
          sourceKind: 'interrupt_partial',
          finalizationReason: 'interrupted',
        },
      },
    );
    db.storeMessageDirect(
      'fresh-a',
      'web:main',
      'ou_a',
      'A',
      '当前来源 A 的新问题',
      '2026-04-28T08:02:00.000Z',
      false,
      { sourceJid: 'web:A' },
    );
    db.storeMessageDirect(
      'fresh-b',
      'web:main',
      'ou_b',
      'B',
      '当前来源 B 的新问题',
      '2026-04-28T08:03:00.000Z',
      false,
      { sourceJid: 'web:B' },
    );

    runnerMocks.runHostAgent.mockImplementation(
      async (_group, _input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'success',
          result: '只回答当前来源 A',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        } as never);
        return { status: 'success' };
      },
    );

    await expect(processGroupMessages('web:main')).resolves.toBe(true);

    expect(runnerMocks.runHostAgent).toHaveBeenCalledOnce();
    const prompt = runnerMocks.runHostAgent.mock.calls[0][1].prompt;
    expect(prompt).toContain('当前来源 A 的新问题');
    expect(prompt).not.toContain('旧任务历史上下文');
    expect(prompt).not.toContain('旧任务中断过程文本');
    expect(prompt).not.toContain('当前来源 B 的新问题');
    expect(db.getRouterState('last_committed_cursor')).toContain('fresh-a');
    expect(db.getRouterState('last_committed_cursor')).not.toContain('fresh-b');
  });

  test('uses only current user messages after an interrupted partial', async () => {
    const { resolveInterruptedResumeDecision } = await loadIndexModule();

    const decision = resolveInterruptedResumeDecision({
      chatJid: 'feishu:chat-1',
      missedMessages: [
        {
          id: 'old-user',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_user',
          sender_name: 'Ryan',
          content: '旧任务历史上下文',
          timestamp: '2026-04-26T10:00:00.000Z',
        },
        {
          id: 'old-interrupt',
          chat_jid: 'feishu:chat-1',
          sender: 'cli-claw-agent',
          sender_name: 'Cli Claw',
          content: '旧任务中断过程文本',
          timestamp: '2026-04-26T10:01:00.000Z',
          source_kind: 'interrupt_partial',
        },
        {
          id: 'current-a1',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_a',
          sender_name: 'A',
          content: '当前来源 A 的第一条',
          timestamp: '2026-04-26T10:02:00.000Z',
          source_jid: 'feishu:A',
        },
        {
          id: 'current-a2',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_a',
          sender_name: 'A',
          content: '当前来源 A 的第二条',
          timestamp: '2026-04-26T10:03:00.000Z',
          source_jid: 'feishu:A',
        },
        {
          id: 'current-b1',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_b',
          sender_name: 'B',
          content: '当前来源 B 的第一条',
          timestamp: '2026-04-26T10:04:00.000Z',
          source_jid: 'feishu:B',
        },
      ],
    });

    expect(decision.action).toBe('use_current');
    expect(decision.messagesForAgent.map((m) => m.id)).toEqual([
      'current-a1',
      'current-a2',
    ]);
  });

  test('selects Feishu startup backfill chats from the user workspace even when the Feishu row owner is missing or stale', async () => {
    const { selectFeishuStartupBackfillChatIds } = await loadIndexModule();
    const groups = {
      'web:main': {
        name: 'Main',
        folder: 'main',
        added_at: '2026-04-25T00:00:00.000Z',
        created_by: 'user-1',
      },
      'feishu:owned-chat': {
        name: 'Owned Feishu',
        folder: 'main',
        added_at: '2026-04-25T00:00:00.000Z',
        created_by: 'user-1',
      },
      'feishu:ownerless-chat': {
        name: 'Ownerless Feishu',
        folder: 'main',
        added_at: '2026-04-25T00:00:00.000Z',
      },
      'feishu:stale-owner-chat': {
        name: 'Stale Owner Feishu',
        folder: 'main',
        added_at: '2026-04-25T00:00:00.000Z',
        created_by: 'deleted-user',
      },
      'feishu:other-workspace-chat': {
        name: 'Other Feishu',
        folder: 'other',
        added_at: '2026-04-25T00:00:00.000Z',
        created_by: 'deleted-user',
      },
      'telegram:main': {
        name: 'Telegram Main',
        folder: 'main',
        added_at: '2026-04-25T00:00:00.000Z',
        created_by: 'user-1',
      },
    };

    expect(selectFeishuStartupBackfillChatIds('user-1', groups)).toEqual([
      'owned-chat',
      'ownerless-chat',
      'stale-owner-chat',
    ]);
  });

  test('starts pending-message recovery only after normal IM connection phase completes', async () => {
    const { shouldStartStartupMessageRecovery } = await loadIndexModule();

    expect(
      shouldStartStartupMessageRecovery({
        selfCheckMode: false,
        imConnectionPhaseComplete: false,
      }),
    ).toBe(false);
    expect(
      shouldStartStartupMessageRecovery({
        selfCheckMode: false,
        imConnectionPhaseComplete: true,
      }),
    ).toBe(true);
    expect(
      shouldStartStartupMessageRecovery({
        selfCheckMode: true,
        imConnectionPhaseComplete: true,
      }),
    ).toBe(false);
  });

  test('builds a placeholder interrupted reply when a turn was active but produced no text', async () => {
    const { buildInterruptedReply } = await loadIndexModule();

    expect(buildInterruptedReply('')).toBe('*⚠️ 已中断*');
  });

  test('does not include interrupted Codex commentary in visible partial replies', async () => {
    const { buildInterruptedReply } = await loadIndexModule();

    expect(
      buildInterruptedReply('', undefined, '先检查 ACP 事件\n\n再检查最终结果'),
    ).toBe('*⚠️ 已中断*');
  });

  test('skips graceful-shutdown partial reply body persistence', async () => {
    const { persistInterruptedStreamingReply } = await loadIndexModule();
    const deliverMessage = vi.fn().mockResolvedValue('msg-1');

    await expect(
      persistInterruptedStreamingReply(
        {
          replyJid: 'feishu:chat-1',
          partialText: 'partial from shutdown',
        },
        'shutdown',
        deliverMessage,
      ),
    ).resolves.toBeUndefined();

    expect(deliverMessage).not.toHaveBeenCalled();
  });

  test('skips shutdown partial body persistence for web snapshot chats', async () => {
    const { persistInterruptedStreamingReply } = await loadIndexModule();
    const deliverMessage = vi.fn().mockResolvedValue('msg-2');

    await expect(
      persistInterruptedStreamingReply(
        {
          replyJid: 'web:main',
          partialText: 'partial for web only',
        },
        'shutdown',
        deliverMessage,
      ),
    ).resolves.toBeUndefined();

    expect(deliverMessage).not.toHaveBeenCalled();
  });

  test('skips crash-recovered partial reply body persistence after ungraceful exits', async () => {
    const { persistInterruptedStreamingReply } = await loadIndexModule();
    const deliverMessage = vi.fn().mockResolvedValue('msg-3');

    await expect(
      persistInterruptedStreamingReply(
        {
          replyJid: 'feishu:chat-1',
          partialText: 'partial from crash recovery',
          commentaryText: 'tool trace that can be audited',
        },
        'crash_recovery',
        deliverMessage,
      ),
    ).resolves.toBeUndefined();

    expect(deliverMessage).not.toHaveBeenCalled();
  });
});
