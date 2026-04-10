import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface UsageProviderResult {
  provider: 'codex' | 'claude';
  available: boolean;
  source: string;
  primaryRemainingPct?: number;
  secondaryRemainingPct?: number;
  primaryResetAt?: string;
  secondaryResetAt?: string;
  reason?: string;
}

interface ExecuteUsageCommandOptions {
  codexHome?: string;
  getClaudeUsage: () => Promise<UsageProviderResult>;
}

const UNKNOWN_ERROR_MESSAGE = 'unknown error';
const RESET_PLACEHOLDER = 'unknown';
const HOME_OVERRIDE_ENV = 'CLI_CLAW_HOME_OVERRIDE';

function messageFromObject(error: object): string | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
    if (descriptor && 'value' in descriptor) {
      const value = descriptor.value;
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
      return maybeMessage;
    }
  } catch {
    // getter threw; fall back to generic reason
  }
  return undefined;
}

function stringifyErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error !== null) {
    const message = messageFromObject(error);
    if (message) {
      return message;
    }
    return UNKNOWN_ERROR_MESSAGE;
  }
  if (error === undefined || error === null) {
    return UNKNOWN_ERROR_MESSAGE;
  }
  try {
    const coerced = String(error);
    if (coerced.length > 0) {
      return coerced;
    }
  } catch {
    // fall through to fallback
  }
  return UNKNOWN_ERROR_MESSAGE;
}

function collectJsonlFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectJsonlFiles(full));
      continue;
    }
    if (full.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

function parseUsagePercent(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeTimestampValue(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value * 1000 : undefined;
  }
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      return undefined;
    }
    const parsedIso = Date.parse(value);
    if (!Number.isNaN(parsedIso)) {
      return parsedIso;
    }
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return asNumber * 1000;
    }
    return undefined;
  }
  return undefined;
}

function formatLocalTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (num: number) => String(num).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatResetTime(value: unknown): string | undefined {
  const timestampMs = normalizeTimestampValue(value);
  if (timestampMs === undefined) {
    return undefined;
  }
  return formatLocalTimestamp(timestampMs);
}

function parseSnapshotTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      return undefined;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function readLatestCodexUsage(codexHome: string): UsageProviderResult {
  const sessionRoot = join(codexHome, 'sessions');
  const files = collectJsonlFiles(sessionRoot);
  if (files.length === 0) {
    return {
      provider: 'codex',
      available: false,
      source: 'local ~/.codex/sessions',
      reason: '未找到 Codex usage snapshot',
    };
  }

  const filesWithTime = files
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  let best:
    | (UsageProviderResult & {
        snapshotTimestampMs: number;
      })
    | undefined;

  for (const { file } of filesWithTime) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const raw = lines[i];
      if (!raw.trim()) continue;
      try {
        const parsed = JSON.parse(raw);
        const payload = parsed?.payload;
        if (!payload || payload.type !== 'token_count') continue;
        const rateLimits = payload.rate_limits;
        if (!rateLimits?.primary || !rateLimits?.secondary) continue;
        const primaryUsedPercent = parseUsagePercent(
          rateLimits.primary.used_percent,
        );
        const secondaryUsedPercent = parseUsagePercent(
          rateLimits.secondary.used_percent,
        );
        if (
          primaryUsedPercent === undefined ||
          secondaryUsedPercent === undefined
        ) {
          continue;
        }
        const snapshotTimestampMs = parseSnapshotTimestampMs(parsed?.timestamp);
        if (snapshotTimestampMs === undefined) continue;

        const candidate: UsageProviderResult & { snapshotTimestampMs: number } =
          {
            provider: 'codex',
            available: true,
            source: 'local ~/.codex/sessions',
            snapshotTimestampMs,
            primaryRemainingPct: Math.max(0, 100 - primaryUsedPercent),
            secondaryRemainingPct: Math.max(0, 100 - secondaryUsedPercent),
            primaryResetAt: formatResetTime(rateLimits.primary.resets_at),
            secondaryResetAt: formatResetTime(rateLimits.secondary.resets_at),
          };

        if (
          best === undefined ||
          candidate.snapshotTimestampMs > best.snapshotTimestampMs
        ) {
          best = candidate;
        }

        // Latest usable snapshot within this file is found; no need to scan earlier lines.
        break;
      } catch {
        continue;
      }
    }
  }

  if (best) {
    // Strip internal scan metadata.
    const { snapshotTimestampMs: _snapshotTimestampMs, ...rest } = best;
    return rest;
  }

  return {
    provider: 'codex',
    available: false,
    source: 'local ~/.codex/sessions',
    reason: '未找到 Codex usage snapshot',
  };
}

function getHomeDirectory(): string | undefined {
  const override = process.env[HOME_OVERRIDE_ENV];
  if (override !== undefined) {
    return override;
  }
  return homedir();
}

function resolveCodexHome(options: ExecuteUsageCommandOptions): string | undefined {
  if (options.codexHome) {
    return options.codexHome;
  }
  const homeDir = getHomeDirectory();
  if (!homeDir) {
    return undefined;
  }
  return join(homeDir, '.codex');
}

function formatUsageSection(result: UsageProviderResult): string {
  if (!result.available) {
    return [
      result.provider === 'codex' ? 'Codex' : 'Claude',
      `- 5h 剩余: unavailable`,
      `- 7d 剩余: unavailable`,
      `- 5h 重置时间: ${RESET_PLACEHOLDER}`,
      `- 7d 重置时间: ${RESET_PLACEHOLDER}`,
      `- 原因: ${result.reason ?? 'unknown'}`,
      `- 数据源: ${result.source}`,
    ].join('\n');
  }

  const formatRemaining = (value: number | undefined): string =>
    value === undefined ? 'unknown' : `${value}%`;
  const primaryPct = formatRemaining(result.primaryRemainingPct);
  const secondaryPct = formatRemaining(result.secondaryRemainingPct);
  const lines = [
    result.provider === 'codex' ? 'Codex' : 'Claude',
    `- 5h 剩余: ${primaryPct}`,
    `- 7d 剩余: ${secondaryPct}`,
    `- 5h 重置时间: ${result.primaryResetAt ?? RESET_PLACEHOLDER}`,
    `- 7d 重置时间: ${result.secondaryResetAt ?? RESET_PLACEHOLDER}`,
    `- 数据源: ${result.source}`,
  ];
  return lines.join('\n');
}

export async function executeUsageCommand(
  options: ExecuteUsageCommandOptions,
): Promise<string> {
  const codexHome = resolveCodexHome(options);
  let codex: UsageProviderResult;
  if (!codexHome) {
    codex = {
      provider: 'codex',
      available: false,
      source: 'Codex home resolution',
      reason: '无法解析 Codex home 目录',
    };
  } else {
    codex = readLatestCodexUsage(codexHome);
  }
  let claude: UsageProviderResult;
  try {
    claude = await options.getClaudeUsage();
  } catch (error) {
    claude = {
      provider: 'claude',
      available: false,
      source: 'Claude OAuth API',
      reason: `Claude usage fetch failed: ${stringifyErrorMessage(error)}`,
    };
  }
  return [
    '📈 用量查询',
    '━━━━━━━━━━',
    formatUsageSection(codex),
    '',
    formatUsageSection(claude),
  ].join('\n');
}
