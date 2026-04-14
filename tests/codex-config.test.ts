import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  buildHostRuntimePath,
  checkCodexCliReady,
  readCodexCliConfig,
} from '../src/codex-config.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeConfig(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-config-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'config.toml');
  fs.writeFileSync(file, contents, 'utf-8');
  return file;
}

describe('readCodexCliConfig', () => {
  test('reads model and model_reasoning_effort from codex config', () => {
    const file = makeConfig([
      'model = "gpt-5.4"',
      'model_reasoning_effort = "xhigh"',
    ].join('\n'));

    expect(readCodexCliConfig(file)).toEqual({
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    });
  });

  test('falls back to reasoning_effort and tolerates missing file', () => {
    const file = makeConfig([
      'model = "gpt-5.4"',
      'reasoning_effort = "high"',
    ].join('\n'));

    expect(readCodexCliConfig(file)).toEqual({
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });
    expect(readCodexCliConfig(path.join(file, '.missing'))).toEqual({
      model: null,
      reasoningEffort: null,
    });
  });
});

describe('buildHostRuntimePath', () => {
  test('preserves current PATH order and appends common host runtime dirs once', () => {
    expect(
      buildHostRuntimePath({
        pathValue: '/usr/bin:/bin:/opt/homebrew/bin',
        homeDir: '/Users/ryan',
      }),
    ).toBe('/usr/bin:/bin:/opt/homebrew/bin:/Users/ryan/.bun/bin:/usr/local/bin');
  });
});

describe('checkCodexCliReady', () => {
  test('falls back to common Homebrew paths when service PATH omits codex', () => {
    const execFileSyncFn = vi.fn(() => 'Logged in using ChatGPT');

    const readiness = checkCodexCliReady({
      env: {
        PATH: '/usr/bin:/bin',
        HOME: '/Users/ryan',
      },
      existsSyncFn: (target) => target === '/opt/homebrew/bin/codex',
      accessSyncFn: (target) => {
        if (target !== '/opt/homebrew/bin/codex') {
          throw new Error('not executable');
        }
      },
      execFileSyncFn,
    });

    expect(readiness).toMatchObject({
      status: 'ready',
      command: '/opt/homebrew/bin/codex',
      message: null,
    });
    expect(execFileSyncFn).toHaveBeenCalledWith(
      '/opt/homebrew/bin/codex',
      ['login', 'status'],
      expect.objectContaining({
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        env: expect.objectContaining({
          HOME: '/Users/ryan',
          PATH:
            '/usr/bin:/bin:/Users/ryan/.bun/bin:/opt/homebrew/bin:/usr/local/bin',
        }),
      }),
    );
  });

  test('reports missing codex separately from login failures', () => {
    const readiness = checkCodexCliReady({
      env: {
        PATH: '/usr/bin:/bin',
        HOME: '/Users/ryan',
      },
      existsSyncFn: () => false,
      accessSyncFn: () => {
        throw new Error('not executable');
      },
      execFileSyncFn: vi.fn(),
    });

    expect(readiness.status).toBe('missing');
    expect(readiness.command).toBeNull();
    expect(readiness.message).toContain('Codex CLI 不在当前服务 PATH 中');
    expect(readiness.message).toContain('/usr/bin:/bin:/Users/ryan/.bun/bin:/opt/homebrew/bin:/usr/local/bin');
  });

  test('preserves the login hint when codex exists but auth is missing', () => {
    const execFileSyncFn = vi.fn(() => {
      const err = new Error('auth required') as Error & {
        stderr: Buffer;
        stdout: Buffer;
        status: number;
      };
      err.stderr = Buffer.from(
        'codex error: auth_required, please login before continuing',
      );
      err.stdout = Buffer.alloc(0);
      err.status = 1;
      throw err;
    });

    const readiness = checkCodexCliReady({
      env: {
        PATH: '/usr/bin:/bin',
        HOME: '/Users/ryan',
      },
      existsSyncFn: (target) => target === '/opt/homebrew/bin/codex',
      accessSyncFn: (target) => {
        if (target !== '/opt/homebrew/bin/codex') {
          throw new Error('not executable');
        }
      },
      execFileSyncFn,
    });

    expect(readiness).toMatchObject({
      status: 'not_logged_in',
      command: '/opt/homebrew/bin/codex',
      message: 'Codex CLI 未登录。请先在服务器上执行：codex login',
    });
  });
});
