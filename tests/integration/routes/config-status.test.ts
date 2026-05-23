import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-config-route-'));
  tempHomes.push(dir);
  return dir;
}

vi.mock('../../../src/web/middleware/auth.js', () => ({
  authMiddleware: async (_c: any, next: any) => {
    await next();
  },
}));

vi.mock('../../../src/messaging/channel.js', () => ({
  getChannelType: () => null,
}));

vi.mock('../../../src/storage/agents.js', () => ({
  getAgent: vi.fn(),
}));

vi.mock('../../../src/storage/workspaces.js', () => ({
  getRegisteredGroup: vi.fn(),
  setRegisteredGroup: vi.fn(),
}));

vi.mock('../../../src/web/context.js', () => ({
  getWebDeps: () => ({}),
  MAX_GROUP_NAME_LEN: 40,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('config status route', () => {
  test('reports configured instance IM providers without requiring live connections', async () => {
    const home = createTempHome();
    vi.stubEnv('HOME', home);

    const runtimeConfig = await import(
      '../../../src/core/runtime/config.js'
    );
    runtimeConfig.saveFeishuProviderConfig({
      appId: 'cli_configured',
      appSecret: 'configured-secret',
      enabled: true,
    });
    runtimeConfig.saveWeChatProviderConfig({
      botToken: 'configured-token',
      ilinkBotId: 'configured@im.bot',
      enabled: true,
    });

    const { default: configRoutes, injectConfigDeps } = await import(
      '../../../src/web/routes/config.js'
    );
    injectConfigDeps({
      isFeishuConnected: () => false,
      isWeChatConnected: () => false,
    });

    const app = new Hono();
    app.route('/api/config', configRoutes);

    const res = await app.request('/api/config/user-im/status');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      feishu: true,
      wechat: true,
    });
  });
});
