import { describe, expect, test } from 'vitest';

import { getWorkspaceRoot } from '../src/routes/workspace-config.js';
import type { RegisteredGroup } from '../src/types.js';

describe('getWorkspaceRoot', () => {
  test('uses the host workspace cwd contract for host groups', () => {
    const hostGroup = {
      folder: 'main',
      executionMode: 'host',
      customCwd: '/srv/project',
    } as RegisteredGroup & { jid: string };

    const launchOnlyHostGroup = {
      folder: 'main',
      executionMode: 'host',
    } as RegisteredGroup & { jid: string };

    const memberHostGroup = {
      folder: 'main',
      executionMode: 'host',
    } as RegisteredGroup & { jid: string };

    const homeHostGroup = {
      folder: 'main',
      executionMode: 'host',
      customCwd: '/srv/home',
      is_home: true,
    } as RegisteredGroup;

    const containerGroup = {
      folder: 'main',
      executionMode: 'container',
      customCwd: '/srv/project',
    } as RegisteredGroup & { jid: string };

    expect(getWorkspaceRoot(hostGroup)).toBe('/srv/project');
    expect(getWorkspaceRoot(memberHostGroup, homeHostGroup)).toBe('/srv/home');
    expect(() => getWorkspaceRoot(launchOnlyHostGroup)).toThrow(
      'Host workspace is missing custom_cwd',
    );
    expect(getWorkspaceRoot(containerGroup)).toContain('/.cli-claw/groups/main');
  });
});
