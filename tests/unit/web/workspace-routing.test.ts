import { describe, expect, test } from 'vitest';

import {
  resolveWorkspaceRouteParam,
  toWorkspaceChatPath,
} from '../../../web/src/utils/workspace-routing.ts';
import type { GroupInfo } from '../../../web/src/types.ts';

function group(folder: string, overrides: Partial<GroupInfo> = {}): GroupInfo {
  return {
    name: folder,
    folder,
    added_at: '2026-05-23T00:00:00.000Z',
    kind: 'web',
    editable: true,
    deletable: true,
    lastMessage: null,
    lastMessageTime: '2026-05-23T00:00:00.000Z',
    model: null,
    reasoning_effort: null,
    speed_tier: null,
    ...overrides,
  };
}

describe('workspace routing helpers', () => {
  const groups: Record<string, GroupInfo> = {
    'web:main': group('main', { kind: 'home', is_home: true, is_my_home: true }),
    'web:hkipo': group('hkipo'),
    'web:hkipo-ack': group('hkipo-ack'),
    'web:hkipo-ack-ecc32ec9-9fe8-46f8-b83d-3ca5d0138de6': group(
      'hkipo-ack',
    ),
  };

  test('builds chat paths from workspace jid instead of folder', () => {
    expect(toWorkspaceChatPath('web:hkipo-ack')).toBe('/chat/web%3Ahkipo-ack');
  });

  test('resolves a jid route to the exact workspace even when folder is duplicated', () => {
    expect(resolveWorkspaceRouteParam('web:hkipo-ack', groups)).toBe(
      'web:hkipo-ack',
    );
    expect(
      resolveWorkspaceRouteParam(
        'web:hkipo-ack-ecc32ec9-9fe8-46f8-b83d-3ca5d0138de6',
        groups,
      ),
    ).toBe('web:hkipo-ack-ecc32ec9-9fe8-46f8-b83d-3ca5d0138de6');
  });

  test('keeps unique legacy folder links but refuses ambiguous folder links', () => {
    expect(resolveWorkspaceRouteParam('hkipo', groups)).toBe('web:hkipo');
    expect(resolveWorkspaceRouteParam('hkipo-ack', groups)).toBeNull();
  });
});
