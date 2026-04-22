import { describe, expect, test, vi } from 'vitest';

import {
  buildRuntimeSelectionCard,
  buildStaticReplyCard,
  registerMessageIdMapping,
  registerStreamingSession,
  resolveJidByMessageId,
  StreamingCardController,
  unregisterStreamingSession,
} from '../src/feishu-streaming-card.ts';
import { formatToolStepLine } from '../src/tool-step-display.ts';

function createStreamingModeClient() {
  const createdCards: Array<Record<string, any>> = [];
  const updatedCards: Array<Record<string, any>> = [];
  const streamedContents: string[] = [];

  const client = {
    cardkit: {
      v1: {
        card: {
          create: vi.fn(async ({ data }: any) => {
            createdCards.push(JSON.parse(data.data));
            return { data: { card_id: 'card-1' } };
          }),
          update: vi.fn(async ({ data }: any) => {
            updatedCards.push(JSON.parse(data.card.data));
            return { data: {} };
          }),
          settings: vi.fn(async () => ({ data: {} })),
        },
        cardElement: {
          content: vi.fn(async ({ data }: any) => {
            streamedContents.push(data.content);
            return { data: {} };
          }),
        },
      },
    },
    im: {
      v1: {
        message: {
          create: vi.fn(async () => ({ data: { message_id: 'msg-1' } })),
        },
      },
      message: {
        reply: vi.fn(async () => ({ data: { message_id: 'msg-1' } })),
      },
    },
  } as any;

  return { client, createdCards, updatedCards, streamedContents };
}

describe('StreamingCardController footer caching', () => {
  test('caches usage before completion so final footer can still be rendered', async () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'GPT-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    });

    (controller as any).state = 'streaming';

    await controller.patchUsageNote({
      inputTokens: 12_300,
      outputTokens: 34,
      costUSD: 0.0421,
      durationMs: 5_200,
      numTurns: 1,
    });

    expect((controller as any).footerTokenUsage).toMatchObject({
      inputTokens: 12_300,
      outputTokens: 34,
      costUSD: 0.0421,
      durationMs: 5_200,
      numTurns: 1,
    });

    (controller as any).state = 'completed';

    expect((controller as any).getFooterNote()).toBe(
      '5.2s | Codex | GPT-5.4 | xhigh',
    );

    controller.dispose();
  });

  test('finalizes visible runtime errors in aborted state with the final text', async () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    (controller as any).state = 'streaming';
    (controller as any).backendMode = 'legacy';
    (controller as any).messageId = null;

    await controller.fail('Codex CLI 用量已用尽。请稍后重试。');

    expect((controller as any).state).toBe('aborted');
    expect((controller as any).accumulatedText).toBe(
      'Codex CLI 用量已用尽。请稍后重试。',
    );

    controller.dispose();
  });

  test('retains thinking transcript after text arrives so final cards can render it', () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    controller.appendThinking('first thought');
    (controller as any).state = 'streaming';

    controller.append('final answer');

    expect((controller as any).thinkingText).toBe('first thought');

    controller.dispose();
  });

  test('patches aborted cards when late usage arrives so interrupted footers can show time', async () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    (controller as any).state = 'aborted';
    (controller as any).backendMode = 'legacy';
    (controller as any).messageId = 'msg-1';

    let patchedState: string | null = null;
    (controller as any).patchCard = async (state: string) => {
      patchedState = state;
    };

    await controller.patchUsageNote({
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      durationMs: 3_400,
      numTurns: 1,
    });

    expect(patchedState).toBe('aborted');

    controller.dispose();
  });

  test('rethrows completed-card finalize failures so callers can fall back to static IM delivery', async () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    const finalizeErr = new Error('card update failed');
    const backend = {
      disableStreamingMode: vi.fn(async () => {}),
      updateCardFull: vi.fn(async () => {
        throw finalizeErr;
      }),
    } as any;

    (controller as any).state = 'streaming';
    (controller as any).backendMode = 'streaming';
    (controller as any).streamingBackend = backend;
    (controller as any).accumulatedText = 'partial';

    await expect(controller.complete('final answer')).rejects.toThrow(
      'card update failed',
    );
    expect((controller as any).state).toBe('streaming');
    expect(backend.disableStreamingMode).toHaveBeenCalledTimes(1);
    expect(backend.updateCardFull).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  test('formats card tool steps with emoji prefixes', () => {
    expect(formatToolStepLine('exec_command', 'ls -la')).toBe(
      '💻 exec_command · ls -la',
    );
  });

  test('keeps streaming main content close to the original markdown in v1 cards', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.append('go');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    controller.append('Intro\n# Result\n- first');
    await (controller as any).patchCard('streaming');

    const lastCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const mainMarkdown = lastCard?.body?.elements?.find(
      (element: any) =>
        element?.tag === 'markdown' && element?.text_size === 'normal_text',
    );
    expect(mainMarkdown?.content).toBe('Intro\n# Result\n- first');

    controller.dispose();
  });

  test('keeps blank-line boundaries between same-turn commentary updates in v1 cards', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.append('First update\n\n# Second update');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    await (controller as any).patchCard('streaming');

    const lastCard = updatedCards.at(-1);
    const mainMarkdown = lastCard?.body?.elements?.find(
      (element: any) =>
        element?.tag === 'markdown' && element?.text_size === 'normal_text',
    );
    expect(mainMarkdown?.content).toBe('First update\n\n# Second update');

    controller.dispose();
  });

  test('renders Codex commentary in a dedicated collapsible panel instead of the main body', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.appendCommentary('先收集上下文');
    controller.append('最终结论');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    await (controller as any).patchCard('streaming');

    const lastCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const commentaryPanel = lastCard?.body?.elements?.find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💬 Commentary...',
    );
    const mainMarkdown = lastCard?.body?.elements?.find(
      (element: any) =>
        element?.tag === 'markdown' && element?.text_size === 'normal_text',
    );

    expect(commentaryPanel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: true,
      elements: [
        {
          tag: 'markdown',
          content: '先收集上下文',
          text_size: 'notation',
        },
      ],
    });
    expect(mainMarkdown?.content).toBe('最终结论');

    controller.dispose();
  });

  test('renders active steps above commentary in streaming auxiliary panels', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.appendCommentary('先收集上下文');
    controller.startTool('tool-1', 'exec_command');
    controller.updateToolSummary('tool-1', 'ls -la');
    controller.append('最终结论');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    await (controller as any).patchCard('streaming');

    const lastCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const elements = lastCard?.body?.elements ?? [];
    const stepsIndex = elements.findIndex(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        typeof element?.header?.title?.content === 'string' &&
        element.header.title.content.includes('steps'),
    );
    const commentaryIndex = elements.findIndex(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💬 Commentary...',
    );

    expect(stepsIndex).toBeGreaterThanOrEqual(0);
    expect(commentaryIndex).toBeGreaterThanOrEqual(0);
    expect(stepsIndex).toBeLessThan(commentaryIndex);

    controller.dispose();
  });

  test('creates standalone streaming cards without replying to the triggering Feishu message', async () => {
    const { client, createdCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
      replyToMsgId: 'incoming-msg-1',
    });

    controller.append('First answer');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    expect(client.im.v1.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: expect.objectContaining({
        receive_id: 'chat-test',
        msg_type: 'interactive',
      }),
    });
    expect(client.im.message.reply).not.toHaveBeenCalled();

    controller.dispose();
  });

  test('builds static replies with the same schema 2 card shape as streaming cards', () => {
    expect(
      buildStaticReplyCard('# Runtime Update\n\n已切换到 `gpt-5.4`', {
        footerNote: '1.2s | gpt-5.4 | 1.0K tokens',
      }),
    ).toMatchObject({
      schema: '2.0',
      config: {
        summary: { content: 'Runtime Update' },
      },
      body: {
        elements: expect.arrayContaining([
          {
            tag: 'markdown',
            content: '已切换到 `gpt-5.4`',
            text_size: 'normal_text',
          },
          {
            tag: 'markdown',
            content: '*1.2s | gpt-5.4 | 1.0K tokens*',
            text_size: 'notation',
          },
        ]),
      },
    });
  });

  test('renders compact paragraph spacing in static reply cards for plain prose', () => {
    const card = buildStaticReplyCard(
      '第一段说明当前方案。\n\n第二段说明原因。\n\n第三段确认下一步。',
    ) as any;

    const markdownElements = (card.body?.elements ?? []).filter(
      (element: any) =>
        element?.tag === 'markdown' && element?.text_size === 'normal_text',
    );

    expect(markdownElements).toHaveLength(1);
    expect(markdownElements[0]?.content).toBe(
      '第一段说明当前方案。\n<br>\n第二段说明原因。\n<br>\n第三段确认下一步。',
    );
  });

  test('converts interrupted reasoning details blocks into a collapsible panel in static reply cards', () => {
    const card = buildStaticReplyCard(
      [
        '<details>',
        '<summary>💭 Reasoning (已中断)</summary>',
        '',
        '先检查消息接入。',
        '',
        '再检查飞书卡片发送。',
        '',
        '</details>',
        '',
        '---',
        '*⚠️ 已中断*',
      ].join('\n'),
    ) as any;

    const reasoningPanel = (card.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💭 Reasoning (已中断)',
    );

    expect(reasoningPanel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: false,
      elements: [
        {
          tag: 'markdown',
          content: '先检查消息接入。\n\n再检查飞书卡片发送。',
          text_size: 'notation',
        },
      ],
    });
    expect(JSON.stringify(card)).not.toContain('<details>');
  });

  test('creates streaming cards with an expanded thinking collapsible panel like runclaw', async () => {
    const { client, createdCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.appendThinking('first thought');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
    });

    const thinkingPanel = createdCards[0]?.body?.elements?.find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💭 Thinking...',
    );

    expect(thinkingPanel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: true,
      elements: [
        {
          tag: 'markdown',
          content: 'first thought',
          text_size: 'notation',
        },
      ],
    });

    controller.dispose();
  });

  test('renders only the interrupt control in the default streaming footer row', async () => {
    const { client, createdCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'GPT-5.4',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    });
    controller.appendThinking('first thought');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
    });

    const elements = createdCards[0]?.body?.elements ?? [];
    const controlRow = elements.find((el: any) => el?.tag === 'column_set');

    expect(controlRow).toMatchObject({
      tag: 'column_set',
      columns: [{ tag: 'column', elements: [{ tag: 'button' }] }],
    });
    // Every column entry must carry tag: 'column' so Feishu schema 2.0 accepts the layout
    for (const column of controlRow.columns) {
      expect(column.tag).toBe('column');
    }
    expect(elements.filter((el: any) => el?.tag === 'button')).toHaveLength(0);
    expect(
      elements.filter((el: any) => el?.tag === 'select_static'),
    ).toHaveLength(0);

    controller.dispose();
  });

  test('builds a runtime selection card with the expanded Codex model list', () => {
    const card = buildRuntimeSelectionCard({
      selection: 'model',
      runtimeIdentity: {
        agentType: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        supportsReasoningEffort: true,
      },
    }) as any;

    const select = card.body.elements?.[1]?.columns?.[0]?.elements?.[0];
    expect(card.config.summary.content).toBe('选择模型');
    expect(select).toMatchObject({
      tag: 'select_static',
      value: { action: 'set_runtime_model' },
      placeholder: { content: '模型: gpt-5.4' },
      initial_option: 'gpt-5.4',
    });
    expect(select.options).toEqual([
      {
        text: { tag: 'plain_text', content: 'GPT-5.4' },
        value: 'gpt-5.4',
      },
      {
        text: { tag: 'plain_text', content: 'GPT-5.4-Mini' },
        value: 'gpt-5.4-mini',
      },
      {
        text: { tag: 'plain_text', content: 'GPT-5.3-Codex' },
        value: 'gpt-5.3-codex',
      },
      {
        text: { tag: 'plain_text', content: 'GPT-5.2' },
        value: 'gpt-5.2',
      },
    ]);
  });

  test('falls back to the current Codex defaults when selection card inputs are unset', () => {
    const card = buildRuntimeSelectionCard({
      selection: 'effort',
      runtimeIdentity: {
        agentType: 'codex',
        model: null,
        reasoningEffort: null,
        supportsReasoningEffort: true,
      },
    }) as any;

    const select = card.body.elements?.[1]?.columns?.[0]?.elements?.[0];
    expect(select).toMatchObject({
      tag: 'select_static',
      placeholder: { content: '思考强度: medium' },
      initial_option: 'medium',
      value: { action: 'set_runtime_effort' },
    });
  });

  test('omits initial_option when the current value is no longer in the preset list', () => {
    const card = buildRuntimeSelectionCard({
      selection: 'model',
      runtimeIdentity: {
        agentType: 'codex',
        model: 'legacy-model',
        reasoningEffort: 'medium',
        supportsReasoningEffort: true,
      },
    }) as any;

    const select = card.body.elements?.[1]?.columns?.[0]?.elements?.[0];
    expect(select.placeholder).toMatchObject({ content: '模型: legacy-model' });
    expect(select.initial_option).toBeUndefined();
  });

  test('initial streaming card includes a plain streaming note in the v1 card body', async () => {
    const { client, createdCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'GPT-5.4',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    });
    controller.appendThinking('first thought');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
    });

    const elements = createdCards[0]?.body?.elements ?? [];
    const statusNote = elements.find(
      (el: any) => el?.tag === 'markdown' && el?.content === '⏳ 生成中...',
    );
    expect(statusNote).toMatchObject({
      tag: 'markdown',
      content: '⏳ 生成中...',
      text_size: 'notation',
    });

    controller.dispose();
  });

  test('initial streaming card places the interrupt button below the streaming status note', async () => {
    const { client, createdCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.append('First answer');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
    });

    const elements = createdCards[0]?.body?.elements ?? [];
    const statusIndex = elements.findIndex(
      (element: any) =>
        element?.tag === 'markdown' && element?.content === '⏳ 生成中...',
    );
    const interruptIndex = elements.findIndex((element: any) =>
      element?.tag === 'column_set'
        ? element?.columns?.some((column: any) =>
            column?.elements?.some(
              (child: any) =>
                child?.tag === 'button' &&
                child?.text?.content === '⏹ 中断回复',
            ),
          )
        : false,
    );

    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(interruptIndex).toBeGreaterThanOrEqual(0);
    expect(statusIndex).toBeLessThan(interruptIndex);

    controller.dispose();
  });

  test('buildStreamingStatusNote embeds live duration so users see elapsed time before completion', () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'GPT-5.4',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    });
    (controller as any).state = 'streaming';
    (controller as any).startTime = Date.now() - 2_500;

    const note: string = (controller as any).buildStreamingStatusNote();
    expect(note).toContain('⏳ 生成中...');
    expect(note).toMatch(/\d+\.\ds \| Codex \| GPT-5\.4 \| high/);

    controller.dispose();
  });

  test('ignores state mutations after reaching a terminal state so interrupts are not reverted', () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    // Seed pre-abort thinking state directly (avoid scheduling real flushes)
    (controller as any).thinkingText = 'early thought';
    (controller as any).thinking = true;
    (controller as any).state = 'aborted';

    // Each of these would normally mutate state and schedule a patch.
    // After the terminal transition they must be silent no-ops.
    controller.setThinking();
    controller.appendThinking(' late thought');
    controller.startTool('tool-1', 'exec_command');
    controller.updateToolSummary('tool-1', 'ls -la');
    controller.endTool('tool-1', false);
    controller.setSystemStatus('late status');
    controller.setHook({ hookName: 'x', hookEvent: 'y' });
    controller.setTodos([{ id: '1', content: 'wip', status: 'in_progress' }]);
    controller.append('late answer body');

    expect((controller as any).state).toBe('aborted');
    expect((controller as any).thinkingText).toBe('early thought');
    expect((controller as any).toolCalls.size).toBe(0);
    expect((controller as any).systemStatus).toBeNull();
    expect((controller as any).activeHook).toBeNull();
    expect((controller as any).todos).toBeNull();
    expect((controller as any).accumulatedText).toBe('');

    controller.dispose();
  });

  test('aborting during thinking clears active thinking copy and shows duration immediately', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'GPT-5.4',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    });
    controller.appendThinking('first thought');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect((controller as any).state).toBe('streaming');
    });

    (controller as any).startTime = Date.now() - 3_400;
    await controller.abort('已中断');

    await vi.waitFor(() => {
      expect(updatedCards.length).toBeGreaterThan(0);
    });

    const finalCardJson = JSON.stringify(updatedCards.at(-1));
    expect(finalCardJson).toContain('⚠️ 已中断');
    expect(finalCardJson).toMatch(/\d+\.\ds \| Codex \| GPT-5\.4 \| high/);
    expect(finalCardJson).not.toContain('Thinking...');
    expect(finalCardJson).not.toContain('Reasoning...');

    controller.dispose();
  });

  test('re-registering a streaming session clears stale messageId callbacks from the previous session', () => {
    registerMessageIdMapping('old-msg', 'feishu:room');
    registerStreamingSession('feishu:room', {
      isActive: () => true,
      abort: vi.fn().mockResolvedValue(undefined),
      getAllMessageIds: () => ['old-msg'],
    } as any);

    registerStreamingSession('feishu:room', {
      isActive: () => true,
      abort: vi.fn().mockResolvedValue(undefined),
      getAllMessageIds: () => ['new-msg'],
    } as any);

    expect(resolveJidByMessageId('old-msg')).toBeUndefined();
    unregisterStreamingSession('feishu:room');
  });
});
