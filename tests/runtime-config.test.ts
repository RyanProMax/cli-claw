import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-runtime-'));
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

describe('runtime config storage', () => {
  test('ignores legacy provider config versions', async () => {
    const home = createTempHome();
    const configDir = path.join(home, '.cli-claw', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'claude-provider.json'),
      JSON.stringify({
        version: 3,
        activeProfileId: 'default',
        profiles: [],
        official: {
          updatedAt: '2026-04-04T00:00:00.000Z',
          secrets: {
            iv: 'legacy',
            tag: 'legacy',
            data: 'legacy',
          },
        },
      }),
    );

    vi.stubEnv('HOME', home);

    const runtimeConfig = await import('../src/runtime-config.js');

    expect(runtimeConfig.getProviders()).toEqual([]);
    expect(runtimeConfig.getBalancingConfig()).toEqual({
      strategy: 'round-robin',
      unhealthyThreshold: 3,
      recoveryIntervalMs: 300000,
    });
  });
});
