import { describe, expect, test, vi } from 'vitest';

import * as feishuStreamingCard from '../src/feishu-streaming-card.ts';
import {
  buildRuntimeSelectionCard,
  buildStaticReplyCard,
  registerMessageIdMapping,
  registerStreamingSession,
  resolveJidByMessageId,
  StreamingCardController,
  unregisterStreamingSession,
} from '../src/feishu-streaming-card.ts';
import { resolveVisibleReplyParts } from '../src/reply-visibility.ts';
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
      '5.2s | Codex | GPT-5.4 | xhigh | standard (1x)',
    );

    controller.dispose();
  });

  test('shows remaining quota in card footer when 5h remaining drops below 20%', async () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    });

    (controller as any).state = 'completed';

    await controller.patchUsageNote({
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      durationMs: 5_200,
      numTurns: 1,
      primaryRemainingPct: 19,
      secondaryRemainingPct: 72,
    } as any);

    expect((controller as any).getFooterNote()).toBe(
      '5.2s | Codex | gpt-5.4 | xhigh | standard (1x) | 19% (5h) | 72% (7d)',
    );

    controller.dispose();
  });

  test('shows remaining quota in card footer when week remaining drops below 10%', async () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    });

    (controller as any).state = 'completed';

    await controller.patchUsageNote({
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      durationMs: 5_200,
      numTurns: 1,
      primaryRemainingPct: 42,
      secondaryRemainingPct: 9,
    } as any);

    expect((controller as any).getFooterNote()).toBe(
      '5.2s | Codex | gpt-5.4 | xhigh | standard (1x) | 42% (5h) | 9% (7d)',
    );

    controller.dispose();
  });

  test('shows remaining quota windows in the card footer', async () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    });

    (controller as any).state = 'completed';

    await controller.patchUsageNote({
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      durationMs: 5_200,
      numTurns: 1,
      primaryUsagePct: 72,
      secondaryUsagePct: 96,
      primaryRemainingPct: 28,
      secondaryRemainingPct: 4,
    } as any);

    expect((controller as any).getFooterNote()).toBe(
      '5.2s | Codex | gpt-5.4 | xhigh | standard (1x) | 28% (5h) | 4% (7d)',
    );

    controller.dispose();
  });

  test('does not show used token windows when remaining quota is missing', async () => {
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      supportsReasoningEffort: true,
    });

    (controller as any).state = 'completed';

    await controller.patchUsageNote({
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      durationMs: 5_200,
      numTurns: 1,
      primaryUsagePct: 72,
      secondaryUsagePct: 96,
    } as any);

    expect((controller as any).getFooterNote()).toBe(
      '5.2s | Codex | gpt-5.4 | xhigh | standard (1x)',
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

  test('normalizes completed card markdown with the same block spacing used during streaming', () => {
    const card = buildStaticReplyCard('Intro\n## Result\n- first') as any;
    const mainMarkdown = card?.body?.elements?.find(
      (element: any) =>
        element?.tag === 'markdown' && element?.text_size === 'normal_text',
    );

    expect(mainMarkdown?.content).toBe('Intro\n\n##### Result\n\n- first');
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

  test('places completed-card report body before Codex commentary details', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.appendCommentary('我会先检查标准分析入口。');
    controller.append('临时正文');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    await controller.complete(
      [
        '**/research｜HK.00100｜hk｜2026-05-04**',
        '',
        '**结论摘要**',
        '- MiniMax 是港股标的。',
      ].join('\n'),
    );

    const elements = updatedCards.at(-1)?.body?.elements ?? [];
    const bodyIndex = elements.findIndex(
      (element: any) =>
        element?.tag === 'markdown' &&
        element?.text_size === 'normal_text' &&
        String(element.content).includes('/research｜HK.00100'),
    );
    const commentaryIndex = elements.findIndex(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💬 Commentary',
    );

    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    expect(commentaryIndex).toBeGreaterThanOrEqual(0);
    expect(bodyIndex).toBeLessThan(commentaryIndex);

    controller.dispose();
  });

  test('renders Codex thinking, commentary, body, and live duration footer in streaming cards', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.setRuntimeIdentity({
      agentType: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    });
    (controller as any).startTime = Date.now() - 2_500;

    controller.appendThinking('分析输入');
    controller.appendCommentary('工具检查');
    controller.append('最终正文');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    await (controller as any).patchCard('streaming');

    const lastCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const elements = lastCard?.body?.elements ?? [];
    const panelTitles = elements
      .filter((element: any) => element?.tag === 'collapsible_panel')
      .map((element: any) => element?.header?.title?.content);
    const mainMarkdown = elements.find(
      (element: any) =>
        element?.tag === 'markdown' && element?.text_size === 'normal_text',
    );
    const statusNote = (controller as any).buildStreamingStatusNote();

    expect(panelTitles).toContain('💭 Thinking');
    expect(panelTitles).toContain('💬 Commentary...');
    expect(JSON.stringify(elements)).toContain('分析输入');
    expect(JSON.stringify(elements)).toContain('工具检查');
    expect(mainMarkdown?.content).toBe('最终正文');
    expect(statusNote).toContain('⏳ 生成中...');
    expect(statusNote).toContain('Codex');
    expect(statusNote).toContain('gpt-5.4');
    expect(statusNote).toContain('standard (1x)');

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

  test('keeps all tool calls in Feishu steps instead of truncating to five', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    for (let i = 1; i <= 7; i++) {
      controller.startTool(`tool-${i}`, 'exec_command');
      controller.updateToolSummary(`tool-${i}`, `command-${i}`);
      controller.endTool(`tool-${i}`, false);
    }
    controller.append('最终结论');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    await (controller as any).patchCard('streaming');

    const lastCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const cardJson = JSON.stringify(lastCard);
    const stepsPanel = (lastCard?.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        typeof element?.header?.title?.content === 'string' &&
        element.header.title.content.includes('7 steps'),
    );

    expect(stepsPanel).toBeTruthy();
    for (let i = 1; i <= 7; i++) {
      expect(cardJson).toContain(`command-${i}`);
    }

    controller.dispose();
  });

  test.each([
    {
      name: 'tool progress',
      seed: (controller: StreamingCardController) => {
        controller.startTool('tool-1', 'exec_command');
        controller.updateToolSummary('tool-1', 'sed -n 1,120p AGENTS.md');
      },
      expected: 'exec_command',
    },
    {
      name: 'system status',
      seed: (controller: StreamingCardController) => {
        controller.setSystemStatus('读取计划中');
      },
      expected: '读取计划中',
    },
    {
      name: 'hook status',
      seed: (controller: StreamingCardController) => {
        controller.setHook({
          hookName: 'pre_tool_use',
          hookEvent: 'tool_call',
        });
      },
      expected: 'pre_tool_use',
    },
    {
      name: 'todo progress',
      seed: (controller: StreamingCardController) => {
        controller.setTodos([
          { id: '1', content: '核对飞书卡片链路', status: 'in_progress' },
        ]);
      },
      expected: '核对飞书卡片链路',
    },
  ])(
    'creates an initial Feishu card from idle for $name before answer text arrives',
    async ({ seed, expected }) => {
      const { client, createdCards } = createStreamingModeClient();
      const controller = new StreamingCardController({
        client,
        chatId: 'chat-test',
      });

      seed(controller);

      await vi.waitFor(() => {
        expect(createdCards).toHaveLength(1);
        expect((controller as any).state).toBe('streaming');
      });

      expect(JSON.stringify(createdCards[0])).toContain(expected);

      controller.dispose();
    },
  );

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
      '第一段说明当前方案。\n\n第二段说明原因。\n\n第三段确认下一步。',
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

  test('prefers injected runtime model choices when building a model selection card', () => {
    const card = buildRuntimeSelectionCard({
      selection: 'model',
      runtimeIdentity: {
        agentType: 'codex',
        model: 'gpt-5.5',
        reasoningEffort: 'high',
        supportsReasoningEffort: true,
      },
      modelChoices: [
        { value: 'gpt-5.4', label: 'GPT-5.4' },
        { value: 'gpt-5.5', label: 'GPT-5.5' },
        { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark' },
      ],
    }) as any;

    const select = card.body.elements?.[1]?.columns?.[0]?.elements?.[0];
    expect(select).toMatchObject({
      tag: 'select_static',
      placeholder: { content: '模型: gpt-5.5' },
      initial_option: 'gpt-5.5',
      value: { action: 'set_runtime_model' },
    });
    expect(select.options).toEqual([
      {
        text: { tag: 'plain_text', content: 'GPT-5.4' },
        value: 'gpt-5.4',
      },
      {
        text: { tag: 'plain_text', content: 'GPT-5.5' },
        value: 'gpt-5.5',
      },
      {
        text: { tag: 'plain_text', content: 'GPT-5.3-Codex-Spark' },
        value: 'gpt-5.3-codex-spark',
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

  test('builds a runtime speed selection card for Codex', () => {
    const card = buildRuntimeSelectionCard({
      selection: 'speed',
      runtimeIdentity: {
        agentType: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        speedTier: 'fast',
        supportsReasoningEffort: true,
      },
    }) as any;

    const select = card.body.elements?.[1]?.columns?.[0]?.elements?.[0];
    expect(card.config.summary.content).toBe('选择速度');
    expect(select).toMatchObject({
      tag: 'select_static',
      placeholder: { content: '速度: fast' },
      initial_option: 'fast',
      value: { action: 'set_runtime_speed' },
    });
    expect(select.options).toEqual([
      {
        text: { tag: 'plain_text', content: 'standard (1x)' },
        value: 'standard',
      },
      {
        text: { tag: 'plain_text', content: 'fast (2x)' },
        value: 'fast',
      },
    ]);
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

  test('initial streaming card keeps only the streaming status note when no answer text exists yet', async () => {
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
    expect(
      elements.some(
        (el: any) => el?.tag === 'markdown' && el?.content?.trim() === '...',
      ),
    ).toBe(false);

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
    expect(note).toMatch(
      /\d+\.\ds \| Codex \| GPT-5\.4 \| high \| standard \(1x\)/,
    );

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
    expect(finalCardJson).toMatch(
      /\d+\.\ds \| Codex \| GPT-5\.4 \| high \| standard \(1x\)/,
    );
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

  test('aborts agent-scoped streaming sessions when the base Feishu chat is superseded', async () => {
    const mainAbort = vi.fn().mockResolvedValue(undefined);
    const agentAbort = vi.fn().mockResolvedValue(undefined);
    const otherAbort = vi.fn().mockResolvedValue(undefined);

    registerStreamingSession('feishu:room', {
      isActive: () => true,
      abort: mainAbort,
      getAllMessageIds: () => [],
    } as any);
    registerStreamingSession('feishu:room#agent:agent-1', {
      isActive: () => true,
      abort: agentAbort,
      getAllMessageIds: () => [],
    } as any);
    registerStreamingSession('feishu:other#agent:agent-2', {
      isActive: () => true,
      abort: otherAbort,
      getAllMessageIds: () => [],
    } as any);

    const abortForChat = (feishuStreamingCard as any)
      .abortStreamingSessionsForChatJid;
    expect(typeof abortForChat).toBe('function');

    if (typeof abortForChat === 'function') {
      abortForChat('feishu:room', '新的回复已开始');
    }

    expect(mainAbort).toHaveBeenCalledWith('新的回复已开始');
    expect(agentAbort).toHaveBeenCalledWith('新的回复已开始');
    expect(otherAbort).not.toHaveBeenCalled();

    unregisterStreamingSession('feishu:room');
    unregisterStreamingSession('feishu:room#agent:agent-1');
    unregisterStreamingSession('feishu:other#agent:agent-2');
  });

  test('invokes terminal cleanup hooks when the streaming card completes', async () => {
    const onTerminal = vi.fn();
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
      onTerminal,
    } as any);

    (controller as any).state = 'streaming';
    (controller as any).backendMode = 'legacy';
    (controller as any).messageId = null;

    await controller.complete('final answer');

    expect(onTerminal).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  test('completes with the current accumulated text when no replacement final text exists', async () => {
    const onTerminal = vi.fn();
    const controller = new StreamingCardController({
      client: {} as any,
      chatId: 'chat-test',
      onTerminal,
    } as any);

    const patchCard = vi.fn(async () => {});
    (controller as any).state = 'streaming';
    (controller as any).backendMode = 'legacy';
    (controller as any).messageId = 'msg-1';
    (controller as any).accumulatedText = 'partial answer';
    (controller as any).patchCard = patchCard;

    await (controller as any).completeWithCurrentText();

    expect((controller as any).state).toBe('completed');
    expect((controller as any).accumulatedText).toBe('partial answer');
    expect(patchCard).toHaveBeenCalledWith('completed');
    expect(onTerminal).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  test('retains collapsed thinking and tool-step panels when completing with current text', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.appendThinking('分析输入');
    controller.appendCommentary('先收集上下文');
    controller.startTool('tool-1', 'exec_command');
    controller.updateToolSummary('tool-1', 'git status --short');
    controller.append('已处理');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    await (controller as any).completeWithCurrentText();

    await vi.waitFor(() => {
      expect(updatedCards.length).toBeGreaterThan(0);
    });

    const finalCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const finalCardJson = JSON.stringify(finalCard);
    const thinkingPanel = (finalCard?.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💭 Thinking',
    );
    const stepsPanel = (finalCard?.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '1 steps',
    );
    const commentaryPanel = (finalCard?.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💬 Commentary',
    );

    expect(finalCardJson).toContain('已处理');
    expect(finalCardJson).toContain('git status --short');
    expect(finalCardJson).toContain('exec_command');
    expect(thinkingPanel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: false,
      elements: [
        {
          tag: 'markdown',
          content: '分析输入',
          text_size: 'notation',
        },
      ],
    });
    expect(stepsPanel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: false,
    });
    expect(commentaryPanel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: false,
      elements: [
        {
          tag: 'markdown',
          content: '先收集上下文',
          text_size: 'notation',
        },
      ],
    });

    controller.dispose();
  });

  test('keeps commentary in a dedicated terminal panel when completion provides explicit final text', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.appendCommentary('先收集上下文');
    controller.append('流式正文');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    await controller.complete('最终结论');

    await vi.waitFor(() => {
      expect(updatedCards.length).toBeGreaterThan(0);
    });

    const finalCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const commentaryPanel = (finalCard?.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💬 Commentary',
    );
    const mainMarkdown = (finalCard?.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'markdown' && element?.text_size === 'normal_text',
    );

    expect(mainMarkdown?.content).toBe('最终结论');
    expect(commentaryPanel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: false,
      elements: [
        {
          tag: 'markdown',
          content: '先收集上下文',
          text_size: 'notation',
        },
      ],
    });

    controller.dispose();
  });

  test('strips commentary-prefixed terminal text while preserving the commentary panel', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.append('流式正文');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    const presentationText = {
      answerText: '',
      commentaryText: '先收集上下文',
    };
    const visibleReplyParts = resolveVisibleReplyParts(
      '先收集上下文\n\n## 最终结论\n\n正文',
      presentationText,
      { agentType: 'codex' },
    );
    controller.appendCommentary(visibleReplyParts.commentaryText);
    await controller.complete(visibleReplyParts.visibleText);

    await vi.waitFor(() => {
      expect(updatedCards.length).toBeGreaterThan(0);
    });

    const finalCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const commentaryPanel = (finalCard?.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💬 Commentary',
    );
    const mainMarkdown = (finalCard?.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'markdown' && element?.text_size === 'normal_text',
    );

    expect(finalCard?.config?.summary?.content).toBe('最终结论');
    expect(mainMarkdown?.content).toBe('正文');
    expect(JSON.stringify(mainMarkdown)).not.toContain('先收集上下文');
    expect(commentaryPanel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: false,
      elements: [
        {
          tag: 'markdown',
          content: '先收集上下文',
          text_size: 'notation',
        },
      ],
    });

    controller.dispose();
  });

  test('renders a terminal completion fallback instead of literal ellipsis when no answer text exists', async () => {
    const { client, createdCards, updatedCards } = createStreamingModeClient();
    const controller = new StreamingCardController({
      client,
      chatId: 'chat-test',
    });

    controller.appendCommentary('先检查 restart intent');
    controller.startTool('tool-1', 'exec_command');
    controller.updateToolSummary('tool-1', 'cli-claw restart');

    await vi.waitFor(() => {
      expect(createdCards).toHaveLength(1);
      expect((controller as any).state).toBe('streaming');
    });

    await (controller as any).completeWithCurrentText();

    await vi.waitFor(() => {
      expect(updatedCards.length).toBeGreaterThan(0);
    });

    const finalCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const markdownContents = (finalCard?.body?.elements ?? [])
      .filter((element: any) => element?.tag === 'markdown')
      .map((element: any) => element.content);
    const commentaryPanel = (finalCard?.body?.elements ?? []).find(
      (element: any) =>
        element?.tag === 'collapsible_panel' &&
        element?.header?.title?.content === '💬 Commentary',
    );

    expect(markdownContents).toContain('*已完成*');
    expect(markdownContents).not.toContain('...');
    expect(JSON.stringify(finalCard)).toContain('cli-claw restart');
    expect(commentaryPanel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: false,
      elements: [
        {
          tag: 'markdown',
          content: '先检查 restart intent',
          text_size: 'notation',
        },
      ],
    });

    controller.dispose();
  });
});
