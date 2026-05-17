import { describe, expect, test } from 'vitest';

import { resolveFileRootOverride } from '../../../../src/web/routes/files.js';
import type { RegisteredGroup } from '../../../../src/domain/types.js';

describe('resolveFileRootOverride', () => {
  test('uses the workspace cwd contract for all groups', () => {
    const workspaceWithCustomCwd = {
      customCwd: '/srv/project',
    } as RegisteredGroup;

    const workspaceWithoutCustomCwd = {
    } as RegisteredGroup;

    const memberWorkspace = {
    } as RegisteredGroup;

    const homeWorkspace = {
      customCwd: '/srv/home',
      is_home: true,
    } as RegisteredGroup;

    const secondWorkspaceWithCustomCwd = {
      customCwd: '/srv/project',
    } as RegisteredGroup;

    expect(resolveFileRootOverride(workspaceWithCustomCwd)).toBe('/srv/project');
    expect(resolveFileRootOverride(workspaceWithoutCustomCwd)).toBeUndefined();
    expect(resolveFileRootOverride(memberWorkspace, homeWorkspace)).toBe(
      '/srv/home',
    );
    expect(resolveFileRootOverride(secondWorkspaceWithCustomCwd)).toBe('/srv/project');
  });
});
