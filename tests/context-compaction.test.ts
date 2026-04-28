import { describe, expect, test } from 'vitest';

import { compactMessagesForAgent } from '../src/context-compaction.ts';

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
});
