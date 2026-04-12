import { describe, expect, test } from 'vitest';

import { normalizeStreamingMarkdown } from '../src/feishu-markdown-style.ts';

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
    const input = ['# Result', '```ts', 'const x = 1;', '- not a list', '```'].join(
      '\n',
    );

    const normalized = normalizeStreamingMarkdown(input);

    expect(normalized).toContain('```ts\nconst x = 1;\n- not a list\n```');
    expect(normalized).toContain('# Result\n\n```ts');
  });
});
