import { describe, expect, test } from 'vitest';

import { resolveFileRootOverride } from '../src/routes/files.js';
import type { RegisteredGroup } from '../src/types.js';

describe('resolveFileRootOverride', () => {
  test('uses the host workspace cwd contract for host groups', () => {
    const hostGroup = {
      executionMode: 'host',
      customCwd: '/srv/project',
    } as RegisteredGroup;

    const launchOnlyHostGroup = {
      executionMode: 'host',
    } as RegisteredGroup;

    const memberHostGroup = {
      executionMode: 'host',
    } as RegisteredGroup;

    const homeHostGroup = {
      executionMode: 'host',
      customCwd: '/srv/home',
      is_home: true,
    } as RegisteredGroup;

    const containerGroup = {
      executionMode: 'container',
      customCwd: '/srv/project',
    } as RegisteredGroup;

    expect(resolveFileRootOverride(hostGroup)).toBe('/srv/project');
    expect(resolveFileRootOverride(launchOnlyHostGroup)).toBeUndefined();
    expect(resolveFileRootOverride(memberHostGroup, homeHostGroup)).toBe(
      '/srv/home',
    );
    expect(resolveFileRootOverride(containerGroup)).toBeUndefined();
  });
});
