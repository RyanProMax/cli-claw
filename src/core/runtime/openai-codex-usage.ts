import http from 'node:http';
import https from 'node:https';

import { ProxyAgent } from 'proxy-agent';

import {
  CODEX_BACKEND_BASE_URL,
  resolveCodexCliRuntimeAuth,
  type CodexCliRuntimeAuth,
} from './codex-cli-auth.js';
import type { UsageProviderResult } from './usage.js';

const CODEX_USAGE_CACHE_TTL_MS = 3 * 60 * 1000;
const CODEX_USAGE_STALE_FALLBACK_TTL_MS = 90 * 60 * 1000;
const CODEX_USAGE_SOURCE = 'Codex usage API';

interface CodexUsageFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type CodexUsageFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<CodexUsageFetchResponse>;

export interface OpenAiCodexUsageDeps {
  resolveAuth?: () => Promise<CodexCliRuntimeAuth>;
  fetchUsage?: CodexUsageFetch;
  now?: () => number;
}

interface CachedOpenAiCodexUsage {
  fetchedAt: number;
  result: UsageProviderResult;
}

const usageCache = new Map<string, CachedOpenAiCodexUsage>();
const inFlightUsageRequests = new Map<string, Promise<UsageProviderResult>>();

function unavailable(reason: string): UsageProviderResult {
  return {
    provider: 'openai',
    available: false,
    source: CODEX_USAGE_SOURCE,
    reason,
  };
}

function stringifyError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Codex usage fetch failed';
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampUsagePct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function remainingPct(usedPct: number): number {
  return Math.max(0, 100 - usedPct);
}

function resetAt(value: unknown): unknown {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date.toISOString() : value;
  }
  return value;
}

function envValue(env: NodeJS.ProcessEnv, ...names: string[]): string | null {
  for (const name of names) {
    const value = typeof env[name] === 'string' ? env[name]!.trim() : '';
    if (value) return value;
  }
  return null;
}

function parseNoProxyEntry(
  value: string,
): { hostname: string; port: number | null } | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === '*') return { hostname: '*', port: null };
  const match = trimmed.match(/^(.+):(\d+)$/);
  return {
    hostname: match ? match[1]! : trimmed,
    port: match ? Number.parseInt(match[2]!, 10) : null,
  };
}

function noProxyMatches(
  hostname: string,
  port: number,
  entry: string,
): boolean {
  const parsed = parseNoProxyEntry(entry);
  if (!parsed) return false;
  if (parsed.hostname === '*') return true;
  if (parsed.port !== null && parsed.port !== port) return false;

  const rule = parsed.hostname.replace(/^\[|\]$/g, '');
  if (rule.startsWith('*')) return hostname.endsWith(rule.slice(1));
  if (rule.startsWith('.')) {
    return hostname === rule.slice(1) || hostname.endsWith(rule);
  }
  return hostname === rule || hostname.endsWith(`.${rule}`);
}

function shouldBypassProxy(targetUrl: URL, env: NodeJS.ProcessEnv): boolean {
  const noProxy = envValue(env, 'NO_PROXY', 'no_proxy');
  if (!noProxy) return false;
  const hostname = targetUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port =
    Number.parseInt(targetUrl.port, 10) ||
    (targetUrl.protocol === 'https:' ? 443 : 80);
  return noProxy
    .split(/[,\s]+/)
    .some((entry) => noProxyMatches(hostname, port, entry));
}

export function resolveOpenAiCodexProxyUrl(
  targetUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return null;
  }
  if (shouldBypassProxy(parsedUrl, env)) return null;
  if (parsedUrl.protocol === 'https:') {
    return envValue(
      env,
      'HTTPS_PROXY',
      'https_proxy',
      'ALL_PROXY',
      'all_proxy',
    );
  }
  if (parsedUrl.protocol === 'http:') {
    return envValue(env, 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy');
  }
  return null;
}

export function resolveOpenAiCodexUsageUrl(baseURL?: string | null): string {
  let normalized = (baseURL || CODEX_BACKEND_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  if (!normalized) normalized = CODEX_BACKEND_BASE_URL;
  if (normalized.endsWith('/codex')) {
    normalized = normalized.slice(0, -'/codex'.length);
  }
  if (normalized.includes('/backend-api')) {
    return `${normalized}/wham/usage`;
  }
  return `${normalized}/api/codex/usage`;
}

async function defaultFetchUsage(
  url: string,
  init: { headers: Record<string, string> },
): Promise<CodexUsageFetchResponse> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const proxyUrl = resolveOpenAiCodexProxyUrl(url);
    const agent = proxyUrl
      ? new ProxyAgent({ getProxyForUrl: () => proxyUrl })
      : undefined;
    const request = (parsedUrl.protocol === 'http:' ? http : https).request(
      parsedUrl,
      {
        method: 'GET',
        headers: init.headers,
        agent,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok:
              typeof response.statusCode === 'number' &&
              response.statusCode >= 200 &&
              response.statusCode < 300,
            status: response.statusCode ?? 0,
            json: async () => (body ? JSON.parse(body) : {}),
          });
        });
      },
    );

    request.setTimeout(15_000, () => {
      request.destroy(new Error('Codex usage API request timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

function parseUsagePayload(payload: unknown): UsageProviderResult {
  const root = recordFromUnknown(payload);
  const rateLimit = recordFromUnknown(root?.rate_limit);
  const primaryWindow = recordFromUnknown(rateLimit?.primary_window);
  const secondaryWindow = recordFromUnknown(rateLimit?.secondary_window);
  const primaryUsed = finiteNumber(primaryWindow?.used_percent);
  const secondaryUsed = finiteNumber(secondaryWindow?.used_percent);

  if (primaryUsed === null && secondaryUsed === null) {
    return unavailable('Codex usage bucket 缺失');
  }

  const result: UsageProviderResult = {
    provider: 'openai',
    available: true,
    source: CODEX_USAGE_SOURCE,
  };

  if (primaryUsed !== null) {
    const used = clampUsagePct(primaryUsed);
    result.primaryUsagePct = used;
    result.primaryRemainingPct = remainingPct(used);
    result.primaryResetAt = resetAt(primaryWindow?.reset_at);
  }
  if (secondaryUsed !== null) {
    const used = clampUsagePct(secondaryUsed);
    result.secondaryUsagePct = used;
    result.secondaryRemainingPct = remainingPct(used);
    result.secondaryResetAt = resetAt(secondaryWindow?.reset_at);
  }

  return result;
}

function cacheKey(auth: CodexCliRuntimeAuth): string {
  return `${auth.baseURL}|${auth.accountId ?? ''}`;
}

function staleCachedUsage(
  cached: CachedOpenAiCodexUsage | undefined,
  nowMs: number,
  reason: string,
): UsageProviderResult | null {
  if (!cached?.result.available) return null;
  if (nowMs - cached.fetchedAt > CODEX_USAGE_STALE_FALLBACK_TTL_MS) {
    return null;
  }
  return {
    ...cached.result,
    source: `${cached.result.source} stale cache`,
    reason: `Using stale successful usage snapshot because latest fetch failed: ${reason}`,
  };
}

export function clearOpenAiCodexUsageCacheForTests(): void {
  usageCache.clear();
  inFlightUsageRequests.clear();
}

export async function getOpenAiCodexUsageSnapshot(
  deps: OpenAiCodexUsageDeps = {},
): Promise<UsageProviderResult> {
  const now = deps.now ?? Date.now;
  let auth: CodexCliRuntimeAuth;
  try {
    auth = await (deps.resolveAuth ?? resolveCodexCliRuntimeAuth)();
  } catch (error) {
    return unavailable(stringifyError(error));
  }

  const key = cacheKey(auth);
  const cached = usageCache.get(key);
  if (cached && now() - cached.fetchedAt < CODEX_USAGE_CACHE_TTL_MS) {
    return cached.result;
  }

  const inFlight = inFlightUsageRequests.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
        'User-Agent': 'codex_cli_rs/0.0.0 (Agent Fabric)',
        originator: 'codex_cli_rs',
        ...(auth.accountId ? { 'ChatGPT-Account-ID': auth.accountId } : {}),
      };
      const response = await (deps.fetchUsage ?? defaultFetchUsage)(
        resolveOpenAiCodexUsageUrl(auth.baseURL),
        { headers },
      );
      if (!response.ok) {
        const stale =
          response.status >= 500
            ? staleCachedUsage(
                usageCache.get(key),
                now(),
                `Codex usage API returned ${response.status}`,
              )
            : null;
        if (stale) return stale;
        return unavailable(`Codex usage API returned ${response.status}`);
      }

      const parsed = parseUsagePayload(await response.json());
      if (parsed.available) {
        usageCache.set(key, {
          fetchedAt: now(),
          result: parsed,
        });
      }
      return parsed;
    } catch (error) {
      const reason = stringifyError(error);
      return (
        staleCachedUsage(usageCache.get(key), now(), reason) ??
        unavailable(reason)
      );
    } finally {
      inFlightUsageRequests.delete(key);
    }
  })();

  inFlightUsageRequests.set(key, request);
  return request;
}
