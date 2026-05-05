import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexCliConfig {
  model: string | null;
  reasoningEffort: string | null;
  speedTier: string | null;
}

export interface CodexRuntimeFallback {
  model: string | null;
  reasoningEffort: string | null;
  speedTier: string | null;
}

export interface CodexCliReadiness {
  status: 'ready' | 'missing' | 'not_logged_in' | 'error';
  command: string | null;
  pathValue: string;
  message: string | null;
}

const COMMON_HOST_RUNTIME_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function splitPathEntries(pathValue: string | null | undefined): string[] {
  const normalized = normalizeText(pathValue);
  if (!normalized) return [];
  return normalized
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupePathEntries(
  entries: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const normalized = normalizeText(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function isExecutableFile(
  targetPath: string,
  options: {
    existsSyncFn?: (target: string) => boolean;
    accessSyncFn?: (target: string, mode?: number) => void;
  } = {},
): boolean {
  const existsSyncFn = options.existsSyncFn || fs.existsSync;
  const accessSyncFn = options.accessSyncFn || fs.accessSync;
  if (!existsSyncFn(targetPath)) return false;
  try {
    accessSyncFn(targetPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function decodeExecOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

function resolveCodexCommandFromPath(options: {
  pathValue?: string | null;
  homeDir?: string | null;
  existsSyncFn?: (target: string) => boolean;
  accessSyncFn?: (target: string, mode?: number) => void;
}): string | null {
  const pathValue = buildHostRuntimePath({
    pathValue: options.pathValue,
    homeDir: options.homeDir,
  });
  for (const entry of splitPathEntries(pathValue)) {
    const candidate = path.join(entry, 'codex');
    if (
      isExecutableFile(candidate, {
        existsSyncFn: options.existsSyncFn,
        accessSyncFn: options.accessSyncFn,
      })
    ) {
      return candidate;
    }
  }
  return null;
}

export function buildHostRuntimePath(
  options: {
    pathValue?: string | null;
    homeDir?: string | null;
  } = {},
): string {
  const homeDir = normalizeText(options.homeDir) || os.homedir();
  return dedupePathEntries([
    ...splitPathEntries(options.pathValue ?? process.env.PATH),
    homeDir ? path.join(homeDir, '.bun', 'bin') : null,
    ...COMMON_HOST_RUNTIME_BIN_DIRS,
  ]).join(path.delimiter);
}

function readTomlString(content: string, key: string): string | null {
  const match = content.match(
    new RegExp(`^${key}\\s*=\\s*["']([^"']+)["']\\s*$`, 'm'),
  );
  return normalizeText(match?.[1]);
}

export function readCodexCliConfig(
  configPath = path.join(os.homedir(), '.codex', 'config.toml'),
): CodexCliConfig {
  try {
    if (!fs.existsSync(configPath)) {
      return { model: null, reasoningEffort: null, speedTier: null };
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return {
      model: readTomlString(content, 'model'),
      reasoningEffort:
        readTomlString(content, 'model_reasoning_effort') ??
        readTomlString(content, 'reasoning_effort'),
      speedTier: readTomlString(content, 'service_tier'),
    };
  } catch {
    return { model: null, reasoningEffort: null, speedTier: null };
  }
}

export function getCodexRuntimeFallback(
  options: {
    env?: NodeJS.ProcessEnv;
    configPath?: string;
  } = {},
): CodexRuntimeFallback {
  const env = options.env ?? process.env;
  const cliConfig = readCodexCliConfig(options.configPath);
  return {
    model:
      normalizeText(env.OPENAI_MODEL) ??
      normalizeText(env.CODEX_MODEL) ??
      cliConfig.model,
    reasoningEffort:
      normalizeText(env.OPENAI_REASONING_EFFORT) ??
      normalizeText(env.CODEX_REASONING_EFFORT) ??
      normalizeText(env.REASONING_EFFORT) ??
      cliConfig.reasoningEffort,
    speedTier:
      normalizeText(env.OPENAI_SERVICE_TIER) ??
      normalizeText(env.CODEX_SERVICE_TIER) ??
      normalizeText(env.SERVICE_TIER) ??
      cliConfig.speedTier,
  };
}

export function checkCodexCliReady(
  options: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    existsSyncFn?: (target: string) => boolean;
    accessSyncFn?: (target: string, mode?: number) => void;
    execFileSyncFn?: typeof execFileSync;
  } = {},
): CodexCliReadiness {
  const env = { ...process.env, ...options.env };
  const pathValue = buildHostRuntimePath({
    pathValue: env.PATH,
    homeDir: env.HOME,
  });
  env.PATH = pathValue;

  const command = resolveCodexCommandFromPath({
    pathValue,
    homeDir: env.HOME,
    existsSyncFn: options.existsSyncFn,
    accessSyncFn: options.accessSyncFn,
  });
  if (!command) {
    return {
      status: 'missing',
      command: null,
      pathValue,
      message:
        `Codex CLI 不在当前服务 PATH 中。当前 PATH=${pathValue}。` +
        '若服务由 launchd 启动，请把 /opt/homebrew/bin 或 /usr/local/bin 加入 LaunchAgent PATH 后重启。',
    };
  }

  const execFileSyncFn = options.execFileSyncFn || execFileSync;
  try {
    execFileSyncFn(command, ['login', 'status'], {
      env,
      timeout: options.timeoutMs ?? 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return {
      status: 'ready',
      command,
      pathValue,
      message: null,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number | null;
    };
    if (err.code === 'ENOENT') {
      return {
        status: 'missing',
        command: null,
        pathValue,
        message:
          `Codex CLI 不在当前服务 PATH 中。当前 PATH=${pathValue}。` +
          '若服务由 launchd 启动，请把 /opt/homebrew/bin 或 /usr/local/bin 加入 LaunchAgent PATH 后重启。',
      };
    }

    const normalized = [
      decodeExecOutput(err.stdout),
      decodeExecOutput(err.stderr),
      err.message || '',
    ]
      .join('\n')
      .trim();
    if (
      /auth_required/i.test(normalized) ||
      /please login/i.test(normalized) ||
      /not logged in/i.test(normalized) ||
      /codex login/i.test(normalized)
    ) {
      return {
        status: 'not_logged_in',
        command,
        pathValue,
        message: 'Codex CLI 未登录。请先在服务器上执行：codex login',
      };
    }

    return {
      status: 'error',
      command,
      pathValue,
      message: normalized
        ? `Codex CLI 启动检查失败：${normalized}`
        : 'Codex CLI 启动检查失败。',
    };
  }
}
