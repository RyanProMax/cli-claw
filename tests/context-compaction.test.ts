import { describe, expect, test } from 'vitest';

import {
  buildRecoveryContext,
  compactMessagesForAgent,
  selectRecentTurnMessages,
} from '../src/context-compaction.ts';

function msg(id: string, content: string) {
  return {
    id,
    sender_name: `user-${id}`,
    content,
    timestamp: `2026-04-12T00:00:0${id}.000Z`,
    is_from_me: false,
  };
}

describe('context compaction', () => {
  test('builds bounded recovery context from the latest messages in chronological order', () => {
    const messages = [
      msg('1', 'old message should be omitted'),
      msg('2', 'second old message should be omitted'),
      msg('3', 'A'.repeat(80)),
      msg('4', 'B'.repeat(80)),
      msg('5', 'C'.repeat(80)),
    ];

    const context = buildRecoveryContext(messages, {
      maxMessages: 3,
      maxCharsPerMessage: 20,
    });

    expect(context).toContain('<system_context>');
    expect(context).toContain('服务刚重启，当前为新会话');
    expect(context).not.toContain('old message should be omitted');
    expect(context.indexOf('[user-3]')).toBeLessThan(
      context.indexOf('[user-4]'),
    );
    expect(context.indexOf('[user-4]')).toBeLessThan(
      context.indexOf('[user-5]'),
    );
    expect(context).toContain(`${'A'.repeat(20)}…`);
    expect(context).not.toContain('A'.repeat(40));
  });

  test('compacts pending messages by count, total characters, and per-message length', () => {
    const messages = [
      msg('1', 'a'.repeat(30)),
      msg('2', 'b'.repeat(30)),
      msg('3', 'c'.repeat(30)),
      msg('4', 'd'.repeat(30)),
      msg('5', 'e'.repeat(80)),
    ];

    const compacted = compactMessagesForAgent(messages, {
      maxMessages: 4,
      maxTotalChars: 90,
      maxCharsPerMessage: 25,
    });

    expect(compacted.map((item) => item.id)).toEqual(['3', '4', '5']);
    expect(compacted[0]?.content).toBe('c'.repeat(25) + '…');
    expect(compacted[2]?.content).toBe('e'.repeat(25) + '…');
    expect(messages[4]?.content).toBe('e'.repeat(80));
  });

  test('keeps only the newest contiguous pending turn after a long gap', () => {
    const messages = [
      {
        ...msg('1', 'yesterday first'),
        timestamp: '2026-04-11T00:00:00.000Z',
      },
      {
        ...msg('2', 'yesterday second'),
        timestamp: '2026-04-11T00:05:00.000Z',
      },
      {
        ...msg('3', 'today first'),
        timestamp: '2026-04-12T07:00:00.000Z',
      },
      {
        ...msg('4', 'today second'),
        timestamp: '2026-04-12T07:01:00.000Z',
      },
    ];

    const selected = selectRecentTurnMessages(messages, {
      maxInterMessageGapMs: 2 * 60 * 60 * 1000,
    });

    expect(selected.map((item) => item.id)).toEqual(['3', '4']);
  });

  test('keeps all pending messages when timestamps cannot prove a long gap', () => {
    const messages = [
      { ...msg('1', 'missing timestamp'), timestamp: undefined },
      {
        ...msg('2', 'latest message'),
        timestamp: '2026-04-12T07:01:00.000Z',
      },
    ];

    const selected = selectRecentTurnMessages(messages, {
      maxInterMessageGapMs: 2 * 60 * 60 * 1000,
    });

    expect(selected.map((item) => item.id)).toEqual(['1', '2']);
  });
});
