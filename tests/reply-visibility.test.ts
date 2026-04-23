import { describe, expect, test } from 'vitest';

import { resolveVisibleReplyText } from '../src/reply-visibility.ts';

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
});
