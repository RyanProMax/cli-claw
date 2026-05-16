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
  test('builds OpenAI runtime defaults from local environment only', async () => {
    vi.stubEnv('OPENAI_MODEL', 'gpt-5.4-mini');
    vi.stubEnv('OPENAI_REASONING_EFFORT', 'xhigh');
    vi.stubEnv('OPENAI_SERVICE_TIER', 'fast');

    const runtimeConfig = await import('../src/runtime-config.js');

    expect(runtimeConfig.getOpenAiRuntimeDefaults()).toEqual({
      model: 'gpt-5.4-mini',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
    });
  });

  test('normalizes Codex backend priority service tier to OpenAI fast speed', async () => {
    vi.stubEnv('OPENAI_SERVICE_TIER', 'priority');

    const runtimeConfig = await import('../src/runtime-config.js');

    expect(runtimeConfig.getOpenAiRuntimeDefaults().speedTier).toBe('fast');
  });

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
