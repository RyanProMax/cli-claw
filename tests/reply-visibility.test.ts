import { describe, expect, test } from 'vitest';

import {
  resolveVisibleReplyParts,
  resolveVisibleReplyText,
} from '../src/reply-visibility.ts';

describe('resolveVisibleReplyText', () => {
  test('strips leading Codex commentary when it leaks into the final reply body', () => {
    const rawText = [
      '我会先核对招股书和上市状态。',
      '',
      '## 01879 打新预研',
      '',
      '这是最终报告。',
    ].join('\n');

    expect(
      resolveVisibleReplyText(
        rawText,
        {
          commentaryText: '我会先核对招股书和上市状态。',
        },
        { agentType: 'codex' },
      ),
    ).toBe(['## 01879 打新预研', '', '这是最终报告。'].join('\n'));
  });

  test('prefers explicit answer text for Codex when available', () => {
    expect(
      resolveVisibleReplyText(
        'commentary + final',
        {
          answerText: '最终答案',
          commentaryText: 'commentary',
        },
        { agentType: 'codex' },
      ),
    ).toBe('最终答案');
  });

  test('uses current raw final when stale presentation answer is much larger and unrelated', () => {
    const staleAnswer = [
      '我会按仓库协议先补读工程说明和当前计划，再定位 `stock-analysis-skill`。',
      '这里是旧任务的历史过程。'.repeat(400),
    ].join('\n');
    const rawText = [
      '是我触发的安全重启。',
      '',
      '状态：重启已成功，status = `passed`。',
    ].join('\n');

    expect(
      resolveVisibleReplyText(
        rawText,
        {
          answerText: staleAnswer,
          commentaryText: '',
        },
        { agentType: 'codex' },
      ),
    ).toBe(rawText);
  });

  test('reports dropped presentation answer for incident logging', () => {
    const parts = resolveVisibleReplyParts(
      '是我触发的安全重启。',
      {
        answerText: '旧任务输出。'.repeat(1000),
        commentaryText: '旧过程说明',
      },
      { agentType: 'codex' },
    );

    expect(parts).toEqual({
      visibleText: '是我触发的安全重启。',
      commentaryText: '',
      droppedPresentationAnswer: true,
    });
  });

  test('keeps the original text when the final payload is commentary-only', () => {
    expect(
      resolveVisibleReplyText(
        '我会先检查飞书渲染链路。',
        {
          commentaryText: '我会先检查飞书渲染链路。',
        },
        { agentType: 'codex' },
      ),
    ).toBe('我会先检查飞书渲染链路。');
  });

  test('does not rewrite non-Codex replies', () => {
    expect(
      resolveVisibleReplyText(
        '普通回复',
        {
          commentaryText: 'commentary',
        },
        { agentType: 'claude' },
      ),
    ).toBe('普通回复');
  });

  test('strips commentary-prefixed final text when runtime identity is unavailable but commentary state exists', () => {
    expect(
      resolveVisibleReplyText(
        '我会先核对招股书。\n\n## 港股 IPO 池\n\n这是最终报告。',
        {
          commentaryText: '我会先核对招股书。',
        },
        null,
      ),
    ).toBe(['## 港股 IPO 池', '', '这是最终报告。'].join('\n'));
  });

  test('infers a short Codex process prefix before a markdown report heading as commentary', () => {
    const rawText =
      '我按 `stock-analysis-skill` 先联网核验当前 IPO 池。# 港股 IPO 池跟踪\n\n正文';

    expect(
      resolveVisibleReplyParts(rawText, {}, { agentType: 'codex' }),
    ).toEqual({
      visibleText: '# 港股 IPO 池跟踪\n\n正文',
      commentaryText: '我按 `stock-analysis-skill` 先联网核验当前 IPO 池。',
    });
  });

  test('removes raw prompt wrapper blocks before sending visible text', () => {
    const rawText = [
      '<reply-policy>',
      '最小必要回复策略',
      '</reply-policy>',
      '',
      '<messages>',
      '<message sender="user">旧消息</message>',
      '</messages>',
      '',
      '**结论**',
      '已经按当前请求处理。',
    ].join('\n');

    expect(resolveVisibleReplyText(rawText, {}, { agentType: 'codex' })).toBe(
      ['**结论**', '已经按当前请求处理。'].join('\n'),
    );
  });

  test('suppresses leaked internal context when no clean visible answer remains', () => {
    expect(
      resolveVisibleReplyText(
        [
          'Important current conclusion:',
          '- Runtime session is reused.',
          'Relevant code just inspected:',
          '- src/index.ts',
        ].join('\n'),
        {},
        { agentType: 'codex' },
      ),
    ).toBe('内部上下文已拦截。请重新发送当前请求。');
  });

  test('keeps clean answer after leaked restart recovery summary', () => {
    expect(
      resolveVisibleReplyText(
        [
          'Need continue from interrupted state. No code changes yet.',
          '- Previous turn inspected queue state.',
          '',
          '**结论**',
          '盯盘任务不会主动吞掉用户消息。',
        ].join('\n'),
        {},
        { agentType: 'codex' },
      ),
    ).toBe(['**结论**', '盯盘任务不会主动吞掉用户消息。'].join('\n'));
  });
});
