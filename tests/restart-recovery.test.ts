import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

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
  vi.resetModules();
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

  test('resets the primary runtime session for command-generated assistant prompts', async () => {
    const { shouldResetPrimaryRuntimeForTurn } = await loadIndexModule();

    expect(
      shouldResetPrimaryRuntimeForTurn([{ source_kind: 'assistant_prompt' }]),
    ).toBe(true);
    expect(
      shouldResetPrimaryRuntimeForTurn([
        { source_kind: null },
        { source_kind: 'scheduled_task_prompt' },
      ]),
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

  test('commits shutdown interrupted cursors so old turns do not batch with the next live message', async () => {
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

    expect(next).toEqual({
      'feishu:chat-1': {
        timestamp: '2026-04-26T04:40:04.065Z',
        id: 'om_x100b51ed3cf378a0b2df988b2f86630',
      },
    });
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
        sender: 'autopilot',
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
        sender: 'autopilot',
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

  test('asks for confirmation before consuming older interrupted context with a fresh message', async () => {
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
        sender: 'ou_user',
        sender_name: 'Ryan',
        content: '现在 ROADMAP 还有哪些任务',
        timestamp: '2026-04-26T10:05:00.000Z',
      },
    ];

    const decision = resolveInterruptedResumeDecision({
      chatJid: 'feishu:chat-1',
      missedMessages: interruptedBatch,
    });

    expect(decision.action).toBe('ask');
    expect(decision.messagesForAgent).toEqual([]);
    expect(decision.promptText).toContain('检测到上次任务被中断');
    expect(
      decision.pendingConfirmation?.resumeMessages.map((m) => m.id),
    ).toEqual(['old-user']);
    expect(
      decision.pendingConfirmation?.freshMessages.map((m) => m.id),
    ).toEqual(['fresh-user']);
  });

  test('replays interrupted context only after an explicit continue reply', async () => {
    const { resolveInterruptedResumeDecision } = await loadIndexModule();
    const pendingConfirmation = {
      chatJid: 'feishu:chat-1',
      interruptedAt: '2026-04-26T10:01:00.000Z',
      interruptedMessageId: 'old-interrupt',
      createdAt: '2026-04-26T10:05:00.000Z',
      resumeMessages: [
        {
          id: 'old-user',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_user',
          sender_name: 'Ryan',
          content: '继续任务',
          timestamp: '2026-04-26T10:00:00.000Z',
        },
      ],
      freshMessages: [
        {
          id: 'fresh-user',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_user',
          sender_name: 'Ryan',
          content: '现在 ROADMAP 还有哪些任务',
          timestamp: '2026-04-26T10:05:00.000Z',
        },
      ],
    };

    const decision = resolveInterruptedResumeDecision({
      chatJid: 'feishu:chat-1',
      missedMessages: [
        {
          id: 'resume-reply',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_user',
          sender_name: 'Ryan',
          content: '继续上次',
          timestamp: '2026-04-26T10:06:00.000Z',
        },
      ],
      pendingConfirmation,
    });

    expect(decision.action).toBe('continue_previous');
    expect(decision.messagesForAgent.map((m) => m.id)).toEqual(['old-user']);
    expect(decision.clearPendingConfirmation).toBe(true);
  });

  test('does not feed the confirmation prompt itself back to the runner', async () => {
    const { resolveInterruptedResumeDecision } = await loadIndexModule();

    const decision = resolveInterruptedResumeDecision({
      chatJid: 'feishu:chat-1',
      missedMessages: [
        {
          id: 'resume-prompt',
          chat_jid: 'feishu:chat-1',
          sender: 'cli-claw-agent',
          sender_name: 'Cli Claw',
          content: '检测到上次任务被中断。是否继续上次任务？',
          timestamp: '2026-04-26T10:05:01.000Z',
        },
      ],
      pendingConfirmation: {
        chatJid: 'feishu:chat-1',
        interruptedAt: '2026-04-26T10:01:00.000Z',
        interruptedMessageId: 'old-interrupt',
        createdAt: '2026-04-26T10:05:00.000Z',
        resumeMessages: [
          {
            id: 'old-user',
            chat_jid: 'feishu:chat-1',
            sender: 'ou_user',
            sender_name: 'Ryan',
            content: '继续任务',
            timestamp: '2026-04-26T10:00:00.000Z',
          },
        ],
        freshMessages: [
          {
            id: 'fresh-user',
            chat_jid: 'feishu:chat-1',
            sender: 'ou_user',
            sender_name: 'Ryan',
            content: '现在 ROADMAP 还有哪些任务',
            timestamp: '2026-04-26T10:05:00.000Z',
          },
        ],
      },
    });

    expect(decision.action).toBe('wait_for_reply');
    expect(decision.messagesForAgent).toEqual([]);
  });

  test('uses the fresh message when interrupted context is explicitly ignored', async () => {
    const { resolveInterruptedResumeDecision } = await loadIndexModule();
    const pendingConfirmation = {
      chatJid: 'feishu:chat-1',
      interruptedAt: '2026-04-26T10:01:00.000Z',
      interruptedMessageId: 'old-interrupt',
      createdAt: '2026-04-26T10:05:00.000Z',
      resumeMessages: [
        {
          id: 'old-user',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_user',
          sender_name: 'Ryan',
          content: '继续任务',
          timestamp: '2026-04-26T10:00:00.000Z',
        },
      ],
      freshMessages: [
        {
          id: 'fresh-user',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_user',
          sender_name: 'Ryan',
          content: '现在 ROADMAP 还有哪些任务',
          timestamp: '2026-04-26T10:05:00.000Z',
        },
      ],
    };

    const decision = resolveInterruptedResumeDecision({
      chatJid: 'feishu:chat-1',
      missedMessages: [
        {
          id: 'discard-reply',
          chat_jid: 'feishu:chat-1',
          sender: 'ou_user',
          sender_name: 'Ryan',
          content: '忽略上次',
          timestamp: '2026-04-26T10:06:00.000Z',
        },
      ],
      pendingConfirmation,
    });

    expect(decision.action).toBe('use_fresh');
    expect(decision.messagesForAgent.map((m) => m.id)).toEqual(['fresh-user']);
    expect(decision.clearPendingConfirmation).toBe(true);
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

  test('keeps recovery history free of internal control rows', async () => {
    const { isRestartRecoveryHistoryMessage } = await loadIndexModule();

    expect(
      isRestartRecoveryHistoryMessage({
        sender: 'admin',
        source_kind: 'user_command',
      }),
    ).toBe(false);
    expect(
      isRestartRecoveryHistoryMessage({
        sender: 'autopilot',
        source_kind: 'scheduled_task_prompt',
      }),
    ).toBe(false);
    expect(
      isRestartRecoveryHistoryMessage({
        sender: '__system__',
        source_kind: null,
      }),
    ).toBe(false);
    expect(
      isRestartRecoveryHistoryMessage({
        sender: 'cli-claw-agent',
        source_kind: 'sdk_final',
      }),
    ).toBe(true);
  });

  test('builds a placeholder interrupted reply when a turn was active but produced no text', async () => {
    const { buildInterruptedReply } = await loadIndexModule();

    expect(buildInterruptedReply('')).toBe('*⚠️ 已中断*');
  });

  test('renders interrupted Codex commentary in its own collapsible block', async () => {
    const { buildInterruptedReply } = await loadIndexModule();

    expect(
      buildInterruptedReply('', undefined, '先检查 ACP 事件\n\n再检查最终结果'),
    ).toBe(
      [
        '<details>',
        '<summary>💬 Commentary (已中断)</summary>',
        '',
        '先检查 ACP 事件',
        '',
        '再检查最终结果',
        '',
        '</details>',
        '',
        '---',
        '*⚠️ 已中断*',
      ].join('\n'),
    );
  });

  test('keeps graceful-shutdown partial replies DB-only instead of sending process text to IM', async () => {
    const { buildInterruptedReply, persistInterruptedStreamingReply } =
      await loadIndexModule();
    const deliverMessage = vi.fn().mockResolvedValue('msg-1');

    await persistInterruptedStreamingReply(
      {
        replyJid: 'feishu:chat-1',
        partialText: 'partial from shutdown',
      },
      'shutdown',
      deliverMessage,
    );

    expect(deliverMessage).toHaveBeenCalledWith(
      'feishu:chat-1',
      buildInterruptedReply('partial from shutdown'),
      {
        sendToIM: false,
        messageMeta: {
          sourceKind: 'interrupt_partial',
          finalizationReason: 'shutdown',
        },
      },
    );
  });

  test('keeps shutdown partial persistence DB-only for web snapshot chats', async () => {
    const { buildInterruptedReply, persistInterruptedStreamingReply } =
      await loadIndexModule();
    const deliverMessage = vi.fn().mockResolvedValue('msg-2');

    await persistInterruptedStreamingReply(
      {
        replyJid: 'web:main',
        partialText: 'partial for web only',
      },
      'shutdown',
      deliverMessage,
    );

    expect(deliverMessage).toHaveBeenCalledWith(
      'web:main',
      buildInterruptedReply('partial for web only'),
      {
        sendToIM: false,
        messageMeta: {
          sourceKind: 'interrupt_partial',
          finalizationReason: 'shutdown',
        },
      },
    );
  });

  test('can suppress IM delivery for shutdown partials while still persisting the interrupted reply', async () => {
    const { buildInterruptedReply, persistInterruptedStreamingReply } =
      await loadIndexModule();
    const deliverMessage = vi.fn().mockResolvedValue('msg-3');

    await persistInterruptedStreamingReply(
      {
        replyJid: 'feishu:chat-1',
        partialText: 'partial from intentional self-restart',
        commentaryText: 'tool trace that should not hit IM',
      },
      'shutdown',
      deliverMessage,
      { sendToIM: false },
    );

    expect(deliverMessage).toHaveBeenCalledWith(
      'feishu:chat-1',
      buildInterruptedReply(
        'partial from intentional self-restart',
        undefined,
        'tool trace that should not hit IM',
      ),
      {
        sendToIM: false,
        messageMeta: {
          sourceKind: 'interrupt_partial',
          finalizationReason: 'shutdown',
        },
      },
    );
  });
});
