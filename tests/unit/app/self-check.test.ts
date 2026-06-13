import { EventEmitter } from 'node:events';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { runSelfCheck } from '../../../src/core/self/self-check.js';
import { createStartupLaunchSpec } from '../../../src/core/self/startup-launch.js';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killedSignals: string[] = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killedSignals.push(String(signal || 'SIGTERM'));
    queueMicrotask(() => this.emit('exit', null, signal || 'SIGTERM'));
    return true;
  }
}

describe('runSelfCheck', () => {
  test('starts a candidate service with isolated HOME and cleans it up after health passes', async () => {
    const child = new FakeChildProcess();
    const spawnFn = vi.fn(() => child);
    const cleanupTempHome = vi.fn();
    const appRoot = '/repo';

    const result = await runSelfCheck({
      appRoot,
      now: vi
        .fn()
        .mockReturnValueOnce(new Date('2026-04-12T12:00:00.000Z'))
        .mockReturnValueOnce(new Date('2026-04-12T12:00:03.000Z')),
      makeTempHome: () => '/tmp/agent-fabric-self-check-abc',
      cleanupTempHome,
      getFreePort: async () => 3101,
      spawnFn,
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
      sleep: vi.fn(async () => {}),
      timeoutMs: 5000,
      intervalMs: 100,
    });

    expect(spawnFn).toHaveBeenCalledWith(
      process.execPath,
      [path.join(appRoot, 'dist', 'index.js')],
      expect.objectContaining({
        cwd: appRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: expect.objectContaining({
          HOME: '/tmp/agent-fabric-self-check-abc',
          WEB_PORT: '3101',
          AGENT_FABRIC_SELF_CHECK: '1',
        }),
      }),
    );
    expect(result).toMatchObject({
      status: 'passed',
      port: 3101,
      tempHome: '/tmp/agent-fabric-self-check-abc',
      healthUrl: 'http://127.0.0.1:3101/api/health',
      error: null,
    });
    expect(child.killedSignals).toEqual(['SIGTERM']);
    expect(cleanupTempHome).toHaveBeenCalledWith(
      '/tmp/agent-fabric-self-check-abc',
    );
  });

  test('starts the candidate with the authoritative launch spec command and cwd', async () => {
    const child = new FakeChildProcess();
    const spawnFn = vi.fn(() => child);
    const launchSpec = createStartupLaunchSpec({
      command: '/usr/local/bin/node',
      args: ['/repo/dist/cli.js', 'start'],
      cwd: '/workspace/from-launch-spec',
      source: 'cli_start',
    });

    const result = await runSelfCheck({
      appRoot: '/repo',
      launchSpec,
      now: vi
        .fn()
        .mockReturnValueOnce(new Date('2026-04-12T12:00:00.000Z'))
        .mockReturnValueOnce(new Date('2026-04-12T12:00:03.000Z')),
      makeTempHome: () => '/tmp/agent-fabric-self-check-abc',
      cleanupTempHome: vi.fn(),
      getFreePort: async () => 3101,
      spawnFn,
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
      sleep: vi.fn(async () => {}),
      timeoutMs: 5000,
      intervalMs: 100,
    });

    expect(spawnFn).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      ['/repo/dist/cli.js', 'start'],
      expect.objectContaining({
        cwd: '/workspace/from-launch-spec',
      }),
    );
    expect(result).toMatchObject({
      command: '/usr/local/bin/node',
      args: ['/repo/dist/cli.js', 'start'],
      cwd: '/workspace/from-launch-spec',
    });
  });

  test('fails when the candidate exits before health becomes healthy', async () => {
    const child = new FakeChildProcess();
    const cleanupTempHome = vi.fn();

    const resultPromise = runSelfCheck({
      appRoot: '/repo',
      now: vi
        .fn()
        .mockReturnValueOnce(new Date('2026-04-12T12:00:00.000Z'))
        .mockReturnValueOnce(new Date('2026-04-12T12:00:01.000Z')),
      makeTempHome: () => '/tmp/agent-fabric-self-check-abc',
      cleanupTempHome,
      getFreePort: async () => 3101,
      spawnFn: vi.fn(() => child),
      fetchFn: vi.fn(async () => ({ ok: false, status: 503 })),
      sleep: vi.fn(async () => {
        child.stderr.emit(
          'data',
          Buffer.from('\u001b[31mError: bad config\u001b[39m\n'),
        );
        child.emit('exit', 1, null);
      }),
      timeoutMs: 5000,
      intervalMs: 100,
    });

    await expect(resultPromise).resolves.toMatchObject({
      status: 'failed',
      error: 'candidate exited before health check passed',
      exitCode: 1,
      signal: null,
      outputTail: ['Error: bad config'],
    });
    expect(cleanupTempHome).toHaveBeenCalledWith(
      '/tmp/agent-fabric-self-check-abc',
    );
  });
});
