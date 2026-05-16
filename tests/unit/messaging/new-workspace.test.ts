import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createImNewWorkspaceGroup } from '../../../src/messaging/new-workspace.ts';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-im-new-'));
  tempDirs.push(dir);
  return dir;
}

describe('createImNewWorkspaceGroup', () => {
  test('materializes launch cwd when IM /new falls back to host mode', () => {
    const launchCwd = makeTempDir();

    const result = createImNewWorkspaceGroup({
      name: 'Ops',
      userId: 'admin-1',
      dockerAvailable: false,
      launchCwd,
      allowlist: null,
    });

    expect(result).toEqual(
      expect.objectContaining({
        jid: expect.stringMatching(/^web:/),
        folder: expect.stringMatching(/^flow-/),
        group: expect.objectContaining({
          name: 'Ops',
          executionMode: 'host',
          customCwd: fs.realpathSync(launchCwd),
          created_by: 'admin-1',
        }),
      }),
    );
  });
});
