import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fabric-home-'));
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
  test('stores runtime data under ~/.agent-fabric', async () => {
    const home = createTempHome();
    vi.stubEnv('HOME', home);

    const config = await import('../../../../src/core/config.js');

    expect(config.DATA_DIR).toBe(path.join(home, '.agent-fabric'));
    expect(config.STORE_DIR).toBe(path.join(home, '.agent-fabric', 'db'));
    expect(config.GROUPS_DIR).toBe(path.join(home, '.agent-fabric', 'groups'));
  });

  test('ignores legacy ~/.cli-claw when the new root does not exist', async () => {
    const home = createTempHome();
    fs.mkdirSync(path.join(home, '.cli-claw'), { recursive: true });
    vi.stubEnv('HOME', home);

    const config = await import('../../../../src/core/config.js');

    expect(config.DATA_DIR).toBe(path.join(home, '.agent-fabric'));
  });

  test('uses AGENT_FABRIC_HOME as the only home override', async () => {
    const home = createTempHome();
    const currentRoot = path.join(home, 'current-root');
    const legacyRoot = path.join(home, 'legacy-root');
    vi.stubEnv('HOME', home);
    vi.stubEnv('AGENT_FABRIC_HOME', currentRoot);
    vi.stubEnv('CLI_CLAW_HOME', legacyRoot);

    const config = await import('../../../../src/core/config.js');

    expect(config.DATA_DIR).toBe(currentRoot);
  });

  test('ignores legacy CLI_CLAW_HOME when AGENT_FABRIC_HOME is unset', async () => {
    const home = createTempHome();
    const legacyRoot = path.join(home, 'legacy-root');
    vi.stubEnv('HOME', home);
    vi.stubEnv('CLI_CLAW_HOME', legacyRoot);

    const config = await import('../../../../src/core/config.js');

    expect(config.DATA_DIR).toBe(path.join(home, '.agent-fabric'));
  });
});
