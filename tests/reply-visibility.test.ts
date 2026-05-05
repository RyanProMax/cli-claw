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

  test('uses current raw final for Codex even when explicit answer text is available', () => {
    expect(
      resolveVisibleReplyText(
        '当前 raw final',
        {
          answerText: '最终答案',
          commentaryText: 'commentary',
        },
        { agentType: 'codex' },
      ),
    ).toBe('当前 raw final');
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

  test('reports ignored presentation answer for incident logging', () => {
    const parts = resolveVisibleReplyParts(
      '是我触发的安全重启。',
      {
        answerText: '正常 presentation answer',
        commentaryText: '旧过程说明',
      },
      { agentType: 'codex' },
    );

    expect(parts).toEqual({
      visibleText: '是我触发的安全重启。',
      commentaryText: '旧过程说明',
      droppedPresentationAnswer: true,
    });
  });

  test('drops stale presentation even when it contains the current answer near the end', () => {
    const rawText = [
      '我先查实际链路，不先猜。',
      '',
      '不符合流式输出预期，当前 Codex 飞书卡片被禁用。',
    ].join('\n');
    const staleAnswer = [
      '我会按仓库协议先补读工程说明和当前计划，再定位 `stock-analysis-skill`。',
      '旧 hkipo 过程。'.repeat(1000),
      rawText,
    ].join('\n');

    expect(
      resolveVisibleReplyParts(
        rawText,
        { answerText: staleAnswer },
        { agentType: 'codex' },
      ),
    ).toEqual({
      visibleText: rawText,
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

  test('uses current raw final for Claude and never exposes stale answer text', () => {
    const rawText = '当前 Claude final';
    const staleAnswerText = '上一轮 stale answerText';

    const parts = resolveVisibleReplyParts(
      rawText,
      {
        answerText: staleAnswerText,
        commentaryText: 'Claude commentary',
      },
      { agentType: 'claude' },
    );

    expect(parts.visibleText).toBe(rawText);
    expect(parts.visibleText).not.toContain(staleAnswerText);
    expect(parts.commentaryText).toBe('Claude commentary');
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

  test('infers Codex process logs before a bold research title as commentary', () => {
    const rawText = [
      '我会按 stock-analysis-skill 的研报协议执行。',
      '本地协议文件已读取。',
      '标准分析入口已启动并返回关键降级信号。',
      '**/research｜HK.00100｜hk｜2026-05-04**',
      '',
      '**结论摘要**',
      '- MiniMax 是港股标的。',
    ].join('\n');

    expect(
      resolveVisibleReplyParts(rawText, {}, { agentType: 'codex' }),
    ).toEqual({
      visibleText: [
        '**/research｜HK.00100｜hk｜2026-05-04**',
        '',
        '**结论摘要**',
        '- MiniMax 是港股标的。',
      ].join('\n'),
      commentaryText: [
        '我会按 stock-analysis-skill 的研报协议执行。',
        '本地协议文件已读取。',
        '标准分析入口已启动并返回关键降级信号。',
      ].join('\n'),
    });
  });

  test('infers Codex process logs before a bold hkipo title as commentary', () => {
    const rawText = [
      '我会先按技能要求读取港股 IPO 研究规则。',
      '已读取 /hkipo 评分与输出约束。',
      'Futu 当前池只有 3 只仍可认购。',
      '**港股 IPO 池｜2026-05-05**',
      '----',
      '**💡 关键结论**',
      '- 07666 池内最高。',
    ].join('\n');

    expect(
      resolveVisibleReplyParts(rawText, {}, { agentType: 'codex' }),
    ).toEqual({
      visibleText: [
        '**港股 IPO 池｜2026-05-05**',
        '----',
        '**💡 关键结论**',
        '- 07666 池内最高。',
      ].join('\n'),
      commentaryText: [
        '我会先按技能要求读取港股 IPO 研究规则。',
        '已读取 /hkipo 评分与输出约束。',
        'Futu 当前池只有 3 只仍可认购。',
      ].join('\n'),
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
