import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-app-root-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('app root resolution', () => {
  test('separates package root from launch cwd', async () => {
    const launchDir = createTempDir();
    process.chdir(launchDir);
    const expectedLaunchCwd = fs.realpathSync(launchDir);

    const expectedAppRoot = path.resolve(
      path.dirname(
        fileURLToPath(new URL('../src/app-root.ts', import.meta.url)),
      ),
      '..',
    );

    const appRoot = await import('../src/app-root.js');

    expect(appRoot.APP_ROOT).toBe(expectedAppRoot);
    expect(appRoot.LAUNCH_CWD).toBe(expectedLaunchCwd);
    expect(appRoot.resolveAppPath('package.json')).toBe(
      path.join(expectedAppRoot, 'package.json'),
    );
  });
});
