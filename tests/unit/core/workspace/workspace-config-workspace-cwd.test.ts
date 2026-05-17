import { describe, expect, test } from 'vitest';

import { getWorkspaceRoot } from '../../../../src/web/routes/workspace-config.js';
import type { RegisteredGroup } from '../../../../src/domain/types.js';

describe('getWorkspaceRoot', () => {
  test('uses the workspace cwd contract for all groups and storage fallback', () => {
    const hostGroup = {
      folder: 'main',
      customCwd: '/srv/project',
    } as RegisteredGroup & { jid: string };

    const launchOnlyHostGroup = {
      folder: 'main',
    } as RegisteredGroup & { jid: string };

    const memberHostGroup = {
      folder: 'main',
    } as RegisteredGroup & { jid: string };

    const homeHostGroup = {
      folder: 'main',
      customCwd: '/srv/home',
      is_home: true,
    } as RegisteredGroup;

    const containerGroup = {
      folder: 'main',
      customCwd: '/srv/project',
    } as RegisteredGroup & { jid: string };

    expect(getWorkspaceRoot(hostGroup)).toBe('/srv/project');
    expect(getWorkspaceRoot(memberHostGroup, homeHostGroup)).toBe('/srv/home');
    expect(getWorkspaceRoot(launchOnlyHostGroup)).toContain('/.cli-claw/groups/main');
    expect(getWorkspaceRoot(containerGroup)).toBe('/srv/project');
  });
});
