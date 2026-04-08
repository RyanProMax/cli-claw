import { describe, expect, test, vi } from 'vitest';

import {
  buildStaticReplyCard,
  StreamingCardController,
} from '../src/feishu-streaming-card.ts';
import { formatToolStepLine } from '../src/tool-step-display.ts';

function createStreamingModeClient() {
  const createdCards: Array<Record<string, any>> = [];
  const updatedCards: Array<Record<string, any>> = [];

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

  return { client, createdCards, updatedCards };
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

  test('formats card tool steps as plain text lines', () => {
    expect(formatToolStepLine('exec_command', 'ls -la')).toBe(
      'exec_command · ls -la',
    );
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

  test('renders streaming controls in a single footer row', async () => {
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
      columns: [
        { tag: 'column', elements: [{ tag: 'button' }] },
        { tag: 'column', elements: [{ tag: 'select_static' }] },
        { tag: 'column', elements: [{ tag: 'select_static' }] },
      ],
    });
    // Every column entry must carry tag: 'column' so Feishu schema 2.0 accepts the layout
    for (const column of controlRow.columns) {
      expect(column.tag).toBe('column');
    }
    expect(elements.filter((el: any) => el?.tag === 'button')).toHaveLength(0);
    expect(elements.filter((el: any) => el?.tag === 'select_static')).toHaveLength(0);

    controller.dispose();
  });

  test('initial streaming card exposes a STATUS_NOTE element so the live footer can be patched', async () => {
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
      (el: any) => el?.element_id === 'status_note',
    );
    expect(statusNote).toMatchObject({
      tag: 'markdown',
      element_id: 'status_note',
      text_size: 'notation',
    });

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
});
