import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  materializeHostWorkspaceDefaultCwd,
  resolveEffectiveHostWorkspaceCwd,
  validateHostWorkspaceCwd,
} from '../src/host-workspace-cwd.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-host-cwd-'));
  tempDirs.push(dir);
  return dir;
}

describe('validateHostWorkspaceCwd', () => {
  test('accepts an absolute cwd under an allowed root and normalizes it', () => {
    const root = makeTempWorkspace();
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(workspace);

    const result = validateHostWorkspaceCwd(workspace, {
      allowlist: {
        allowedRoots: [{ path: root, allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      },
      fieldLabel: 'custom_cwd',
    });

    expect(result).toEqual({ cwd: fs.realpathSync(workspace) });
  });

  test('rejects a relative cwd', () => {
    const result = validateHostWorkspaceCwd('workspace', {
      allowlist: null,
      fieldLabel: 'launch cwd',
    });

    expect(result).toEqual({
      error: 'launch cwd must be an absolute path',
    });
  });

  test('rejects an absolute cwd outside the allowlist', () => {
    const root = makeTempWorkspace();
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(workspace);
    const otherRoot = makeTempWorkspace();

    const result = validateHostWorkspaceCwd(workspace, {
      allowlist: {
        allowedRoots: [{ path: otherRoot, allowReadWrite: true }],
        blockedPatterns: [],
        nonMainReadOnly: false,
      },
      fieldLabel: 'launch cwd',
    });

    expect(result).toEqual({
      error:
        'launch cwd must be under an allowed root. Allowed roots: ' +
        `${otherRoot}. Check config/mount-allowlist.json`,
    });
  });
});

describe('materializeHostWorkspaceDefaultCwd', () => {
  test('fills in missing host customCwd from the launch cwd', () => {
    const root = makeTempWorkspace();
    const launchCwd = path.join(root, 'launch');
    fs.mkdirSync(launchCwd);

    const result = materializeHostWorkspaceDefaultCwd(
      {
        name: 'Main',
        folder: 'main',
        added_at: '2026-04-05T10:00:00.000Z',
        agentType: 'claude',
        executionMode: 'host',
        created_by: 'admin-1',
        is_home: true,
      },
      {
        launchCwd,
        allowlist: {
          allowedRoots: [{ path: root, allowReadWrite: true }],
          blockedPatterns: [],
          nonMainReadOnly: false,
        },
      },
    );

    expect(result).toEqual({
      group: expect.objectContaining({
        customCwd: fs.realpathSync(launchCwd),
      }),
      materialized: true,
    });
  });

  test('keeps an existing host customCwd unchanged', () => {
    const root = makeTempWorkspace();
    const launchCwd = path.join(root, 'launch');
    fs.mkdirSync(launchCwd);
    const projectDir = path.join(root, 'project');
    fs.mkdirSync(projectDir);

    const result = materializeHostWorkspaceDefaultCwd(
      {
        name: 'Main',
        folder: 'main',
        added_at: '2026-04-05T10:00:00.000Z',
        agentType: 'claude',
        executionMode: 'host',
        customCwd: projectDir,
        created_by: 'admin-1',
        is_home: true,
      },
      {
        launchCwd,
        allowlist: null,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        group: expect.objectContaining({
          customCwd: fs.realpathSync(projectDir),
        }),
      }),
    );
  });
});

describe('resolveEffectiveHostWorkspaceCwd', () => {
  test('keeps the existing home-sibling inheritance behavior', () => {
    expect(
      resolveEffectiveHostWorkspaceCwd(
        {
          name: 'Ops',
          folder: 'main',
          added_at: '2026-04-05T10:00:00.000Z',
          executionMode: 'host',
          customCwd: '/srv/main',
          created_by: 'member-1',
          is_home: false,
        },
        {
          name: 'Main',
          folder: 'main',
          added_at: '2026-04-05T09:00:00.000Z',
          executionMode: 'host',
          customCwd: '/srv/home',
          created_by: 'admin-1',
          is_home: true,
        },
      ),
    ).toBe('/srv/home');
  });

  test('falls back to the workspace customCwd when the home sibling has none', () => {
    expect(
      resolveEffectiveHostWorkspaceCwd(
        {
          name: 'Ops',
          folder: 'main',
          added_at: '2026-04-05T10:00:00.000Z',
          executionMode: 'host',
          customCwd: '/srv/main',
          created_by: 'member-1',
          is_home: false,
        },
        {
          name: 'Main',
          folder: 'main',
          added_at: '2026-04-05T09:00:00.000Z',
          executionMode: 'host',
          created_by: 'admin-1',
          is_home: true,
        },
      ),
    ).toBe('/srv/main');
  });
});
