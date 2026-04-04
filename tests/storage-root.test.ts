import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-home-'));
  tempHomes.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('storage root config', () => {
  test('stores runtime data under ~/.cli-claw', async () => {
    const home = createTempHome();
    vi.stubEnv('HOME', home);

    const config = await import('../src/config.js');

    expect(config.DATA_DIR).toBe(path.join(home, '.cli-claw'));
    expect(config.STORE_DIR).toBe(path.join(home, '.cli-claw', 'db'));
    expect(config.GROUPS_DIR).toBe(path.join(home, '.cli-claw', 'groups'));
  });
});
