import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const handlers: Record<string, (payload: any) => Promise<void> | void> = {};
  const createdCards: Array<Record<string, any>> = [];
  const updatedCards: Array<Record<string, any>> = [];
  const streamedContents: string[] = [];
  return {
    handlers,
    requestSpy: vi.fn().mockResolvedValue({ bot: { open_id: 'bot-open-id' } }),
    createSpy: vi.fn().mockResolvedValue({ data: { message_id: 'msg-1' } }),
    messageListSpy: vi.fn().mockResolvedValue({ data: { items: [] } }),
    cardCreateSpy: vi.fn(async ({ data }: any) => {
      const card = JSON.parse(data.data);
      createdCards.push(card);
      return { data: { card_id: `card-${createdCards.length}` } };
    }),
    cardUpdateSpy: vi.fn(async ({ data }: any) => {
      const card = JSON.parse(data.card.data);
      updatedCards.push(card);
      return { data: {} };
    }),
    cardSettingsSpy: vi.fn(async () => ({ data: {} })),
    cardElementContentSpy: vi.fn(async ({ data }: any) => {
      streamedContents.push(data.content);
      return { data: {} };
    }),
    cardElementUpdateSpy: vi.fn(async () => ({ data: {} })),
    createdCards,
    updatedCards,
    streamedContents,
    runAgentProcess: vi.fn(),
    writeGroupsSnapshot: vi.fn(),
    writeTasksSnapshot: vi.fn(),
    wsStartSpy: vi.fn().mockResolvedValue(undefined),
    wsCloseSpy: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@larksuiteoapi/node-sdk', () => {
  class MockClient {
    request = hoisted.requestSpy;
    im = {
      messageReaction: {
        create: vi.fn().mockResolvedValue({ data: { reaction_id: 'r1' } }),
        delete: vi.fn().mockResolvedValue({}),
      },
      message: {
        reply: vi.fn().mockResolvedValue({}),
      },
      v1: {
        message: {
          create: hoisted.createSpy,
          get: vi.fn(),
          list: hoisted.messageListSpy,
        },
        chat: {
          get: vi.fn(),
          list: vi.fn(),
        },
        image: {
          create: vi.fn(),
        },
        file: {
          create: vi.fn(),
        },
        messageResource: {
          reaction: {
            create: vi.fn().mockResolvedValue({ data: { reaction_id: 'r1' } }),
            delete: vi.fn().mockResolvedValue({}),
          },
        },
      },
    };
    cardkit = {
      v1: {
        card: {
          create: hoisted.cardCreateSpy,
          update: hoisted.cardUpdateSpy,
          settings: hoisted.cardSettingsSpy,
        },
        cardElement: {
          content: hoisted.cardElementContentSpy,
          update: hoisted.cardElementUpdateSpy,
        },
      },
    };

    constructor(_: unknown) {}
  }

  class MockEventDispatcher {
    constructor(_: unknown) {}

    register(map: Record<string, (payload: any) => Promise<void> | void>) {
      Object.assign(hoisted.handlers, map);
      return this;
    }
  }

  class MockWSClient {
    start = hoisted.wsStartSpy;
    close = hoisted.wsCloseSpy;

    constructor(_: unknown) {}
  }

  return {
    Client: MockClient,
    EventDispatcher: MockEventDispatcher,
    WSClient: MockWSClient,
    AppType: {
      SelfBuild: 'SelfBuild',
    },
    LoggerLevel: {
      info: 'info',
    },
  };
});

vi.mock('../../../../src/web/app.js', () => ({
  startWebServer: vi.fn(),
  broadcastToWebClients: vi.fn(),
  broadcastNewMessage: vi.fn(),
  broadcastTyping: vi.fn(),
  broadcastStreamEvent: vi.fn(),
  broadcastAgentStatus: vi.fn(),
  broadcastGroupCreated: vi.fn(),
  shutdownWebServer: vi.fn(),
  getActiveStreamingTexts: vi.fn(() => new Map()),
  clearStreamingSnapshot: vi.fn(),
}));

vi.mock('../../../../src/agent/runner/container-runner.js', () => ({
  runAgentProcess: hoisted.runAgentProcess,
  writeGroupsSnapshot: hoisted.writeGroupsSnapshot,
  writeTasksSnapshot: hoisted.writeTasksSnapshot,
}));

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-feishu-e2e-'));
  tempHomes.push(dir);
  return dir;
}

async function loadFeishuE2EModules() {
  const home = createTempHome();
  vi.stubEnv('HOME', home);
  const [db, notifier, feishu, restartGuard] = await Promise.all([
    import('../../../../src/storage/db.ts'),
    import('../../../../src/messaging/notifier.ts'),
    import('../../../../src/messaging/providers/feishu/index.ts'),
    import('../../../../shared/service-restart-guard.ts'),
  ]);
  db.initDatabase();
  return { db, notifier, feishu, restartGuard };
}

async function loadFeishuProcessGroupModules() {
  const home = createTempHome();
  vi.stubEnv('HOME', home);
  const [db, notifier, imManagerModule, restartGuard, indexModule, config] =
    await Promise.all([
      import('../../../../src/storage/db.ts'),
      import('../../../../src/messaging/notifier.ts'),
      import('../../../../src/messaging/manager.ts'),
      import('../../../../shared/service-restart-guard.ts'),
      import('../../../../src/index.ts'),
      import('../../../../src/core/config.ts'),
    ]);
  db.initDatabase();
  return {
    db,
    notifier,
    imManager: imManagerModule.imManager,
    restartGuard,
    processGroupMessages: indexModule.processGroupMessages,
    encodeJidForFilename: indexModule.encodeJidForFilename,
    loadRouterStateForTests: indexModule.loadRouterStateForTests,
    recoverStreamingBufferForTests: indexModule.recoverStreamingBufferForTests,
    DATA_DIR: config.DATA_DIR,
  };
}

async function driveQueuedFeishuSuccessPath(_: {
  db: any;
  connection: any;
  chatJid: string;
  messageId: string;
  finalText: string;
}): Promise<void> {
  const { db, connection, chatJid, messageId, finalText } = _;
  const [
    { GroupQueue },
    { recordLifecycleForMessages },
    { StreamingCardController },
  ] = await Promise.all([
    import('../../../../src/agent/queue/group-queue.ts'),
    import('../../../../src/messaging/lifecycle.ts'),
    import('../../../../src/messaging/providers/feishu/streaming-card.ts'),
  ]);
  const emptyCursor = { timestamp: '', id: '' };
  const queue = new GroupQueue();

  queue.setSerializationKeyResolver((groupJid: string) => groupJid);

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const processed = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for Feishu E2E queue processing'));
    }, 2000);

    queue.setProcessMessagesFn(async (groupJid: string) => {
      if (groupJid !== chatJid) return true;

      try {
        const messages = db.getMessagesSince(chatJid, emptyCursor);
        expect(messages.map((message: any) => message.id)).toContain(messageId);

        recordLifecycleForMessages({ messages, stage: 'queued' });
        recordLifecycleForMessages({ messages, stage: 'runner_started' });

        const cardMessageIds: string[] = [];
        const controller = new StreamingCardController({
          client: connection.getLarkClient(),
          chatId: chatJid.replace(/^feishu:/, ''),
          replyToMsgId: messageId,
          onCardCreated: (createdMessageId: string) => {
            cardMessageIds.push(createdMessageId);
          },
        });

        try {
          controller.append('处理中');
          await vi.waitFor(() => {
            expect(cardMessageIds.length).toBeGreaterThan(0);
          });

          recordLifecycleForMessages({
            messages,
            stage: 'stream_started',
            details: { runner: 'fake' },
          });

          await controller.complete(finalText);
          await vi.waitFor(() => {
            expect(JSON.stringify(hoisted.updatedCards.at(-1))).toContain(
              finalText,
            );
          });
        } finally {
          controller.dispose();
        }

        recordLifecycleForMessages({ messages, stage: 'finalized' });
        recordLifecycleForMessages({
          messages,
          stage: 'im_delivered',
          details: {
            delivery: 'streaming_card',
            messageId: cardMessageIds.at(-1) ?? null,
          },
        });

        const storedMessage = messages.find(
          (message: any) => message.id === messageId,
        );
        const cursor = {
          timestamp: storedMessage.timestamp,
          id: storedMessage.id,
        };
        db.setRouterState(
          'last_committed_cursor',
          JSON.stringify({ [chatJid]: cursor }),
        );
        recordLifecycleForMessages({
          messages,
          stage: 'cursor_committed',
          details: { cursor },
        });

        resolve();
        return true;
      } catch (err) {
        reject(err);
        return true;
      }
    });
  });

  queue.enqueueMessageCheck(chatJid);

  try {
    await processed;
    await vi.waitFor(() => {
      expect(queue.getStatus().activeCount).toBe(0);
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    await queue.shutdown(0);
  }
}

async function driveQueuedFeishuOpenAIStaticFinalPath(_: {
  db: any;
  connection: any;
  chatJid: string;
  messageId: string;
  rawFinalText: string;
  stalePresentationAnswer: string;
}): Promise<void> {
  const {
    db,
    connection,
    chatJid,
    messageId,
    rawFinalText,
    stalePresentationAnswer,
  } = _;
  const [
    { GroupQueue },
    { recordLifecycleForMessages },
    { resolveVisibleReplyParts },
  ] = await Promise.all([
    import('../../../../src/agent/queue/group-queue.ts'),
    import('../../../../src/messaging/lifecycle.ts'),
    import('../../../../src/presentation/reply-visibility.ts'),
  ]);
  const emptyCursor = { timestamp: '', id: '' };
  const queue = new GroupQueue();

  queue.setSerializationKeyResolver((groupJid: string) => groupJid);

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const processed = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          'Timed out waiting for Feishu OpenAI static final processing',
        ),
      );
    }, 2000);

    queue.setProcessMessagesFn(async (groupJid: string) => {
      if (groupJid !== chatJid) return true;

      try {
        const messages = db.getMessagesSince(chatJid, emptyCursor);
        expect(messages.map((message: any) => message.id)).toContain(messageId);

        recordLifecycleForMessages({ messages, stage: 'queued' });
        recordLifecycleForMessages({ messages, stage: 'runner_started' });

        const visibleReply = resolveVisibleReplyParts(
          rawFinalText,
          { answerText: stalePresentationAnswer },
          { agentType: 'openai' },
        );
        expect(visibleReply).toMatchObject({
          visibleText: rawFinalText,
          commentaryText: '',
          droppedPresentationAnswer: true,
        });

        recordLifecycleForMessages({
          messages,
          stage: 'finalized',
          details: {
            droppedPresentationAnswer: true,
            visibilityResolution: {
              agentType: 'openai',
              selectedSource: 'raw_final',
              rawFinalLength: rawFinalText.length,
              presentationAnswerLength: stalePresentationAnswer.length,
              visibleTextLength: visibleReply.visibleText.length,
            },
          },
        });

        await connection.sendMessage(
          chatJid.replace(/^feishu:/, ''),
          visibleReply.visibleText,
        );

        recordLifecycleForMessages({
          messages,
          stage: 'im_delivered',
          details: { delivery: 'static_message' },
        });

        const storedMessage = messages.find(
          (message: any) => message.id === messageId,
        );
        const cursor = {
          timestamp: storedMessage.timestamp,
          id: storedMessage.id,
        };
        db.setRouterState(
          'last_committed_cursor',
          JSON.stringify({ [chatJid]: cursor }),
        );
        recordLifecycleForMessages({
          messages,
          stage: 'cursor_committed',
          details: { cursor },
        });

        resolve();
        return true;
      } catch (err) {
        reject(err);
        return true;
      }
    });
  });

  queue.enqueueMessageCheck(chatJid);

  try {
    await processed;
    await vi.waitFor(() => {
      expect(queue.getStatus().activeCount).toBe(0);
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    await queue.shutdown(0);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
  hoisted.createSpy.mockResolvedValue({ data: { message_id: 'msg-1' } });
  hoisted.messageListSpy.mockResolvedValue({ data: { items: [] } });
  hoisted.cardCreateSpy.mockClear();
  hoisted.cardUpdateSpy.mockClear();
  hoisted.cardSettingsSpy.mockClear();
  hoisted.cardElementContentSpy.mockClear();
  hoisted.cardElementUpdateSpy.mockClear();
  hoisted.createdCards.length = 0;
  hoisted.updatedCards.length = 0;
  hoisted.streamedContents.length = 0;
  hoisted.runAgentProcess.mockReset();
  hoisted.writeGroupsSnapshot.mockReset();
  hoisted.writeTasksSnapshot.mockReset();
  Object.keys(hoisted.handlers).forEach((key) => delete hoisted.handlers[key]);
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Feishu in-process E2E harness', () => {
  test('replays a continuation message through real storage, lifecycle, and notifier wakeup', async () => {
    const { db, notifier, feishu, restartGuard } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    const onCommand = vi.fn();

    await connection.connect({
      onReady: vi.fn(),
      onCommand,
      onNewChat: vi.fn(),
      resolveManagedCommandText: (_chatJid, text) =>
        restartGuard.resolveManagedSelfRestartCommand(text),
    });

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_98f0bb60f284627bf20f9386704f8c82',
        message_id: 'om_x100b51ee3e1b50acb3b0af6442e5761',
        create_time: '1777070333296',
        message_type: 'text',
        content: JSON.stringify({ text: '继续任务 -' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_c9410c372b8283aacad4b2844c5e401b',
        },
      },
    });

    await expect(wakeup).resolves.toBe('woke');
    expect(onCommand).not.toHaveBeenCalled();

    const messages = db.getMessagesSince(
      'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      { timestamp: '', id: '' },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'om_x100b51ee3e1b50acb3b0af6442e5761',
      chat_jid: 'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      source_jid: 'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      sender: 'ou_c9410c372b8283aacad4b2844c5e401b',
      content: '继续任务 -',
    });

    const lifecycle = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid: 'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
      messageId: 'om_x100b51ee3e1b50acb3b0af6442e5761',
    });
    expect(lifecycle.map((event) => event.stage)).toEqual([
      'received',
      'stored',
      'notified',
    ]);
    expect(lifecycle.every((event) => event.status === 'ok')).toBe(true);
  });

  test('drives a Feishu message through queue, fake runner, streaming card delivery, and cursor commit', async () => {
    const { db, notifier, feishu, restartGuard } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    const chatJid = 'feishu:oc_success_path';
    const messageId = 'om_success_path';

    await connection.connect({
      onReady: vi.fn(),
      onCommand: vi.fn(),
      onNewChat: vi.fn(),
      resolveManagedCommandText: (_chatJid, text) =>
        restartGuard.resolveManagedSelfRestartCommand(text),
    });

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_success_path',
        message_id: messageId,
        create_time: '1777070337000',
        message_type: 'text',
        content: JSON.stringify({ text: '继续任务' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_success',
        },
      },
    });

    await expect(wakeup).resolves.toBe('woke');

    await driveQueuedFeishuSuccessPath({
      db,
      connection,
      chatJid,
      messageId,
      finalText: '已继续当前任务',
    });

    const lifecycle = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid,
      messageId,
    });
    expect(
      lifecycle.map((event) => [event.stage, event.status, event.reason]),
    ).toEqual([
      ['received', 'ok', null],
      ['stored', 'ok', null],
      ['notified', 'ok', null],
      ['queued', 'ok', null],
      ['runner_started', 'ok', null],
      ['stream_started', 'ok', null],
      ['finalized', 'ok', null],
      ['im_delivered', 'ok', null],
      ['cursor_committed', 'ok', null],
    ]);

    expect(hoisted.cardCreateSpy).toHaveBeenCalledTimes(1);
    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: expect.objectContaining({
        receive_id: 'oc_success_path',
        msg_type: 'interactive',
      }),
    });
    expect(JSON.stringify(hoisted.updatedCards.at(-1))).toContain(
      '已继续当前任务',
    );

    const storedMessage = db.getMessagesSince(chatJid, {
      timestamp: '',
      id: '',
    })[0];
    expect(
      JSON.parse(db.getRouterState('last_committed_cursor') ?? '{}'),
    ).toEqual({
      [chatJid]: {
        timestamp: storedMessage.timestamp,
        id: messageId,
      },
    });
  });

  test('processes a Feishu turn through processGroupMessages, streaming card finalization, final reply persistence, and cursor commit without leaked context', async () => {
    const { db, notifier, imManager, restartGuard, processGroupMessages } =
      await loadFeishuProcessGroupModules();
    const chatId = 'oc_process_group_output';
    const chatJid = `feishu:${chatId}`;
    const userId = 'user-feishu-process-group';
    const messageId = 'om_process_group_output';
    const finalText = '当前结论：真实飞书输出链路已同步。';
    const forbiddenSnippets = [
      '旧 history',
      'PLANS/ACTIVE.md',
      'handoff',
      '历史 ACTIVE 计划',
    ];

    db.setRegisteredGroup(chatJid, {
      name: 'Feishu Process Group',
      folder: 'feishu-process-group',
      added_at: '2026-04-28T09:00:00.000Z',
      agentType: 'openai',
      activation_mode: 'auto',
      created_by: userId,
    });
    db.ensureChatExists(chatJid);
    db.storeMessageDirect(
      'old-history',
      chatJid,
      'ou_old',
      'Old User',
      '旧 history：不要把 PLANS/ACTIVE.md 或 handoff 带进下一轮。',
      '2026-04-20T09:00:00.000Z',
      false,
      { sourceJid: chatJid },
    );
    db.storeMessageDirect(
      'old-interrupt',
      chatJid,
      'cli-claw-agent',
      'Cli Claw',
      '历史 ACTIVE 计划和 handoff 残留',
      '2026-04-20T09:01:00.000Z',
      true,
      {
        sourceJid: chatJid,
        meta: {
          sourceKind: 'interrupt_partial',
          finalizationReason: 'interrupted',
        },
      },
    );

    await imManager.connectUserFeishu(
      userId,
      { appId: 'app-id', appSecret: 'app-secret' },
      vi.fn(),
      {
        resolveManagedCommandText: (_chatJid, text) =>
          restartGuard.resolveManagedSelfRestartCommand(text),
      },
    );

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');
    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: chatId,
        message_id: messageId,
        create_time: '1777070340000',
        message_type: 'text',
        content: JSON.stringify({ text: '请只处理这条飞书消息' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_process_group',
        },
      },
    });
    await expect(wakeup).resolves.toBe('woke');

    const runtimeIdentity = {
      agentType: 'openai' as const,
      model: 'gpt-5.1',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    };
    hoisted.runAgentProcess.mockImplementation(
      async (_group, input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'init',
            turnId: messageId,
            sessionId: 'sess-feishu-process-group',
            messageCursor: input.messageCursor,
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'thinking_delta',
            text: '检查当前请求',
            turnId: messageId,
            sessionId: 'sess-feishu-process-group',
            runtimeIdentity,
          },
        });
        await vi.waitFor(() => {
          expect(hoisted.cardCreateSpy).toHaveBeenCalledTimes(1);
        });
        await onOutput?.({
          status: 'success',
          result: finalText,
          newSessionId: 'sess-feishu-process-group',
          runtimeIdentity,
          turnId: messageId,
          sessionId: 'sess-feishu-process-group',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        });
        return { status: 'success' };
      },
    );

    await expect(processGroupMessages(chatJid)).resolves.toBe(true);

    expect(hoisted.runAgentProcess).toHaveBeenCalledOnce();
    const prompt = hoisted.runAgentProcess.mock.calls[0][1].prompt;
    expect(prompt).toContain('请只处理这条飞书消息');
    for (const snippet of forbiddenSnippets) {
      expect(prompt).not.toContain(snippet);
    }

    await vi.waitFor(() => {
      expect(JSON.stringify(hoisted.updatedCards.at(-1))).toContain(finalText);
    });
    const finalCardJson = JSON.stringify(hoisted.updatedCards.at(-1));
    expect(finalCardJson).toContain(finalText);
    for (const snippet of forbiddenSnippets) {
      expect(finalCardJson).not.toContain(snippet);
    }

    const inboundMessages = db.getMessagesSince(chatJid, {
      timestamp: '',
      id: '',
    });
    const chatMessages = db.getMessagesPage(chatJid, undefined, 10);
    const assistantMessages = chatMessages.filter(
      (message: any) => message.sender === 'cli-claw-agent',
    );
    const finalAssistantMessage = assistantMessages[0];
    expect(finalAssistantMessage?.content).toBe(finalText);
    for (const snippet of forbiddenSnippets) {
      expect(finalAssistantMessage?.content).not.toContain(snippet);
    }

    const currentUserMessage = inboundMessages.find(
      (message: any) => message.id === messageId,
    );
    expect(
      JSON.parse(db.getRouterState('last_committed_cursor') ?? '{}'),
    ).toEqual({
      [chatJid]: {
        timestamp: currentUserMessage?.timestamp,
        id: messageId,
      },
    });

    const lifecycle = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid,
      messageId,
    });
    expect(lifecycle.map((event: any) => event.stage)).toEqual([
      'received',
      'stored',
      'notified',
      'stream_started',
      'finalized',
      'im_delivered',
      'cursor_committed',
    ]);
    expect(lifecycle.every((event: any) => event.status === 'ok')).toBe(true);
  });

  test('renders OpenAI runner errors in Feishu without leaking raw SDK JSON', async () => {
    const { db, notifier, imManager, restartGuard, processGroupMessages } =
      await loadFeishuProcessGroupModules();
    const chatId = 'oc_openai_error_no_raw_json';
    const chatJid = `feishu:${chatId}`;
    const userId = 'user-feishu-openai-error';
    const messageId = 'om_openai_error_no_raw_json';
    const friendlyError =
      'OpenAI runtime request was rejected by Codex backend (400). Check the latest process log for the request id, update and restart cli-claw, then retry.';
    const rawError =
      '{ "name": "Error", "message": "400 status code (no body)", "status": 400, "headers": {}, "requestID": null }';
    const forbiddenSnippets = [
      rawError,
      '"headers"',
      '"requestID"',
      '"status": 400',
      '400 status code (no body)',
    ];

    db.setRegisteredGroup(chatJid, {
      name: 'Feishu OpenAI Error',
      folder: 'feishu-openai-error',
      added_at: '2026-05-16T13:10:00.000Z',
      agentType: 'openai',
      activation_mode: 'auto',
      created_by: userId,
    });
    db.ensureChatExists(chatJid);

    await imManager.connectUserFeishu(
      userId,
      { appId: 'app-id', appSecret: 'app-secret' },
      vi.fn(),
      {
        resolveManagedCommandText: (_chatJid, text) =>
          restartGuard.resolveManagedSelfRestartCommand(text),
      },
    );

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');
    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: chatId,
        message_id: messageId,
        create_time: '1778937000000',
        message_type: 'text',
        content: JSON.stringify({ text: "what's up" }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_openai_error',
        },
      },
    });
    await expect(wakeup).resolves.toBe('woke');

    const runtimeIdentity = {
      agentType: 'openai' as const,
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
      supportsReasoningEffort: true,
    };
    hoisted.runAgentProcess.mockImplementation(
      async (_group, input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'init',
            turnId: messageId,
            sessionId: 'sess-openai-error',
            messageCursor: input.messageCursor,
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'thinking_delta',
            text: '正在连接 OpenAI runtime...',
            turnId: messageId,
            sessionId: 'sess-openai-error',
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'error',
          result: friendlyError,
          error: friendlyError,
          alreadyStreamedError: true,
          newSessionId: 'sess-openai-error',
          runtimeIdentity,
          turnId: messageId,
          sessionId: 'sess-openai-error',
          sourceKind: 'sdk_final',
          finalizationReason: 'error',
        });
        return { status: 'error', error: friendlyError };
      },
    );

    await expect(processGroupMessages(chatJid)).resolves.toBe(true);

    const sentInteractiveCards = hoisted.createSpy.mock.calls
      .map((call) => call[0]?.data)
      .filter((data) => data?.msg_type === 'interactive' && data?.content)
      .map((data) => JSON.parse(data.content));
    const allCardPayloads = [
      ...hoisted.createdCards,
      ...hoisted.updatedCards,
      ...sentInteractiveCards,
    ].map((card) => JSON.stringify(card));

    expect(
      allCardPayloads.some((payload) => payload.includes(friendlyError)),
    ).toBe(true);
    for (const payload of allCardPayloads) {
      for (const snippet of forbiddenSnippets) {
        expect(payload).not.toContain(snippet);
      }
    }

    const assistantMessages = db
      .getMessagesPage(chatJid, undefined, 10)
      .filter((message: any) => message.sender === 'cli-claw-agent');
    expect(assistantMessages[0]?.content).toBe(friendlyError);
    for (const snippet of forbiddenSnippets) {
      expect(assistantMessages[0]?.content).not.toContain(snippet);
    }

    const lifecycleStages = db
      .getImMessageLifecycleEvents({
        provider: 'feishu',
        chatJid,
        messageId,
      })
      .map((event: any) => event.stage);
    expect(lifecycleStages).toContain('finalized');
    expect(lifecycleStages).toContain('im_delivered');
    expect(lifecycleStages).toContain('cursor_committed');
  });

  test('resets real Feishu streaming card payload when the message cursor changes even if the runner reuses a turn id', async () => {
    const { db, notifier, imManager, restartGuard, processGroupMessages } =
      await loadFeishuProcessGroupModules();
    const chatId = 'oc_cursor_boundary_card';
    const chatJid = `feishu:${chatId}`;
    const userId = 'user-feishu-cursor-boundary';
    const messageId = 'om_cursor_boundary_current';
    const staleCursor = {
      timestamp: '2026-04-28T06:00:00.000Z',
      id: 'om_stale_hkipo',
    };
    const finalText = '当前请求：只清理 PLANS 文档，卡片只展示本轮结果。';
    const forbiddenSnippets = [
      'stock-analysis-skill',
      'hkexnews',
      '港股 IPO 旧任务',
      '旧工具 trace',
    ];

    db.setRegisteredGroup(chatJid, {
      name: 'Feishu Cursor Boundary',
      folder: 'feishu-cursor-boundary',
      added_at: '2026-04-29T09:00:00.000Z',
      agentType: 'openai',
      activation_mode: 'auto',
      created_by: userId,
    });
    db.ensureChatExists(chatJid);

    await imManager.connectUserFeishu(
      userId,
      { appId: 'app-id', appSecret: 'app-secret' },
      vi.fn(),
      {
        resolveManagedCommandText: (_chatJid, text) =>
          restartGuard.resolveManagedSelfRestartCommand(text),
      },
    );

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');
    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: chatId,
        message_id: messageId,
        create_time: '1777070345000',
        message_type: 'text',
        content: JSON.stringify({
          text: '检查 PLANS/ACTIVE 和 ROADMAP，只保留未完成规划',
        }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_cursor_boundary',
        },
      },
    });
    await expect(wakeup).resolves.toBe('woke');

    const runtimeIdentity = {
      agentType: 'openai' as const,
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    };
    hoisted.runAgentProcess.mockImplementation(
      async (_group, input, _onProcess, onOutput) => {
        const reusedTurnId = 'turn-reused-after-restart';
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'init',
            turnId: reusedTurnId,
            sessionId: 'sess-cursor-boundary',
            messageCursor: staleCursor,
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'tool_use_start',
            turnId: reusedTurnId,
            sessionId: 'sess-cursor-boundary',
            messageCursor: staleCursor,
            toolUseId: 'tool-stale-hkipo',
            toolName: 'stock-analysis-skill',
            toolInputSummary: 'site:www1.hkexnews.hk 港股 IPO 旧工具 trace',
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'text_delta',
            text: '港股 IPO 旧任务正文，不允许出现在当前卡片。',
            turnId: reusedTurnId,
            sessionId: 'sess-cursor-boundary',
            messageCursor: staleCursor,
            runtimeIdentity,
          },
        });

        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'init',
            turnId: reusedTurnId,
            sessionId: 'sess-cursor-boundary',
            messageCursor: input.messageCursor,
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'text_delta',
            text: '正在处理当前 PLANS 清理请求。',
            turnId: reusedTurnId,
            sessionId: 'sess-cursor-boundary',
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'success',
          result: finalText,
          newSessionId: 'sess-cursor-boundary',
          runtimeIdentity,
          turnId: reusedTurnId,
          sessionId: 'sess-cursor-boundary',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        });
        return { status: 'success' };
      },
    );

    await expect(processGroupMessages(chatJid)).resolves.toBe(true);

    const sentInteractiveCards = hoisted.createSpy.mock.calls
      .map((call) => call[0]?.data)
      .filter((data) => data?.msg_type === 'interactive' && data?.content)
      .map((data) => JSON.parse(data.content));
    const allCardPayloads = [
      ...hoisted.createdCards,
      ...hoisted.updatedCards,
      ...sentInteractiveCards,
    ].map((card) => JSON.stringify(card));

    expect(allCardPayloads.some((payload) => payload.includes(finalText))).toBe(
      true,
    );
    for (const snippet of forbiddenSnippets) {
      for (const payload of allCardPayloads) {
        expect(payload).not.toContain(snippet);
      }
    }

    const assistantMessages = db
      .getMessagesPage(chatJid, undefined, 10)
      .filter((message: any) => message.sender === 'cli-claw-agent');
    expect(assistantMessages[0]?.content).toBe(finalText);
  });

  test('does not write OpenAI replayed presentation text into real Feishu streaming cards for the current cursor', async () => {
    const { db, notifier, imManager, restartGuard, processGroupMessages } =
      await loadFeishuProcessGroupModules();
    const chatId = 'oc_openai_current_cursor_replay';
    const chatJid = `feishu:${chatId}`;
    const userId = 'user-feishu-current-cursor-replay';
    const messageId = 'om_current_cursor_agent_skills';
    const finalText =
      '当前请求：agent-skills 的 AGENTS.md 和 .gitignore 已处理完成。';
    const replayedPresentationText = [
      '我会先按技能指引查看 Futu 相关说明。',
      'Futu_OpenD 已启动，127.0.0.1:11111 也能连通。',
      '建议把历史配置项带进当前回答。',
    ].join('\n');
    const forbiddenSnippets = [
      'Futu',
      'Futu_OpenD',
      '127.0.0.1:11111',
      '历史配置项',
    ];

    db.setRegisteredGroup(chatJid, {
      name: 'Feishu OpenAI Current Cursor Replay',
      folder: 'feishu-current-cursor-replay',
      added_at: '2026-04-30T10:37:00.000Z',
      agentType: 'openai',
      activation_mode: 'auto',
      created_by: userId,
    });
    db.ensureChatExists(chatJid);

    await imManager.connectUserFeishu(
      userId,
      { appId: 'app-id', appSecret: 'app-secret' },
      vi.fn(),
      {
        resolveManagedCommandText: (_chatJid, text) =>
          restartGuard.resolveManagedSelfRestartCommand(text),
      },
    );

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');
    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: chatId,
        message_id: messageId,
        create_time: '1777545420000',
        message_type: 'text',
        content: JSON.stringify({
          text: '帮我分析下 agent-skills 项目内容，初始化 skill 的 AGENTS.md，并在根目录加上 gitignore',
        }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_current_cursor_replay',
        },
      },
    });
    await expect(wakeup).resolves.toBe('woke');

    const runtimeIdentity = {
      agentType: 'openai' as const,
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };
    hoisted.runAgentProcess.mockImplementation(
      async (_group, input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'init',
            turnId: messageId,
            sessionId: 'sess-current-cursor-replay',
            messageCursor: input.messageCursor,
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'text_delta',
            text: replayedPresentationText,
            turnId: messageId,
            sessionId: 'sess-current-cursor-replay',
            messageCursor: input.messageCursor,
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'tool_use_start',
            turnId: messageId,
            sessionId: 'sess-current-cursor-replay',
            toolUseId: 'tool-current-agent-skills',
            toolName: 'exec_command',
            toolInputSummary: 'Read AGENTS.md and inspect agent-skills',
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'success',
          result: finalText,
          newSessionId: 'sess-current-cursor-replay',
          runtimeIdentity,
          turnId: messageId,
          sessionId: 'sess-current-cursor-replay',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        });
        return { status: 'success' };
      },
    );

    await expect(processGroupMessages(chatJid)).resolves.toBe(true);

    const sentInteractiveCards = hoisted.createSpy.mock.calls
      .map((call) => call[0]?.data)
      .filter((data) => data?.msg_type === 'interactive' && data?.content)
      .map((data) => JSON.parse(data.content));
    const allCardPayloads = [
      ...hoisted.createdCards,
      ...hoisted.updatedCards,
      ...sentInteractiveCards,
    ].map((card) => JSON.stringify(card));

    expect(allCardPayloads.some((payload) => payload.includes(finalText))).toBe(
      true,
    );
    for (const payload of allCardPayloads) {
      for (const snippet of forbiddenSnippets) {
        expect(payload).not.toContain(snippet);
      }
    }

    const assistantMessages = db
      .getMessagesPage(chatJid, undefined, 10)
      .filter((message: any) => message.sender === 'cli-claw-agent');
    expect(assistantMessages[0]?.content).toBe(finalText);
  });

  test('routes current Feishu stream events without replay gates', async () => {
    const { db, notifier, imManager, restartGuard, processGroupMessages } =
      await loadFeishuProcessGroupModules();
    const chatId = 'oc_openai_current_live_stream';
    const chatJid = `feishu:${chatId}`;
    const userId = 'user-feishu-current-live-stream';
    const messageId = 'om_current_live_stream';
    const finalText = '已更新 /hkipo 申购冲突语义与飞书换行模板。';

    db.setRegisteredGroup(chatJid, {
      name: 'Feishu Current Live Stream',
      folder: 'feishu-current-live-stream',
      added_at: '2026-05-05T03:19:00.000Z',
      agentType: 'openai',
      activation_mode: 'auto',
      created_by: userId,
    });
    db.ensureChatExists(chatJid);

    await imManager.connectUserFeishu(
      userId,
      { appId: 'app-id', appSecret: 'app-secret' },
      vi.fn(),
      {
        resolveManagedCommandText: (_chatJid, text) =>
          restartGuard.resolveManagedSelfRestartCommand(text),
      },
    );

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');
    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: chatId,
        message_id: messageId,
        create_time: '1777951172256',
        message_type: 'text',
        content: JSON.stringify({
          text: '每个小点上方都要换行，申购冲突只比较当前 IPO 池',
        }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_current_live_stream',
        },
      },
    });
    await expect(wakeup).resolves.toBe('woke');

    const runtimeIdentity = {
      agentType: 'openai' as const,
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    };
    hoisted.runAgentProcess.mockImplementation(
      async (_group, input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'init',
            turnId: messageId,
            sessionId: 'sess-current-live-stream',
            messageCursor: input.messageCursor,
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'tool_use_start',
            turnId: messageId,
            sessionId: 'sess-current-live-stream',
            messageCursor: input.messageCursor,
            toolUseId: 'current-hkipo-patch',
            toolName: 'apply_patch',
            toolInputSummary: 'update hkipo conflict wording and spacing',
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'success',
          result: finalText,
          newSessionId: 'sess-current-live-stream',
          runtimeIdentity,
          turnId: messageId,
          sessionId: 'sess-current-live-stream',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        });
        return { status: 'success' };
      },
    );

    await expect(processGroupMessages(chatJid)).resolves.toBe(true);

    const sentInteractiveCards = hoisted.createSpy.mock.calls
      .map((call) => call[0]?.data)
      .filter((data) => data?.msg_type === 'interactive' && data?.content)
      .map((data) => JSON.parse(data.content));
    const allCardPayloads = [
      ...hoisted.createdCards,
      ...hoisted.updatedCards,
      ...sentInteractiveCards,
    ].map((card) => JSON.stringify(card));

    expect(allCardPayloads.some((payload) => payload.includes(finalText))).toBe(
      true,
    );
    expect(
      allCardPayloads.some((payload) => payload.includes('apply_patch')),
    ).toBe(true);
    const finalCardPayload = allCardPayloads.find((payload) =>
      payload.includes(finalText),
    );
    expect(finalCardPayload).toContain('apply_patch');
  });

  test('discards restart streaming residue before the first real Feishu card payload', async () => {
    vi.stubEnv('CLI_CLAW_SELF_CHECK', '1');
    const {
      db,
      notifier,
      imManager,
      restartGuard,
      processGroupMessages,
      encodeJidForFilename,
      loadRouterStateForTests,
      recoverStreamingBufferForTests,
      DATA_DIR,
    } = await loadFeishuProcessGroupModules();
    const chatId = 'oc_restart_residue_card';
    const chatJid = `feishu:${chatId}`;
    const userId = 'user-feishu-restart-residue';
    const messageId = 'om_restart_residue_current';
    const staleCursor = {
      timestamp: '2026-04-28T06:00:00.000Z',
      id: 'om_restart_residue_old_hkipo',
    };
    const previousCursor = {
      timestamp: '2026-04-28T05:59:00.000Z',
      id: 'om_restart_residue_previous',
    };
    const finalText = '当前请求：PLANS 清理已完成，卡片不包含重启前残留。';
    const forbiddenSnippets = [
      'stock-analysis-skill',
      'hkexnews',
      '港股 IPO',
      '旧工具 trace',
    ];

    db.setRegisteredGroup(chatJid, {
      name: 'Feishu Restart Residue Card',
      folder: 'feishu-restart-residue-card',
      added_at: '2026-04-29T09:10:00.000Z',
      agentType: 'openai',
      activation_mode: 'auto',
      created_by: userId,
    });
    db.ensureChatExists(chatJid);
    db.setRouterState(
      'last_committed_cursor',
      JSON.stringify({ [chatJid]: previousCursor }),
    );
    db.setRouterState(
      'active_streaming_turns',
      JSON.stringify({
        [chatJid]: {
          commitJid: chatJid,
          replyJid: chatJid,
          snapshotJid: chatJid,
          cursor: staleCursor,
          turnId: 'turn-old-hkipo',
          messageCursorId: staleCursor.id,
        },
      }),
    );
    const bufferDir = path.join(DATA_DIR, 'streaming-buffer');
    fs.mkdirSync(bufferDir, { recursive: true });
    const bufferPath = path.join(
      bufferDir,
      `${encodeJidForFilename(chatJid)}.json`,
    );
    fs.writeFileSync(
      bufferPath,
      JSON.stringify({
        text: '港股 IPO 旧正文不允许恢复到首条飞书卡片',
        commentaryText:
          'stock-analysis-skill site:www1.hkexnews.hk 旧工具 trace',
        streamingKey: chatJid,
        snapshotJid: chatJid,
        commitJid: chatJid,
        replyJid: chatJid,
        cursor: staleCursor,
        turnId: 'turn-old-hkipo',
        messageCursorId: staleCursor.id,
      }),
    );

    loadRouterStateForTests();
    recoverStreamingBufferForTests();
    expect(fs.existsSync(bufferPath)).toBe(false);
    expect(
      JSON.parse(db.getRouterState('active_streaming_turns') || '{}'),
    ).toEqual({});
    expect(
      JSON.parse(db.getRouterState('last_committed_cursor') || '{}'),
    ).toEqual({ [chatJid]: previousCursor });

    await imManager.connectUserFeishu(
      userId,
      { appId: 'app-id', appSecret: 'app-secret' },
      vi.fn(),
      {
        resolveManagedCommandText: (_chatJid, text) =>
          restartGuard.resolveManagedSelfRestartCommand(text),
      },
    );

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');
    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: chatId,
        message_id: messageId,
        create_time: '1777070350000',
        message_type: 'text',
        content: JSON.stringify({
          text: '检查 cli-claw PLANS，只清理已完成内容',
        }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_restart_residue',
        },
      },
    });
    await expect(wakeup).resolves.toBe('woke');

    const runtimeIdentity = {
      agentType: 'openai' as const,
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    };
    hoisted.runAgentProcess.mockImplementation(
      async (_group, input, _onProcess, onOutput) => {
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'init',
            turnId: 'turn-current-after-restart',
            sessionId: 'sess-restart-residue',
            messageCursor: input.messageCursor,
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity,
          streamEvent: {
            eventType: 'text_delta',
            text: '当前 PLANS 清理请求处理中。',
            turnId: 'turn-current-after-restart',
            sessionId: 'sess-restart-residue',
            runtimeIdentity,
          },
        });
        await onOutput?.({
          status: 'success',
          result: finalText,
          newSessionId: 'sess-restart-residue',
          runtimeIdentity,
          turnId: 'turn-current-after-restart',
          sessionId: 'sess-restart-residue',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        });
        return { status: 'success' };
      },
    );

    await expect(processGroupMessages(chatJid)).resolves.toBe(true);

    const prompt = hoisted.runAgentProcess.mock.calls[0][1].prompt;
    expect(prompt).toContain('检查 cli-claw PLANS');
    for (const snippet of forbiddenSnippets) {
      expect(prompt).not.toContain(snippet);
    }

    const sentInteractiveCards = hoisted.createSpy.mock.calls
      .map((call) => call[0]?.data)
      .filter((data) => data?.msg_type === 'interactive' && data?.content)
      .map((data) => JSON.parse(data.content));
    const allCardPayloads = [
      ...hoisted.createdCards,
      ...hoisted.updatedCards,
      ...sentInteractiveCards,
    ].map((card) => JSON.stringify(card));

    expect(allCardPayloads.some((payload) => payload.includes(finalText))).toBe(
      true,
    );
    for (const snippet of forbiddenSnippets) {
      for (const payload of allCardPayloads) {
        expect(payload).not.toContain(snippet);
      }
    }

    const storedText = db
      .getMessagesPage(chatJid, undefined, 20)
      .map((message: any) => message.content)
      .join('\n');
    expect(storedText).toContain(finalText);
    for (const snippet of forbiddenSnippets) {
      expect(storedText).not.toContain(snippet);
    }
  });

  test('does not reuse an assistant-prompt polluted session for later ordinary Feishu messages', async () => {
    vi.stubEnv('CLI_CLAW_SELF_CHECK', '1');
    const {
      db,
      notifier,
      imManager,
      restartGuard,
      processGroupMessages,
      loadRouterStateForTests,
    } = await loadFeishuProcessGroupModules();
    const chatId = 'oc_skill_session_isolation';
    const chatJid = `feishu:${chatId}`;
    const userId = 'user-feishu-skill-session';
    const skillMessageId = 'om_hkipo_skill_prompt';
    const priorNormalMessageId = 'om_prior_normal_from_polluted_session';
    const currentMessageId = 'om_check_streaming_current';
    const skillCursor = {
      timestamp: '2026-04-29T15:04:38.401Z',
      id: skillMessageId,
    };
    const priorNormalCursor = {
      timestamp: '2026-04-29T15:34:46.435Z',
      id: priorNormalMessageId,
    };
    const oldSkillFinal = [
      '我会按 `stock-analysis-skill` 的港股 IPO 流程执行。',
      '',
      '**港股 IPO 池｜2026-04-29**',
      '- 01609 天星医疗',
    ].join('\n');
    const currentFinal =
      '当前结论：thinking_delta 和 text_delta 都能流式输出。';

    db.setRegisteredGroup(chatJid, {
      name: 'Feishu Skill Session Isolation',
      folder: 'main',
      added_at: '2026-04-29T15:00:00.000Z',
      agentType: 'openai',
      activation_mode: 'auto',
      is_home: true,
      created_by: userId,
    });
    db.ensureChatExists(chatJid);
    db.storeMessageDirect(
      skillMessageId,
      chatJid,
      'ou_skill',
      'Skill User',
      '今天是 2026-04-29。这是由 stock-analysis-skill 的 /hkipo 触发的港股 IPO 池研究任务。',
      skillCursor.timestamp,
      false,
      {
        sourceJid: chatJid,
        meta: { sourceKind: 'assistant_prompt' },
      },
    );
    db.storeMessageDirect(
      'assistant-hkipo-final',
      chatJid,
      'cli-claw-agent',
      'cli-claw',
      oldSkillFinal,
      '2026-04-29T15:14:12.617Z',
      true,
      {
        sourceJid: chatJid,
        meta: {
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
          sessionId: 'sess-hkipo-skill',
        },
      },
    );
    db.storeMessageDirect(
      priorNormalMessageId,
      chatJid,
      'ou_skill',
      'Skill User',
      '帮我检查下现在能不能流式输出 thinking answer',
      priorNormalCursor.timestamp,
      false,
      { sourceJid: chatJid },
    );
    db.storeMessageDirect(
      'assistant-prior-normal-final',
      chatJid,
      'cli-claw-agent',
      'cli-claw',
      `${oldSkillFinal}\n${currentFinal}`,
      '2026-04-29T15:37:57.193Z',
      true,
      {
        sourceJid: chatJid,
        meta: {
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
          sessionId: 'sess-hkipo-skill',
        },
      },
    );
    db.setSession('main', 'sess-hkipo-skill');
    db.setRouterState(
      'last_agent_timestamp',
      JSON.stringify({ [chatJid]: priorNormalCursor }),
    );
    db.setRouterState(
      'last_committed_cursor',
      JSON.stringify({ [chatJid]: priorNormalCursor }),
    );
    loadRouterStateForTests();

    await imManager.connectUserFeishu(
      userId,
      { appId: 'app-id', appSecret: 'app-secret' },
      vi.fn(),
      {
        resolveManagedCommandText: (_chatJid, text) =>
          restartGuard.resolveManagedSelfRestartCommand(text),
      },
    );

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');
    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: chatId,
        message_id: currentMessageId,
        create_time: '1777478552212',
        message_type: 'text',
        content: JSON.stringify({
          text: '帮我检查下现在能不能流式输出 thinking answer',
        }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_skill',
        },
      },
    });
    await expect(wakeup).resolves.toBe('woke');

    hoisted.runAgentProcess.mockImplementation(
      async (_group, input, _onProcess, onOutput) => {
        const leaked = input.sessionId === 'sess-hkipo-skill';
        const resultText = leaked
          ? `${oldSkillFinal}\n${currentFinal}`
          : currentFinal;
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity: { agentType: 'openai' as const },
          streamEvent: {
            eventType: 'init',
            turnId: currentMessageId,
            sessionId: leaked ? 'sess-hkipo-skill' : 'sess-current-normal',
            messageCursor: input.messageCursor,
            runtimeIdentity: { agentType: 'openai' as const },
          },
        });
        await onOutput?.({
          status: 'stream',
          result: null,
          runtimeIdentity: { agentType: 'openai' as const },
          streamEvent: {
            eventType: 'text_delta',
            text: resultText,
            turnId: currentMessageId,
            sessionId: leaked ? 'sess-hkipo-skill' : 'sess-current-normal',
            runtimeIdentity: { agentType: 'openai' as const },
          },
        });
        await onOutput?.({
          status: 'success',
          result: resultText,
          newSessionId: 'sess-current-normal',
          runtimeIdentity: { agentType: 'openai' as const },
          turnId: currentMessageId,
          sessionId: leaked ? 'sess-hkipo-skill' : 'sess-current-normal',
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        });
        return { status: 'success' };
      },
    );

    await expect(processGroupMessages(chatJid)).resolves.toBe(true);

    expect(hoisted.runAgentProcess).toHaveBeenCalledOnce();
    expect(hoisted.runAgentProcess.mock.calls[0][1].sessionId).toBeUndefined();

    const sentInteractiveCards = hoisted.createSpy.mock.calls
      .map((call) => call[0]?.data)
      .filter((data) => data?.msg_type === 'interactive' && data?.content)
      .map((data) => JSON.parse(data.content));
    const allCardPayloads = [
      ...hoisted.createdCards,
      ...hoisted.updatedCards,
      ...sentInteractiveCards,
    ].map((card) => JSON.stringify(card));

    expect(
      allCardPayloads.some((payload) => payload.includes(currentFinal)),
    ).toBe(true);
    for (const payload of allCardPayloads) {
      expect(payload).not.toContain('stock-analysis-skill');
      expect(payload).not.toContain('港股 IPO');
      expect(payload).not.toContain('01609 天星医疗');
    }

    const storedText = db
      .getMessagesPage(chatJid, undefined, 20)
      .filter((message: any) => message.session_id === 'sess-current-normal')
      .map((message: any) => message.content)
      .join('\n');
    expect(storedText).toContain(currentFinal);
    expect(storedText).not.toContain(`${oldSkillFinal}\n${currentFinal}`);
    expect(db.getSession('main')).toBe('sess-current-normal');
  });

  test('sends current OpenAI raw final to Feishu when presentation contains stale transcript', async () => {
    const { db, notifier, feishu, restartGuard } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    const chatJid = 'feishu:oc_openai_stale_presentation';
    const messageId = 'om_openai_stale_presentation';
    const rawFinalText = [
      '我先查实际链路，不先猜。',
      '',
      '不符合流式输出预期，当前 OpenAI 飞书卡片被禁用。',
    ].join('\n');
    const stalePresentationAnswer = [
      '我会按仓库协议先补读工程说明和当前计划，再定位 `stock-analysis-skill`。',
      '旧 hkipo 过程。'.repeat(1000),
      rawFinalText,
    ].join('\n');

    await connection.connect({
      onReady: vi.fn(),
      onCommand: vi.fn(),
      onNewChat: vi.fn(),
      resolveManagedCommandText: (_chatJid, text) =>
        restartGuard.resolveManagedSelfRestartCommand(text),
    });

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_openai_stale_presentation',
        message_id: messageId,
        create_time: '1777070338000',
        message_type: 'text',
        content: JSON.stringify({ text: '为什么又输出历史上下文' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_openai',
        },
      },
    });

    await expect(wakeup).resolves.toBe('woke');

    await driveQueuedFeishuOpenAIStaticFinalPath({
      db,
      connection,
      chatJid,
      messageId,
      rawFinalText,
      stalePresentationAnswer,
    });

    const sentData = hoisted.createSpy.mock.calls.at(-1)?.[0].data ?? {};
    const sentCard = JSON.parse(sentData.content);
    const sentMarkdown = sentCard.body.elements[0].content;
    expect(sentData.msg_type).toBe('interactive');
    expect(sentMarkdown).toBe(rawFinalText);
    expect(JSON.stringify(sentData)).not.toContain('stock-analysis-skill');
    expect(JSON.stringify(sentData)).not.toContain('旧 hkipo 过程');

    const lifecycle = db.getImMessageLifecycleEvents({
      provider: 'feishu',
      chatJid,
      messageId,
    });
    expect(lifecycle.map((event: any) => event.stage)).toEqual([
      'received',
      'stored',
      'notified',
      'queued',
      'runner_started',
      'finalized',
      'im_delivered',
      'cursor_committed',
    ]);
    const finalized = lifecycle.find(
      (event: any) => event.stage === 'finalized',
    );
    expect(finalized?.details).toMatchObject({
      droppedPresentationAnswer: true,
      visibilityResolution: {
        agentType: 'openai',
        selectedSource: 'raw_final',
        rawFinalLength: rawFinalText.length,
        presentationAnswerLength: stalePresentationAnswer.length,
        visibleTextLength: rawFinalText.length,
      },
    });
  });

  test('routes explicit managed restart phrases without storing them as model messages', async () => {
    const { db, feishu, restartGuard } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });
    const onCommand = vi.fn().mockResolvedValue('自重启受理成功');

    await connection.connect({
      onReady: vi.fn(),
      onCommand,
      onNewChat: vi.fn(),
      resolveManagedCommandText: (_chatJid, text) =>
        restartGuard.resolveManagedSelfRestartCommand(text),
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_restart_chat',
        message_id: 'om_managed_restart',
        create_time: '1777070334000',
        message_type: 'text',
        content: JSON.stringify({ text: '重启服务' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_restart',
        },
      },
    });

    expect(onCommand).toHaveBeenCalledWith(
      'feishu:oc_restart_chat',
      'self-restart',
    );
    expect(hoisted.createSpy).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_restart_chat',
        msg_type: 'text',
        content: JSON.stringify({ text: '自重启受理成功' }),
      },
    });
    expect(
      db.getMessagesSince('feishu:oc_restart_chat', { timestamp: '', id: '' }),
    ).toHaveLength(0);
  });

  test('records duplicate Feishu deliveries without storing or notifying twice', async () => {
    const { db, notifier, feishu } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: vi.fn(),
      onNewChat: vi.fn(),
    });

    const payload = {
      message: {
        chat_id: 'oc_duplicate_chat',
        message_id: 'om_duplicate_message',
        create_time: '1777070335000',
        message_type: 'text',
        content: JSON.stringify({ text: '继续任务' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_duplicate',
        },
      },
    };

    const wakeup = notifier.interruptibleSleep(10_000).then(() => 'woke');
    await hoisted.handlers['im.message.receive_v1']?.(payload);
    await expect(wakeup).resolves.toBe('woke');
    await hoisted.handlers['im.message.receive_v1']?.(payload);

    expect(
      db.getMessagesSince('feishu:oc_duplicate_chat', {
        timestamp: '',
        id: '',
      }),
    ).toHaveLength(1);
    expect(
      db
        .getImMessageLifecycleEvents({
          provider: 'feishu',
          chatJid: 'feishu:oc_duplicate_chat',
          messageId: 'om_duplicate_message',
        })
        .map((event) => [event.stage, event.status, event.reason]),
    ).toEqual([
      ['received', 'ok', null],
      ['stored', 'ok', null],
      ['notified', 'ok', null],
      ['received', 'ok', null],
      ['skipped', 'skipped', 'duplicate'],
    ]);
  });

  test('skips stale startup backfill messages before they poison duplicate detection', async () => {
    const { db, feishu } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    hoisted.messageListSpy.mockResolvedValueOnce({
      data: {
        items: [
          {
            message_id: 'om_stale_message',
            create_time: '1777070335000',
            msg_type: 'text',
            body: { content: JSON.stringify({ text: '旧消息' }) },
            chat_type: 'p2p',
            sender: {
              sender_id: {
                open_id: 'ou_stale',
              },
            },
          },
        ],
      },
    });

    await connection.connect({
      onReady: vi.fn(),
      onNewChat: vi.fn(),
      startupBackfillChatIds: ['oc_stale_chat'],
      startupBackfillIgnoreMessagesBefore: 1_777_070_336_000,
    });

    expect(
      db.getMessagesSince('feishu:oc_stale_chat', { timestamp: '', id: '' }),
    ).toHaveLength(0);
    expect(
      db
        .getImMessageLifecycleEvents({
          provider: 'feishu',
          chatJid: 'feishu:oc_stale_chat',
          messageId: 'om_stale_message',
        })
        .map((event) => [event.stage, event.status, event.reason]),
    ).toEqual([
      ['received', 'ok', null],
      ['skipped', 'skipped', 'stale_before_reconnection'],
    ]);

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_stale_chat',
        message_id: 'om_stale_message',
        create_time: '1777070335000',
        message_type: 'text',
        content: JSON.stringify({ text: '旧消息重新实时送达' }),
        chat_type: 'p2p',
      },
      sender: {
        sender_id: {
          open_id: 'ou_stale',
        },
      },
    });

    const liveMessages = db.getMessagesSince('feishu:oc_stale_chat', {
      timestamp: '',
      id: '',
    });
    expect(liveMessages).toHaveLength(1);
    expect(liveMessages[0]?.content).toBe('旧消息重新实时送达');
    expect(
      db
        .getImMessageLifecycleEvents({
          provider: 'feishu',
          chatJid: 'feishu:oc_stale_chat',
          messageId: 'om_stale_message',
        })
        .map((event) => [event.stage, event.status, event.reason]),
    ).toEqual([
      ['received', 'ok', null],
      ['skipped', 'skipped', 'stale_before_reconnection'],
      ['received', 'ok', null],
      ['stored', 'ok', null],
      ['notified', 'ok', null],
    ]);
  });

  test('skips unmentioned group messages when mention-gating rejects the chat', async () => {
    const { db, feishu } = await loadFeishuE2EModules();
    const connection = feishu.createFeishuConnection({
      appId: 'app-id',
      appSecret: 'app-secret',
    });

    await connection.connect({
      onReady: vi.fn(),
      onNewChat: vi.fn(),
      shouldProcessGroupMessage: vi.fn(() => false),
    });

    await hoisted.handlers['im.message.receive_v1']?.({
      message: {
        chat_id: 'oc_group_chat',
        message_id: 'om_group_unmentioned',
        create_time: '1777070336000',
        message_type: 'text',
        content: JSON.stringify({ text: '没有 @ bot 的群消息' }),
        chat_type: 'group',
        mentions: [],
      },
      sender: {
        sender_id: {
          open_id: 'ou_group',
        },
      },
    });

    expect(
      db.getMessagesSince('feishu:oc_group_chat', { timestamp: '', id: '' }),
    ).toHaveLength(0);
    expect(
      db
        .getImMessageLifecycleEvents({
          provider: 'feishu',
          chatJid: 'feishu:oc_group_chat',
          messageId: 'om_group_unmentioned',
        })
        .map((event) => [event.stage, event.status, event.reason]),
    ).toEqual([
      ['received', 'ok', null],
      ['skipped', 'skipped', 'mention_required'],
    ]);
  });
});
