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
      commentaryText:
        '我按 `stock-analysis-skill` 先联网核验当前 IPO 池。',
    });
  });
});
