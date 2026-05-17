import { describe, expect, test } from 'vitest';

import { resolveFileRootOverride } from '../../../../src/web/routes/files.js';
import type { RegisteredGroup } from '../../../../src/domain/types.js';

describe('resolveFileRootOverride', () => {
  test('uses the workspace cwd contract for all groups', () => {
    const hostGroup = {
      customCwd: '/srv/project',
    } as RegisteredGroup;

    const launchOnlyHostGroup = {
    } as RegisteredGroup;

    const memberHostGroup = {
    } as RegisteredGroup;

    const homeHostGroup = {
      customCwd: '/srv/home',
      is_home: true,
    } as RegisteredGroup;

    const containerGroup = {
      customCwd: '/srv/project',
    } as RegisteredGroup;

    expect(resolveFileRootOverride(hostGroup)).toBe('/srv/project');
    expect(resolveFileRootOverride(launchOnlyHostGroup)).toBeUndefined();
    expect(resolveFileRootOverride(memberHostGroup, homeHostGroup)).toBe(
      '/srv/home',
    );
    expect(resolveFileRootOverride(containerGroup)).toBe('/srv/project');
  });
});
