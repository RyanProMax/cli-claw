import { describe, expect, test } from 'vitest';

import {
  normalizeStreamingMarkdown,
  optimizeMarkdownStyle,
} from '../src/feishu-markdown-style.ts';
import { appendStreamTextDelta } from '../shared/stream-event.ts';

describe('normalizeStreamingMarkdown', () => {
  test('adds spacing around headings, lists, and horizontal rules for Feishu streaming', () => {
    const normalized = normalizeStreamingMarkdown(
      'Intro\n# Result\n- first\n- second\n---\nTail',
    );

    expect(normalized).toBe(
      'Intro\n\n# Result\n\n- first\n- second\n\n---\n\nTail',
    );
  });

  test('preserves fenced code blocks while normalizing surrounding text', () => {
    const input = [
      '# Result',
      '```ts',
      'const x = 1;',
      '- not a list',
      '```',
    ].join('\n');

    const normalized = normalizeStreamingMarkdown(input);

    expect(normalized).toContain('```ts\nconst x = 1;\n- not a list\n```');
    expect(normalized).toContain('# Result\n\n```ts');
  });

  test('preserves commentary message boundaries before Feishu markdown normalization', () => {
    const withBoundary = appendStreamTextDelta('', {
      eventType: 'text_delta',
      text: 'First update',
      turnId: 'turn-1',
      messageUuid: 'msg-1',
    });
    const combined = appendStreamTextDelta(
      withBoundary.text,
      {
        eventType: 'text_delta',
        text: '# Second update',
        turnId: 'turn-1',
        messageUuid: 'msg-2',
      },
      withBoundary.lastMessageUuid,
    );

    expect(normalizeStreamingMarkdown(combined.text)).toBe(
      'First update\n\n# Second update',
    );
  });

  test('keeps plain prose paragraphs separated without oversized blank gaps in Feishu card markdown', () => {
    expect(
      optimizeMarkdownStyle(
        '第一段说明服务状态。\n\n第二段说明根因。\n\n第三段说明下一步。',
        2,
      ),
    ).toBe('第一段说明服务状态。\n\n第二段说明根因。\n\n第三段说明下一步。');
  });

  test('does not inject Schema 2 hard breaks into legacy markdown fallback', () => {
    expect(
      optimizeMarkdownStyle(
        ['**📌 优先级**', '**🟢 1｜01236 樂動機器人**', '📍 阶段：招股中'].join(
          '\n',
        ),
        1,
      ),
    ).toBe('**📌 优先级**\n**🟢 1｜01236 樂動機器人**\n📍 阶段：招股中');
  });

  test('does not inject report-specific hard breaks into Schema 2 markdown', () => {
    expect(
      optimizeMarkdownStyle(
        ['**📌 优先级**', '**🟢 1｜01236 樂動機器人**', '📍 阶段：招股中'].join(
          '\n',
        ),
        2,
      ),
    ).toBe('**📌 优先级**\n**🟢 1｜01236 樂動機器人**\n📍 阶段：招股中');
  });
});
