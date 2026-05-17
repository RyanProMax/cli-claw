import { describe, expect, test } from 'vitest';

import { getWorkspaceRoot } from '../../../../src/web/routes/workspace-config.js';
import type { RegisteredGroup } from '../../../../src/domain/types.js';

describe('getWorkspaceRoot', () => {
  test('uses the workspace cwd contract for all groups and storage fallback', () => {
    const workspaceWithCustomCwd = {
      folder: 'main',
      customCwd: '/srv/project',
    } as RegisteredGroup & { jid: string };

    const workspaceWithoutCustomCwd = {
      folder: 'main',
    } as RegisteredGroup & { jid: string };

    const memberWorkspace = {
      folder: 'main',
    } as RegisteredGroup & { jid: string };

    const homeWorkspace = {
      folder: 'main',
      customCwd: '/srv/home',
      is_home: true,
    } as RegisteredGroup;

    const secondWorkspaceWithCustomCwd = {
      folder: 'main',
      customCwd: '/srv/project',
    } as RegisteredGroup & { jid: string };

    expect(getWorkspaceRoot(workspaceWithCustomCwd)).toBe('/srv/project');
    expect(getWorkspaceRoot(memberWorkspace, homeWorkspace)).toBe('/srv/home');
    expect(getWorkspaceRoot(workspaceWithoutCustomCwd)).toContain('/.cli-claw/groups/main');
    expect(getWorkspaceRoot(secondWorkspaceWithCustomCwd)).toBe('/srv/project');
  });
});
