import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

import { DATA_DIR, WEB_PORT } from './config.js';
import { APP_ROOT } from './app-root.js';
import { runSelfCheck, type SelfCheckResult } from './self-check.js';

export type SelfRestartStatus =
  | 'requested'
  | 'preflight'
  | 'preflight_failed'
  | 'restarting'
  | 'passed'
  | 'failed';

export interface SelfRestartIntent {
  id: string;
  status: SelfRestartStatus;
  createdAt: string;
  updatedAt: string;
  appRoot: string;
  pid: number;
  port: number;
  command: string;
  args: string[];
  cwd: string;
  healthUrl: string;
  preflight?: SelfCheckResult;
  newPid?: number | null;
  error?: string | null;
}

interface SpawnedProcess extends EventEmitter {
  pid?: number;
  unref?: () => void;
}

interface SpawnOptions {
  cwd: string;
  detached: boolean;
  stdio: 'ignore';
  env: NodeJS.ProcessEnv;
}

interface RequestSelfRestartOptions {
  dataDir?: string;
  appRoot?: string;
  pid?: number;
  port?: number;
  command?: string;
  args?: string[];
  cwd?: string;
  now?: () => Date;
  randomId?: () => string;
  watchdogCommand?: string;
  watchdogScriptPath?: string;
  spawnFn?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => SpawnedProcess;
}

export type SelfRestartRequestResult =
  | {
      status: 'accepted';
      intentPath: string;
      watchdogPid: number | null;
    }
  | {
      status: 'failed';
      intentPath: string | null;
      error: string;
    };

export interface SelfRestartWatchdogResult {
  status: SelfRestartStatus;
  newPid?: number | null;
  error?: string | null;
}

interface WatchdogDeps {
  now?: () => Date;
  runSelfCheck?: typeof runSelfCheck;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  isProcessAlive?: (pid: number) => boolean;
  spawnService?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => SpawnedProcess;
  fetchFn?: (url: string) => Promise<{ ok: boolean; status: number }>;
  sleep?: (ms: number) => Promise<void>;
}

const RESTART_HEALTH_TIMEOUT_MS = 15_000;
const RESTART_HEALTH_INTERVAL_MS = 250;
const STOP_TIMEOUT_MS = 10_000;

function defaultNow(): Date {
  return new Date();
}

function defaultRandomId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `restart-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeIntent(intentPath: string, intent: SelfRestartIntent): void {
  fs.writeFileSync(intentPath, JSON.stringify(intent, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function readIntent(intentPath: string): SelfRestartIntent {
  return JSON.parse(fs.readFileSync(intentPath, 'utf8')) as SelfRestartIntent;
}

function patchIntent(
  intentPath: string,
  patch: Partial<SelfRestartIntent>,
  now: () => Date,
): SelfRestartIntent {
  const next = {
    ...readIntent(intentPath),
    ...patch,
    updatedAt: now().toISOString(),
  };
  writeIntent(intentPath, next);
  return next;
}

function buildRestartEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WEB_PORT: String(port),
    CLI_CLAW_RESTARTED_BY_WATCHDOG: '1',
  };
  delete env.CLI_CLAW_SELF_CHECK;
  delete env.CLI_CLAW_RESTART_WATCHDOG;
  return env;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopOldProcess(options: {
  pid: number;
  killProcess: (pid: number, signal: NodeJS.Signals) => void;
  isProcessAlive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
}): Promise<void> {
  if (!options.isProcessAlive(options.pid)) return;

  options.killProcess(options.pid, 'SIGTERM');
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!options.isProcessAlive(options.pid)) return;
    await options.sleep(RESTART_HEALTH_INTERVAL_MS);
  }

  options.killProcess(options.pid, 'SIGKILL');
  const killDeadline = Date.now() + 2_000;
  while (Date.now() < killDeadline) {
    if (!options.isProcessAlive(options.pid)) return;
    await options.sleep(RESTART_HEALTH_INTERVAL_MS);
  }
  throw new Error(`old process ${options.pid} still alive after SIGKILL`);
}

async function waitForHealth(
  healthUrl: string,
  deps: {
    fetchFn: (url: string) => Promise<{ ok: boolean; status: number }>;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<string | null> {
  let lastError: string | null = null;
  const deadline = Date.now() + RESTART_HEALTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await deps.fetchFn(healthUrl);
      if (response.ok) return null;
      lastError = `health returned HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await deps.sleep(RESTART_HEALTH_INTERVAL_MS);
  }

  return lastError
    ? `replacement health check timed out: ${lastError}`
    : 'replacement health check timed out';
}

export function requestSelfRestart(
  options: RequestSelfRestartOptions = {},
): SelfRestartRequestResult {
  const now = options.now || defaultNow;
  const createdAt = now().toISOString();
  const id = (options.randomId || defaultRandomId)();
  const dataDir = options.dataDir || DATA_DIR;
  const appRoot = options.appRoot || APP_ROOT;
  const port = options.port || WEB_PORT;
  const command = options.command || process.execPath;
  const args = options.args || process.argv.slice(1);
  const cwd = options.cwd || process.cwd();
  const intentDir = path.join(dataDir, 'ops', 'restarts');
  const intentPath = path.join(intentDir, `${id}.json`);
  const watchdogScript =
    options.watchdogScriptPath ||
    path.join(appRoot, 'dist', 'self-restart-watchdog.js');
  const spawnFn = options.spawnFn || spawn;
  const watchdogCommand = options.watchdogCommand || process.execPath;

  const intent: SelfRestartIntent = {
    id,
    status: 'requested',
    createdAt,
    updatedAt: createdAt,
    appRoot,
    pid: options.pid || process.pid,
    port,
    command,
    args,
    cwd,
    healthUrl: `http://127.0.0.1:${port}/api/health`,
  };

  try {
    fs.mkdirSync(intentDir, { recursive: true });
    writeIntent(intentPath, intent);
    if (!fs.existsSync(watchdogScript)) {
      throw new Error(`watchdog script not found: ${watchdogScript}`);
    }

    const proc = spawnFn(watchdogCommand, [watchdogScript, intentPath], {
      cwd: appRoot,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CLI_CLAW_RESTART_WATCHDOG: '1',
      },
    });
    proc.unref?.();

    return {
      status: 'accepted',
      intentPath,
      watchdogPid: proc.pid ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (fs.existsSync(intentPath)) {
      patchIntent(intentPath, { status: 'failed', error: message }, now);
    }
    return { status: 'failed', intentPath, error: message };
  }
}

export async function runSelfRestartWatchdog(
  intentPath: string,
  deps: WatchdogDeps = {},
): Promise<SelfRestartWatchdogResult> {
  const now = deps.now || defaultNow;
  const runCheck = deps.runSelfCheck || runSelfCheck;
  const killProcess = deps.killProcess || process.kill;
  const isProcessAlive = deps.isProcessAlive || defaultIsProcessAlive;
  const spawnService = deps.spawnService || spawn;
  const fetchFn = deps.fetchFn || fetch;
  const sleep = deps.sleep || defaultSleep;

  const intent = patchIntent(intentPath, { status: 'preflight' }, now);
  const preflight = await runCheck({
    appRoot: intent.appRoot,
    command: intent.command,
    args: intent.args,
  });

  if (preflight.status !== 'passed') {
    const updated = patchIntent(
      intentPath,
      {
        status: 'preflight_failed',
        preflight,
        error: preflight.error,
      },
      now,
    );
    return { status: updated.status, error: updated.error };
  }

  patchIntent(intentPath, { status: 'restarting', preflight }, now);

  try {
    await stopOldProcess({
      pid: intent.pid,
      killProcess,
      isProcessAlive,
      sleep,
    });

    const replacement = spawnService(intent.command, intent.args, {
      cwd: intent.cwd,
      detached: true,
      stdio: 'ignore',
      env: buildRestartEnv(intent.port),
    });
    replacement.unref?.();

    const healthError = await waitForHealth(intent.healthUrl, {
      fetchFn,
      sleep,
    });
    if (healthError) {
      const updated = patchIntent(
        intentPath,
        {
          status: 'failed',
          newPid: replacement.pid ?? null,
          error: healthError,
        },
        now,
      );
      return {
        status: updated.status,
        newPid: updated.newPid,
        error: updated.error,
      };
    }

    const updated = patchIntent(
      intentPath,
      {
        status: 'passed',
        newPid: replacement.pid ?? null,
        error: null,
      },
      now,
    );
    return { status: updated.status, newPid: updated.newPid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = patchIntent(
      intentPath,
      { status: 'failed', error: message },
      now,
    );
    return { status: updated.status, error: updated.error };
  }
}
