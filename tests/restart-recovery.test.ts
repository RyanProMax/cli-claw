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

  test('routes graceful-shutdown partial replies back through the normal IM delivery path', async () => {
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
        sendToIM: true,
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
