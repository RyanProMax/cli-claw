import { describe, expect, test } from 'vitest';

import { StreamingCardController } from '../src/feishu-streaming-card.ts';

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
});
