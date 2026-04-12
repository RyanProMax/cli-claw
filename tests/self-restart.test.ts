import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  requestSelfRestart,
  runSelfRestartWatchdog,
  type SelfRestartIntent,
} from '../src/self-restart.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-restart-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('requestSelfRestart', () => {
  test('writes an intent without persisting env and spawns a detached watchdog', () => {
    const dataDir = makeTempDir();
    const child = Object.assign(new EventEmitter(), {
      pid: 4321,
      unref: vi.fn(),
    });
    const spawnFn = vi.fn(() => child);
    const watchdogScriptPath = path.join(dataDir, 'watchdog.js');
    fs.writeFileSync(watchdogScriptPath, '');

    const result = requestSelfRestart({
      dataDir,
      appRoot: '/repo',
      pid: 111,
      port: 3000,
      command: 'node',
      args: ['/repo/dist/index.js'],
      cwd: '/repo',
      now: () => new Date('2026-04-12T13:00:00.000Z'),
      randomId: () => 'restart-abc',
      spawnFn,
      watchdogCommand: 'node',
      watchdogScriptPath,
    });

    expect(result).toMatchObject({
      status: 'accepted',
      watchdogPid: 4321,
    });
    expect(child.unref).toHaveBeenCalled();
    expect(spawnFn).toHaveBeenCalledWith(
      'node',
      [watchdogScriptPath, result.intentPath],
      expect.objectContaining({
        cwd: '/repo',
        detached: true,
        stdio: 'ignore',
        env: expect.objectContaining({
          CLI_CLAW_RESTART_WATCHDOG: '1',
        }),
      }),
    );

    const intent = JSON.parse(
      fs.readFileSync(result.intentPath, 'utf8'),
    ) as SelfRestartIntent & { env?: unknown };
    expect(intent).toMatchObject({
      id: 'restart-abc',
      status: 'requested',
      pid: 111,
      port: 3000,
      command: 'node',
      args: ['/repo/dist/index.js'],
      cwd: '/repo',
    });
    expect(intent.env).toBeUndefined();
  });
});

describe('runSelfRestartWatchdog', () => {
  test('does not stop the current service when preflight self-check fails', async () => {
    const dataDir = makeTempDir();
    const intentPath = path.join(dataDir, 'restart.json');
    fs.writeFileSync(
      intentPath,
      JSON.stringify({
        id: 'restart-abc',
        status: 'requested',
        createdAt: '2026-04-12T13:00:00.000Z',
        updatedAt: '2026-04-12T13:00:00.000Z',
        appRoot: '/repo',
        pid: 111,
        port: 3000,
        command: 'node',
        args: ['/repo/dist/index.js'],
        cwd: '/repo',
        healthUrl: 'http://127.0.0.1:3000/api/health',
      }),
    );
    const killProcess = vi.fn();
    const spawnService = vi.fn();

    const result = await runSelfRestartWatchdog(intentPath, {
      now: () => new Date('2026-04-12T13:00:01.000Z'),
      runSelfCheck: vi.fn(async () => ({
        status: 'failed',
        startedAt: '2026-04-12T13:00:00.000Z',
        finishedAt: '2026-04-12T13:00:01.000Z',
        durationMs: 1000,
        port: 3101,
        command: 'node',
        args: ['/repo/dist/index.js'],
        tempHome: '/tmp/check',
        healthUrl: 'http://127.0.0.1:3101/api/health',
        error: 'bad config',
        exitCode: 1,
        signal: null,
        outputTail: ['bad config'],
      })),
      killProcess,
      spawnService,
    });

    expect(result.status).toBe('preflight_failed');
    expect(killProcess).not.toHaveBeenCalled();
    expect(spawnService).not.toHaveBeenCalled();

    const updated = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
    expect(updated).toMatchObject({
      status: 'preflight_failed',
      error: 'bad config',
      preflight: { status: 'failed' },
    });
  });

  test('stops the old process and starts the replacement after preflight passes', async () => {
    const dataDir = makeTempDir();
    const intentPath = path.join(dataDir, 'restart.json');
    fs.writeFileSync(
      intentPath,
      JSON.stringify({
        id: 'restart-abc',
        status: 'requested',
        createdAt: '2026-04-12T13:00:00.000Z',
        updatedAt: '2026-04-12T13:00:00.000Z',
        appRoot: '/repo',
        pid: 111,
        port: 3000,
        command: 'node',
        args: ['/repo/dist/index.js'],
        cwd: '/repo',
        healthUrl: 'http://127.0.0.1:3000/api/health',
      }),
    );
    const replacement = Object.assign(new EventEmitter(), {
      pid: 222,
      unref: vi.fn(),
    });
    const killProcess = vi.fn();
    const spawnService = vi.fn(() => replacement);

    const result = await runSelfRestartWatchdog(intentPath, {
      now: () => new Date('2026-04-12T13:00:02.000Z'),
      runSelfCheck: vi.fn(async () => ({
        status: 'passed',
        startedAt: '2026-04-12T13:00:00.000Z',
        finishedAt: '2026-04-12T13:00:01.000Z',
        durationMs: 1000,
        port: 3101,
        command: 'node',
        args: ['/repo/dist/index.js'],
        tempHome: '/tmp/check',
        healthUrl: 'http://127.0.0.1:3101/api/health',
        error: null,
        exitCode: null,
        signal: null,
        outputTail: [],
      })),
      killProcess,
      isProcessAlive: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
      spawnService,
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
      sleep: vi.fn(async () => {}),
    });

    expect(killProcess).toHaveBeenCalledWith(111, 'SIGTERM');
    expect(spawnService).toHaveBeenCalledWith(
      'node',
      ['/repo/dist/index.js'],
      expect.objectContaining({
        cwd: '/repo',
        detached: true,
        stdio: 'ignore',
        env: expect.objectContaining({ WEB_PORT: '3000' }),
      }),
    );
    expect(replacement.unref).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'passed', newPid: 222 });

    const updated = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
    expect(updated).toMatchObject({
      status: 'passed',
      newPid: 222,
      preflight: { status: 'passed' },
    });
  });
});
