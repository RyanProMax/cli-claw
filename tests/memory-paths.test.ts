import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  fromMemoryApiPath,
  toMemoryApiPath,
} from '../src/routes/memory.js';

describe('memory api paths', () => {
  const root = path.join('/tmp', '.cli-claw');

  test('converts absolute runtime paths to api-relative paths', () => {
    expect(
      toMemoryApiPath(
        path.join(root, 'groups', 'user-global', 'u1', 'AGENTS.md'),
        root,
      ),
    ).toBe('groups/user-global/u1/AGENTS.md');
  });

  test('resolves api-relative paths under the runtime root', () => {
    expect(fromMemoryApiPath('memory/ws/2026-04-04.md', root)).toBe(
      path.join(root, 'memory', 'ws', '2026-04-04.md'),
    );
  });
});
