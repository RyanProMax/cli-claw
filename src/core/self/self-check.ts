import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { APP_ROOT } from '../app-root.js';
import type { StartupLaunchSpec } from './startup-launch.js';

export interface SelfCheckResult {
  status: 'passed' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  port: number;
  command: string;
  args: string[];
  cwd: string;
  tempHome: string;
  healthUrl: string;
  error: string | null;
  exitCode: number | null;
  signal: string | null;
  outputTail: string[];
}

interface CandidateProcess extends EventEmitter {
  stdout?: EventEmitter | null;
  stderr?: EventEmitter | null;
  kill(signal?: NodeJS.Signals): boolean;
}

interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ['ignore', 'pipe', 'pipe'];
}

export interface RunSelfCheckOptions {
  appRoot?: string;
  command?: string;
  args?: string[];
  launchSpec?: StartupLaunchSpec;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => Date;
  makeTempHome?: () => string;
  cleanupTempHome?: (dir: string) => void | Promise<void>;
  getFreePort?: () => Promise<number>;
  spawnFn?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => CandidateProcess;
  fetchFn?: (url: string) => Promise<{ ok: boolean; status: number }>;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INTERVAL_MS = 250;
const OUTPUT_TAIL_LIMIT = 20;
const ANSI_RE = /\u001b\[[0-9;]*m/g;

function defaultMakeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fabric-self-check-'));
}

function defaultCleanupTempHome(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function defaultGetFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  if (!address || typeof address === 'string') {
    throw new Error('failed to allocate a local port');
  }
  return address.port;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendOutputTail(lines: string[], chunk: unknown): void {
  const rawText = Buffer.isBuffer(chunk)
    ? chunk.toString('utf8')
    : String(chunk);
  const text = rawText.replace(ANSI_RE, '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    lines.push(trimmed);
  }
  if (lines.length > OUTPUT_TAIL_LIMIT) {
    lines.splice(0, lines.length - OUTPUT_TAIL_LIMIT);
  }
}

async function stopCandidate(
  proc: CandidateProcess,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  let exited = false;
  const exitPromise = new Promise<void>((resolve) => {
    proc.once('exit', () => {
      exited = true;
      resolve();
    });
  });

  proc.kill('SIGTERM');
  await Promise.race([exitPromise, sleep(2_000)]);
  if (!exited) {
    proc.kill('SIGKILL');
    await Promise.race([exitPromise, sleep(1_000)]);
  }
}

export async function runSelfCheck(
  options: RunSelfCheckOptions = {},
): Promise<SelfCheckResult> {
  const appRoot = options.appRoot || APP_ROOT;
  const command =
    options.command || options.launchSpec?.command || process.execPath;
  const args = options.args ||
    options.launchSpec?.args || [path.join(appRoot, 'dist', 'index.js')];
  const cwd = options.launchSpec?.cwd || appRoot;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now || (() => new Date());
  const sleep = options.sleep || defaultSleep;
  const fetchFn = options.fetchFn || fetch;
  const spawnFn = options.spawnFn || spawn;
  const started = now();
  const startedAt = started.toISOString();
  const startedMs = started.getTime();

  let port = 0;
  let healthUrl = '';
  let tempHome = '';
  let proc: CandidateProcess | null = null;
  let exitCode: number | null = null;
  let signal: string | null = null;
  let processErrorMessage: string | null = null;
  let lastProbeError: string | null = null;
  const outputTail: string[] = [];

  const finish = (
    status: 'passed' | 'failed',
    error: string | null,
  ): SelfCheckResult => {
    const finished = now();
    return {
      status,
      startedAt,
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - startedMs),
      port,
      command,
      args,
      cwd,
      tempHome,
      healthUrl,
      error,
      exitCode,
      signal,
      outputTail: [...outputTail],
    };
  };

  try {
    tempHome = (options.makeTempHome || defaultMakeTempHome)();
    port = await (options.getFreePort || defaultGetFreePort)();
    healthUrl = `http://127.0.0.1:${port}/api/health`;

    proc = spawnFn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: tempHome,
        WEB_PORT: String(port),
        AGENT_FABRIC_SELF_CHECK: '1',
        WEB_SESSION_SECRET:
          process.env.WEB_SESSION_SECRET || 'agent-fabric-self-check-secret',
      },
    });

    proc.stdout?.on('data', (chunk) => appendOutputTail(outputTail, chunk));
    proc.stderr?.on('data', (chunk) => appendOutputTail(outputTail, chunk));
    proc.once('exit', (code: number | null, sig: string | null) => {
      exitCode = code;
      signal = sig;
    });
    proc.once('error', (err: Error) => {
      processErrorMessage = err.message;
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (processErrorMessage) {
        return finish('failed', processErrorMessage);
      }
      if (exitCode !== null || signal !== null) {
        return finish('failed', 'candidate exited before health check passed');
      }

      try {
        const response = await fetchFn(healthUrl);
        if (response.ok) {
          await stopCandidate(proc, sleep);
          return finish('passed', null);
        }
        lastProbeError = `health returned HTTP ${response.status}`;
      } catch (err) {
        lastProbeError = err instanceof Error ? err.message : String(err);
      }

      await sleep(intervalMs);
    }

    return finish(
      'failed',
      lastProbeError
        ? `health check timed out after ${timeoutMs}ms: ${lastProbeError}`
        : `health check timed out after ${timeoutMs}ms`,
    );
  } catch (err) {
    return finish('failed', err instanceof Error ? err.message : String(err));
  } finally {
    if (proc && exitCode === null && signal === null) {
      await stopCandidate(proc, sleep).catch(() => undefined);
    }
    if (tempHome) {
      await Promise.resolve(
        (options.cleanupTempHome || defaultCleanupTempHome)(tempHome),
      ).catch(() => undefined);
    }
  }
}
