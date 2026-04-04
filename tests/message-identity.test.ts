import { describe, expect, test } from 'vitest';

import {
  getMessageIdentityKey,
  mergeMessagesChronologically,
} from '../web/src/lib/messageIdentity.ts';
import type { Message } from '../web/src/stores/chat.ts';

function createMessage(
  overrides: Partial<Message> & Pick<Message, 'id' | 'chat_jid' | 'timestamp'>,
): Message {
  return {
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender ?? 'user-1',
    sender_name: overrides.sender_name ?? 'User',
    content: overrides.content ?? 'hello',
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
    source_jid: overrides.source_jid,
    attachments: overrides.attachments,
    token_usage: overrides.token_usage,
    runtime_identity: overrides.runtime_identity,
    turn_id: overrides.turn_id ?? null,
    session_id: overrides.session_id ?? null,
    sdk_message_uuid: overrides.sdk_message_uuid ?? null,
    source_kind: overrides.source_kind ?? null,
    finalization_reason: overrides.finalization_reason ?? null,
  };
}

describe('message identity helpers', () => {
  test('uses chat_jid plus id as the stable message key', () => {
    expect(
      getMessageIdentityKey({
        id: 'same-id',
        chat_jid: 'web:main',
      } as Message),
    ).not.toBe(
      getMessageIdentityKey({
        id: 'same-id',
        chat_jid: 'feishu:group-1',
      } as Message),
    );
  });

  test('preserves messages that share id but come from different chat_jid values', () => {
    const webMessage = createMessage({
      id: 'msg-1',
      chat_jid: 'web:main',
      timestamp: '2026-04-04T10:00:00.000Z',
      content: 'web reply',
    });
    const feishuMessage = createMessage({
      id: 'msg-1',
      chat_jid: 'feishu:group-1',
      timestamp: '2026-04-04T10:01:00.000Z',
      content: 'feishu reply',
      source_jid: 'feishu:group-1',
    });

    const merged = mergeMessagesChronologically([webMessage], [feishuMessage]);

    expect(merged).toHaveLength(2);
    expect(merged.map((message) => `${message.chat_jid}:${message.content}`)).toEqual([
      'web:main:web reply',
      'feishu:group-1:feishu reply',
    ]);
  });

  test('updates an existing row only when the same composite key changes', () => {
    const original = createMessage({
      id: 'msg-2',
      chat_jid: 'web:main',
      timestamp: '2026-04-04T10:00:00.000Z',
      content: 'draft',
      runtime_identity: { agentType: 'claude', model: 'claude-opus-4.1', supportsReasoningEffort: false },
    });
    const updated = createMessage({
      id: 'msg-2',
      chat_jid: 'web:main',
      timestamp: '2026-04-04T10:00:01.000Z',
      content: 'final',
      runtime_identity: { agentType: 'claude', model: 'claude-opus-4.1', supportsReasoningEffort: false },
    });

    const merged = mergeMessagesChronologically([original], [updated]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe('final');
    expect(merged[0]?.timestamp).toBe('2026-04-04T10:00:01.000Z');
  });
});
