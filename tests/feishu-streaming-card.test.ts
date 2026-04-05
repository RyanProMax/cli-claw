import { describe, expect, test } from 'vitest';

import { StreamingCardController } from '../src/feishu-streaming-card.ts';
import { formatToolStepLine } from '../src/tool-step-display.ts';

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
      '5.2s | GPT-5.4 | xhigh | 12.3K tokens | $0.0421',
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
});
