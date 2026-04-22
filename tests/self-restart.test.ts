import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createCliStartLaunchSpec,
  inferDirectBackendLaunchSpec,
  cleanupOrphanRunnerProcesses,
  hasPendingSelfRestartForChat,
  findPendingSelfRestartNotifications,
  markSelfRestartNotificationSent,
  readCurrentBackendRestartState,
  requestSelfRestart,
  requestSelfRestartFromSavedState,
  SELF_RESTART_REQUEST_CHAT_JID_ENV,
  resolveLaunchdServiceNameFromEnv,
  runSelfRestartWatchdog,
  summarizeResidualProcesses,
  type SelfRestartIntent,
  writeCurrentBackendRestartState,
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
  test('captures a restartable direct bun backend launch spec', () => {
    expect(
      inferDirectBackendLaunchSpec({
        execPath: '/Users/ryan/.bun/bin/bun',
        argv: ['/Users/ryan/.bun/bin/bun', 'src/index.ts'],
        cwd: '/Users/ryan/projects/cli-claw',
      }),
    ).toMatchObject({
      command: '/Users/ryan/.bun/bin/bun',
      args: ['src/index.ts'],
      cwd: '/Users/ryan/projects/cli-claw',
      source: 'direct_backend',
      restartable: true,
      validationError: null,
      displayCommand: '/Users/ryan/.bun/bin/bun src/index.ts',
    });
  });

  test('captures a restartable cli launcher start spec', () => {
    expect(
      createCliStartLaunchSpec({
        execPath: '/usr/local/bin/node',
        argvEntry: '/Users/ryan/projects/cli-claw/dist/cli.js',
        cwd: '/Users/ryan/projects/cli-claw',
      }),
    ).toMatchObject({
      command: '/usr/local/bin/node',
      args: ['/Users/ryan/projects/cli-claw/dist/cli.js', 'start'],
      cwd: '/Users/ryan/projects/cli-claw',
      source: 'cli_start',
      restartable: true,
      validationError: null,
      displayCommand:
        '/usr/local/bin/node /Users/ryan/projects/cli-claw/dist/cli.js start',
    });
  });

  test('marks missing backend entry argv as not restartable', () => {
    const spec = inferDirectBackendLaunchSpec({
      execPath: '/Users/ryan/.bun/bin/bun',
      argv: ['/Users/ryan/.bun/bin/bun'],
      cwd: '/Users/ryan/projects/cli-claw',
    });

    expect(spec.restartable).toBe(false);
    expect(spec.validationError).toContain('missing backend entrypoint');
  });

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
      requestChatJid: 'feishu:chat-1',
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
      requestChatJid: 'feishu:chat-1',
    });
    expect(intent.env).toBeUndefined();
  });

  test('rejects unsafe restart launch specs before writing an intent', () => {
    const dataDir = makeTempDir();
    const spawnFn = vi.fn();
    const watchdogScriptPath = path.join(dataDir, 'watchdog.js');
    fs.writeFileSync(watchdogScriptPath, '');

    const result = requestSelfRestart({
      dataDir,
      appRoot: '/repo',
      pid: 111,
      port: 3000,
      command: '/Users/ryan/.bun/bin/bun',
      args: [],
      cwd: '/repo',
      requestChatJid: 'feishu:chat-1',
      now: () => new Date('2026-04-12T13:00:00.000Z'),
      randomId: () => 'restart-unsafe',
      spawnFn,
      watchdogCommand: 'node',
      watchdogScriptPath,
    });

    expect(result).toEqual({
      status: 'failed',
      intentPath: null,
      error: expect.stringContaining('unsafe restart launch spec'),
    });
    expect(spawnFn).not.toHaveBeenCalled();
    expect(
      fs.existsSync(
        path.join(dataDir, 'ops', 'restarts', 'restart-unsafe.json'),
      ),
    ).toBe(false);
  });

  test('writes and reuses saved backend restart state for external restart requests', () => {
    const dataDir = makeTempDir();
    const child = Object.assign(new EventEmitter(), {
      pid: 9876,
      unref: vi.fn(),
    });
    const spawnFn = vi.fn(() => child);
    const watchdogScriptPath = path.join(dataDir, 'watchdog.js');
    fs.writeFileSync(watchdogScriptPath, '');

    writeCurrentBackendRestartState(
      {
        pid: 111,
        startedAt: '2026-04-12T13:00:00.000Z',
        appRoot: '/repo',
        port: 3000,
        launchSpec: {
          command: '/Users/ryan/.bun/bin/bun',
          args: ['src/index.ts'],
          cwd: '/repo',
          source: 'direct_backend',
          restartable: true,
          validationError: null,
          displayCommand: '/Users/ryan/.bun/bin/bun src/index.ts',
        },
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
      },
      { dataDir },
    );

    expect(readCurrentBackendRestartState({ dataDir })).toMatchObject({
      pid: 111,
      launchdServiceName: 'gui/501/com.ryan.cli-claw',
    });

    const result = requestSelfRestartFromSavedState({
      dataDir,
      now: () => new Date('2026-04-12T13:00:00.000Z'),
      randomId: () => 'restart-from-state',
      spawnFn,
      watchdogCommand: 'node',
      watchdogScriptPath,
    });

    expect(result).toMatchObject({
      status: 'accepted',
      watchdogPid: 9876,
    });

    const intent = JSON.parse(
      fs.readFileSync(result.intentPath, 'utf8'),
    ) as SelfRestartIntent;
    expect(intent).toMatchObject({
      pid: 111,
      command: '/Users/ryan/.bun/bin/bun',
      args: ['src/index.ts'],
      launchdServiceName: 'gui/501/com.ryan.cli-claw',
    });
  });

  test('reads the launchd service name from env', () => {
    expect(
      resolveLaunchdServiceNameFromEnv({
        CLI_CLAW_LAUNCHD_SERVICE_NAME: 'gui/501/com.ryan.cli-claw',
      }),
    ).toBe('gui/501/com.ryan.cli-claw');
    expect(resolveLaunchdServiceNameFromEnv({})).toBeNull();
  });

  test('reuses IM restart reply context from env for external restart requests', () => {
    const dataDir = makeTempDir();
    const child = Object.assign(new EventEmitter(), {
      pid: 9876,
      unref: vi.fn(),
    });
    const spawnFn = vi.fn(() => child);
    const watchdogScriptPath = path.join(dataDir, 'watchdog.js');
    fs.writeFileSync(watchdogScriptPath, '');

    writeCurrentBackendRestartState(
      {
        pid: 111,
        startedAt: '2026-04-12T13:00:00.000Z',
        appRoot: '/repo',
        port: 3000,
        launchSpec: {
          command: '/Users/ryan/.bun/bin/bun',
          args: ['src/index.ts'],
          cwd: '/repo',
          source: 'direct_backend',
          restartable: true,
          validationError: null,
          displayCommand: '/Users/ryan/.bun/bin/bun src/index.ts',
        },
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
      },
      { dataDir },
    );

    const result = requestSelfRestartFromSavedState({
      dataDir,
      env: {
        [SELF_RESTART_REQUEST_CHAT_JID_ENV]: 'feishu:chat-1',
      },
      now: () => new Date('2026-04-12T13:00:00.000Z'),
      randomId: () => 'restart-from-env',
      spawnFn,
      watchdogCommand: 'node',
      watchdogScriptPath,
    });

    const intent = JSON.parse(
      fs.readFileSync(result.intentPath!, 'utf8'),
    ) as SelfRestartIntent;
    expect(intent.requestChatJid).toBe('feishu:chat-1');
  });

  test('ignores non-IM restart reply context from env for external restart requests', () => {
    const dataDir = makeTempDir();
    const child = Object.assign(new EventEmitter(), {
      pid: 9876,
      unref: vi.fn(),
    });
    const spawnFn = vi.fn(() => child);
    const watchdogScriptPath = path.join(dataDir, 'watchdog.js');
    fs.writeFileSync(watchdogScriptPath, '');

    writeCurrentBackendRestartState(
      {
        pid: 111,
        startedAt: '2026-04-12T13:00:00.000Z',
        appRoot: '/repo',
        port: 3000,
        launchSpec: {
          command: '/Users/ryan/.bun/bin/bun',
          args: ['src/index.ts'],
          cwd: '/repo',
          source: 'direct_backend',
          restartable: true,
          validationError: null,
          displayCommand: '/Users/ryan/.bun/bin/bun src/index.ts',
        },
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
      },
      { dataDir },
    );

    const result = requestSelfRestartFromSavedState({
      dataDir,
      env: {
        [SELF_RESTART_REQUEST_CHAT_JID_ENV]: 'web:main',
      },
      now: () => new Date('2026-04-12T13:00:00.000Z'),
      randomId: () => 'restart-from-web-env',
      spawnFn,
      watchdogCommand: 'node',
      watchdogScriptPath,
    });

    const intent = JSON.parse(
      fs.readFileSync(result.intentPath!, 'utf8'),
    ) as SelfRestartIntent;
    expect(intent.requestChatJid).toBeNull();
  });
});

describe('self-restart success notifications', () => {
  test('finds pending success notifications for the current replacement pid and marks them as sent', () => {
    const dataDir = makeTempDir();
    const intentDir = path.join(dataDir, 'ops', 'restarts');
    fs.mkdirSync(intentDir, { recursive: true });
    const intentPath = path.join(intentDir, 'restart-abc.json');
    fs.writeFileSync(
      intentPath,
      JSON.stringify({
        id: 'restart-abc',
        status: 'passed',
        createdAt: '2026-04-12T13:00:00.000Z',
        updatedAt: '2026-04-12T13:00:05.000Z',
        appRoot: '/repo',
        pid: 111,
        port: 3000,
        command: 'node',
        args: ['/repo/dist/index.js'],
        cwd: '/repo',
        healthUrl: 'http://127.0.0.1:3000/api/health',
        newPid: 222,
        requestChatJid: 'feishu:chat-1',
      }),
    );

    expect(
      findPendingSelfRestartNotifications({
        dataDir,
        pid: 222,
      }),
    ).toMatchObject([
      {
        intentPath,
        intent: {
          id: 'restart-abc',
          requestChatJid: 'feishu:chat-1',
          status: 'passed',
        },
      },
    ]);

    markSelfRestartNotificationSent(intentPath, {
      now: () => new Date('2026-04-12T13:00:06.000Z'),
    });

    expect(
      findPendingSelfRestartNotifications({
        dataDir,
        pid: 222,
      }),
    ).toEqual([]);
  });

  test('matches the latest launchd-managed success notification once for the current startup window', () => {
    const dataDir = makeTempDir();
    const intentDir = path.join(dataDir, 'ops', 'restarts');
    fs.mkdirSync(intentDir, { recursive: true });

    fs.writeFileSync(
      path.join(intentDir, 'restart-old.json'),
      JSON.stringify({
        id: 'restart-old',
        status: 'passed',
        createdAt: '2026-04-22T08:43:39.369Z',
        updatedAt: '2026-04-22T08:43:45.111Z',
        appRoot: '/repo',
        pid: 74606,
        port: 3000,
        command: 'node',
        args: ['/repo/dist/index.js'],
        cwd: '/repo',
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
        healthUrl: 'http://127.0.0.1:3000/api/health',
        newPid: null,
        requestChatJid: 'feishu:chat-old',
      }),
    );
    const latestIntentPath = path.join(intentDir, 'restart-latest.json');
    fs.writeFileSync(
      latestIntentPath,
      JSON.stringify({
        id: 'restart-latest',
        status: 'passed',
        createdAt: '2026-04-22T11:33:37.486Z',
        updatedAt: '2026-04-22T11:33:43.567Z',
        appRoot: '/repo',
        pid: 77141,
        port: 3000,
        command: 'node',
        args: ['/repo/dist/index.js'],
        cwd: '/repo',
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
        healthUrl: 'http://127.0.0.1:3000/api/health',
        newPid: null,
        requestChatJid: 'feishu:chat-new',
      }),
    );

    expect(
      findPendingSelfRestartNotifications({
        dataDir,
        pid: 8566,
        startedAt: '2026-04-22T11:33:43.450Z',
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
      }),
    ).toMatchObject([
      {
        intentPath: latestIntentPath,
        intent: {
          id: 'restart-latest',
          requestChatJid: 'feishu:chat-new',
          status: 'passed',
        },
      },
    ]);
  });

  test('detects a pending self-restart for the same pid and IM chat before shutdown completes', () => {
    const dataDir = makeTempDir();
    const intentDir = path.join(dataDir, 'ops', 'restarts');
    fs.mkdirSync(intentDir, { recursive: true });
    fs.writeFileSync(
      path.join(intentDir, 'restart-pending.json'),
      JSON.stringify({
        id: 'restart-pending',
        status: 'restarting',
        createdAt: '2026-04-22T11:33:37.486Z',
        updatedAt: '2026-04-22T11:33:38.121Z',
        appRoot: '/repo',
        pid: 77141,
        port: 3000,
        command: 'node',
        args: ['/repo/dist/index.js'],
        cwd: '/repo',
        healthUrl: 'http://127.0.0.1:3000/api/health',
        requestChatJid: 'feishu:chat-1',
      }),
    );

    expect(
      hasPendingSelfRestartForChat({
        dataDir,
        pid: 77141,
        requestChatJid: 'feishu:chat-1',
      }),
    ).toBe(true);
    expect(
      hasPendingSelfRestartForChat({
        dataDir,
        pid: 77141,
        requestChatJid: 'feishu:chat-2',
      }),
    ).toBe(false);
  });

  test('summarizes extra backend processes and orphaned runner chains', () => {
    const summary = summarizeResidualProcesses(
      [
        ' 17510     1 /Users/ryan/.bun/bin/bun src/index.ts',
        ' 20001     1 /Users/ryan/.bun/bin/bun src/index.ts',
        ' 18611 17510 node /Users/ryan/projects/cli-claw/container/agent-runner/dist/index.js',
        ' 18651 18611 npm exec @zed-industries/codex-acp',
        ' 18718     1 node /Users/ryan/.npm/_npx/.../.bin/codex-acp',
      ].join('\n'),
      17510,
    );

    expect(summary).toEqual({
      backendProcessCount: 2,
      extraBackendPids: [20001],
      runnerProcessCount: 3,
      orphanRunnerPids: [18718],
    });
  });

  test('kills only truly orphaned runner processes during residual cleanup', () => {
    const killProcess = vi.fn();

    const cleaned = cleanupOrphanRunnerProcesses(
      {
        backendProcessCount: 1,
        extraBackendPids: [],
        runnerProcessCount: 3,
        orphanRunnerPids: [18718, 18719],
      },
      { killProcess },
    );

    expect(killProcess).toHaveBeenCalledTimes(2);
    expect(killProcess).toHaveBeenNthCalledWith(1, 18718, 'SIGTERM');
    expect(killProcess).toHaveBeenNthCalledWith(2, 18719, 'SIGTERM');
    expect(cleaned).toEqual({
      attemptedRunnerPids: [18718, 18719],
      failedRunnerPids: [],
    });
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

  test('uses launchd kickstart instead of manual spawn when the intent is launchd-managed', async () => {
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
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
        healthUrl: 'http://127.0.0.1:3000/api/health',
      }),
    );
    const killProcess = vi.fn();
    const spawnService = vi.fn();
    const restartLaunchdService = vi.fn(async () => {});

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
      spawnService,
      restartLaunchdService,
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
      sleep: vi.fn(async () => {}),
    });

    expect(restartLaunchdService).toHaveBeenCalledWith(
      'gui/501/com.ryan.cli-claw',
    );
    expect(killProcess).not.toHaveBeenCalled();
    expect(spawnService).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'passed', newPid: null });

    const updated = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
    expect(updated).toMatchObject({
      status: 'passed',
      newPid: null,
      launchdServiceName: 'gui/501/com.ryan.cli-claw',
    });
  });
});
