import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CODEX_BACKEND_BASE_URL = 'https://chatgpt.com/backend-api/codex';

const TOKEN_REFRESH_SKEW_SECONDS = 120;
const APP_SERVER_TIMEOUT_MS = 8000;

interface CodexAuthJson {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

export interface CodexCliRuntimeAuth {
  accessToken: string;
  accountId?: string;
  baseURL: string;
  source: 'codex-app-server' | 'codex-auth-json';
}

export interface ResolveCodexCliRuntimeAuthOptions {
  codexHome?: string;
  codexAuthPath?: string;
  useAppServer?: boolean;
  appServerRefreshSkewSeconds?: number;
}

class CodexAppServerClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly proc: ChildProcessWithoutNullStreams;
  private buffer = '';

  constructor() {
    this.proc = spawn(
      resolveCodexExecutable(),
      ['app-server', '--listen', 'stdio://'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: buildCodexProcessEnv(),
      },
    );

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.handleStdout(chunk));
    this.proc.stderr.on('data', () => {
      // Drain stderr so Codex app-server diagnostics cannot block the short-lived RPC.
    });
    this.proc.on('error', (err) => this.rejectAll(err));
    this.proc.on('close', (code, signal) => {
      if (this.pending.size === 0) return;
      this.rejectAll(
        new Error(
          `Codex app-server exited before responding (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        ),
      );
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'agent-fabric', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized');
  }

  async getAuthStatus(refreshToken: boolean): Promise<{
    authMethod?: string | null;
    authToken?: string | null;
    requiresOpenaiAuth?: boolean | null;
  }> {
    return (await this.request('getAuthStatus', {
      includeToken: true,
      refreshToken,
    })) as {
      authMethod?: string | null;
      authToken?: string | null;
      requiresOpenaiAuth?: boolean | null;
    };
  }

  close(): void {
    try {
      this.proc.stdin.end();
    } catch {
      /* ignore */
    }
    if (!this.proc.killed) {
      try {
        this.proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, APP_SERVER_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.proc.stdin.write(payload, (err) => {
        if (!err) return;
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private notify(method: string): void {
    this.proc.stdin.write(JSON.stringify({ method }) + '\n');
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const record =
        message && typeof message === 'object'
          ? (message as Record<string, unknown>)
          : {};
      const id = typeof record.id === 'number' ? record.id : null;
      if (id == null) continue;
      const pending = this.pending.get(id);
      if (!pending) continue;
      this.pending.delete(id);
      if (record.error) {
        pending.reject(new Error(JSON.stringify(record.error)));
      } else {
        pending.resolve(record.result);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }
}

function buildCodexProcessEnv(): NodeJS.ProcessEnv {
  const next = { ...process.env };
  const entries = (next.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const candidate of [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), '.local', 'bin'),
  ]) {
    if (!entries.includes(candidate)) entries.push(candidate);
  }
  next.PATH = entries.join(path.delimiter);
  return next;
}

function resolveCodexExecutable(): string {
  const pathEntries = (buildCodexProcessEnv().PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, 'codex');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep searching */
    }
  }
  return 'codex';
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function base64UrlDecode(value: string): string {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '=',
  );
  return Buffer.from(
    padded.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf8');
}

export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function isJwtExpiring(
  token: string | null | undefined,
  skewSeconds = TOKEN_REFRESH_SKEW_SECONDS,
): boolean {
  const claims = token ? decodeJwtClaims(token) : null;
  const exp = claims?.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return true;
  return exp * 1000 <= Date.now() + Math.max(0, skewSeconds) * 1000;
}

export function getChatGptAccountIdFromToken(
  accessToken: string,
): string | null {
  const claims = decodeJwtClaims(accessToken);
  const authClaim = claims?.['https://api.openai.com/auth'];
  if (!authClaim || typeof authClaim !== 'object') return null;
  return normalizeText(
    (authClaim as Record<string, unknown>).chatgpt_account_id,
  );
}

function resolveCodexAuthPath(
  options: ResolveCodexCliRuntimeAuthOptions,
): string {
  if (options.codexAuthPath) return options.codexAuthPath;
  const codexHome =
    options.codexHome ||
    normalizeText(process.env.CODEX_HOME) ||
    path.join(os.homedir(), '.codex');
  return path.join(codexHome, 'auth.json');
}

function readCodexAuthJson(
  authPath: string,
): { path: string; auth: CodexAuthJson } | null {
  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { path: authPath, auth: parsed as CodexAuthJson };
  } catch {
    return null;
  }
}

function runtimeAuthFromToken(
  accessToken: string,
  accountId: string | null | undefined,
  source: CodexCliRuntimeAuth['source'],
): CodexCliRuntimeAuth {
  return {
    accessToken,
    accountId:
      normalizeText(accountId) ??
      getChatGptAccountIdFromToken(accessToken) ??
      undefined,
    baseURL: CODEX_BACKEND_BASE_URL,
    source,
  };
}

async function resolveFromCodexAppServer(
  options: ResolveCodexCliRuntimeAuthOptions,
): Promise<CodexCliRuntimeAuth | null> {
  const client = new CodexAppServerClient();
  try {
    await client.initialize();
    const first = await client.getAuthStatus(false);
    const firstToken = normalizeText(first.authToken);
    const needsRefresh =
      !firstToken ||
      isJwtExpiring(
        firstToken,
        options.appServerRefreshSkewSeconds ?? TOKEN_REFRESH_SKEW_SECONDS,
      );
    const status = needsRefresh ? await client.getAuthStatus(true) : first;
    const accessToken = normalizeText(status.authToken);
    if (!accessToken || status.authMethod !== 'chatgpt') return null;
    return runtimeAuthFromToken(
      accessToken,
      getChatGptAccountIdFromToken(accessToken),
      'codex-app-server',
    );
  } finally {
    client.close();
  }
}

function resolveFromCodexAuthJson(
  options: ResolveCodexCliRuntimeAuthOptions,
): CodexCliRuntimeAuth | null {
  const authFile = readCodexAuthJson(resolveCodexAuthPath(options));
  const tokens = authFile?.auth.tokens;
  const accessToken = normalizeText(tokens?.access_token);
  if (!accessToken || isJwtExpiring(accessToken, TOKEN_REFRESH_SKEW_SECONDS)) {
    return null;
  }
  return runtimeAuthFromToken(
    accessToken,
    normalizeText(tokens?.account_id),
    'codex-auth-json',
  );
}

export async function resolveCodexCliRuntimeAuth(
  options: ResolveCodexCliRuntimeAuthOptions = {},
): Promise<CodexCliRuntimeAuth> {
  if (options.useAppServer !== false) {
    try {
      const fromAppServer = await resolveFromCodexAppServer(options);
      if (fromAppServer) return fromAppServer;
    } catch {
      // Fall back to direct auth.json read. The runner should still work when
      // Codex app-server is unavailable but the access token is currently valid.
    }
  }

  const fromAuthJson = resolveFromCodexAuthJson(options);
  if (fromAuthJson) return fromAuthJson;

  throw new Error(
    'Codex CLI login is required. Run `codex login`, then retry.',
  );
}

export async function resolveCodexCliRuntimeEnv(
  options: ResolveCodexCliRuntimeAuthOptions = {},
): Promise<Record<string, string>> {
  const auth = await resolveCodexCliRuntimeAuth(options);
  return {
    AGENT_FABRIC_OPENAI_AUTH_MODE: 'codex-cli',
    AGENT_FABRIC_CODEX_ACCESS_TOKEN: auth.accessToken,
    AGENT_FABRIC_CODEX_BASE_URL: auth.baseURL,
    AGENT_FABRIC_CODEX_AUTH_SOURCE: auth.source,
    ...(auth.accountId
      ? { AGENT_FABRIC_CODEX_ACCOUNT_ID: auth.accountId }
      : {}),
  };
}
