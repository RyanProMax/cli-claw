import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fabric-runtime-'));
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

    const runtimeConfig =
      await import('../../../../src/core/runtime/config.js');

    expect(runtimeConfig.getOpenAiRuntimeDefaults()).toEqual({
      model: 'gpt-5.4-mini',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
    });
  });

  test('normalizes Codex backend priority service tier to OpenAI fast speed', async () => {
    vi.stubEnv('OPENAI_SERVICE_TIER', 'priority');

    const runtimeConfig =
      await import('../../../../src/core/runtime/config.js');

    expect(runtimeConfig.getOpenAiRuntimeDefaults().speedTier).toBe('fast');
  });

  test('does not expose legacy provider pool APIs', async () => {
    const home = createTempHome();
    const configDir = path.join(home, '.agent-fabric', 'config');
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

    const runtimeConfig =
      await import('../../../../src/core/runtime/config.js');

    expect('getProviders' in runtimeConfig).toBe(false);
    expect('getBalancingConfig' in runtimeConfig).toBe(false);
    expect(runtimeConfig.getOpenAiRuntimeDefaults().model).toBe('gpt-5.4');
  });

  test('promotes user-scoped Feishu config to instance config', async () => {
    const home = createTempHome();
    vi.stubEnv('HOME', home);

    const runtimeConfig =
      await import('../../../../src/core/runtime/config.js');
    const saved = runtimeConfig.saveFeishuProviderConfig({
      appId: 'cli_old_user_app',
      appSecret: 'old-user-secret',
      enabled: true,
    });
    expect(saved.appId).toBe('cli_old_user_app');

    const configDir = path.join(home, '.agent-fabric', 'config');
    const instancePath = path.join(configDir, 'feishu-provider.json');
    const userScopedPath = path.join(
      configDir,
      'user-im',
      'operator-user',
      'feishu.json',
    );
    fs.mkdirSync(path.dirname(userScopedPath), { recursive: true });
    fs.renameSync(instancePath, userScopedPath);

    const { config, source } =
      runtimeConfig.getFeishuProviderConfigWithSource();

    expect(source).toBe('runtime');
    expect(config.appId).toBe('cli_old_user_app');
    expect(config.appSecret).toBe('old-user-secret');
    expect(config.enabled).toBe(true);
    expect(fs.existsSync(instancePath)).toBe(true);
    expect(fs.existsSync(userScopedPath)).toBe(false);
  });

  test('promotes user-scoped WeChat config to instance config', async () => {
    const home = createTempHome();
    vi.stubEnv('HOME', home);

    const runtimeConfig =
      await import('../../../../src/core/runtime/config.js');
    const saved = runtimeConfig.saveWeChatProviderConfig({
      botToken: 'old-user-token',
      ilinkBotId: 'bot@im.bot',
      bypassProxy: false,
      enabled: true,
    });
    expect(saved.ilinkBotId).toBe('bot@im.bot');

    const configDir = path.join(home, '.agent-fabric', 'config');
    const instancePath = path.join(configDir, 'wechat-provider.json');
    const userScopedPath = path.join(
      configDir,
      'user-im',
      'operator-user',
      'wechat.json',
    );
    fs.mkdirSync(path.dirname(userScopedPath), { recursive: true });
    fs.renameSync(instancePath, userScopedPath);

    const config = runtimeConfig.getWeChatProviderConfig();

    expect(config?.botToken).toBe('old-user-token');
    expect(config?.ilinkBotId).toBe('bot@im.bot');
    expect(config?.bypassProxy).toBe(false);
    expect(config?.enabled).toBe(true);
    expect(fs.existsSync(instancePath)).toBe(true);
    expect(fs.existsSync(userScopedPath)).toBe(false);
  });
});
