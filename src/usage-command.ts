import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
  if (error instanceof Error) {
    return error.message;
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

function parseResetTime(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    if (!Number.isNaN(Date.parse(value))) {
      return value;
    }
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return new Date(num * 1000).toISOString();
    }
    return value;
  }

  if (typeof value === 'number') {
    return new Date(value * 1000).toISOString();
  }

  return String(value);
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

  let latestTimestamp = 0;
  let latestPayload:
    | {
        primary: Record<string, unknown>;
        secondary: Record<string, unknown>;
        timestamp: number;
      }
    | null = null;

  for (const file of files.sort()) {
    const content = readFileSync(file, 'utf-8');
    for (const raw of content.split('\n')) {
      if (!raw.trim()) continue;
      try {
        const parsed = JSON.parse(raw);
        const payload = parsed?.payload;
        if (!payload || payload.type !== 'token_count') continue;
        const rateLimits = payload.rate_limits;
        if (!rateLimits?.primary || !rateLimits?.secondary) continue;
        const timestampRaw = parsed?.timestamp;
        let timestamp = Number.NaN;
        if (typeof timestampRaw === 'number') {
          timestamp = timestampRaw;
        } else if (typeof timestampRaw === 'string') {
          timestamp = Date.parse(timestampRaw);
        }
        if (Number.isNaN(timestamp)) continue;
        if (timestamp > latestTimestamp) {
          latestTimestamp = timestamp;
          latestPayload = {
            primary: rateLimits.primary,
            secondary: rateLimits.secondary,
            timestamp,
          };
        }
      } catch {
        continue;
      }
    }
  }

  if (!latestPayload) {
    return {
      provider: 'codex',
      available: false,
      source: 'local ~/.codex/sessions',
      reason: '未找到 Codex usage snapshot',
    };
  }

  const primaryUsed = Number(latestPayload.primary.used_percent ?? 0);
  const secondaryUsed = Number(latestPayload.secondary.used_percent ?? 0);
  return {
    provider: 'codex',
    available: true,
    source: 'local ~/.codex/sessions',
    primaryRemainingPct: Math.max(0, 100 - primaryUsed),
    secondaryRemainingPct: Math.max(0, 100 - secondaryUsed),
    primaryResetAt: parseResetTime(latestPayload.primary.resets_at),
    secondaryResetAt: parseResetTime(latestPayload.secondary.resets_at),
  };
}

function formatUsageSection(result: UsageProviderResult): string {
  if (!result.available) {
    return [
      result.provider === 'codex' ? 'Codex' : 'Claude',
      `- 5h 剩余: unavailable`,
      `- 7d 剩余: unavailable`,
      `- 原因: ${result.reason ?? 'unknown'}`,
      `- 数据源: ${result.source}`,
    ].join('\n');
  }

  const primaryPct = result.primaryRemainingPct ?? 0;
  const secondaryPct = result.secondaryRemainingPct ?? 0;
  const lines = [
    result.provider === 'codex' ? 'Codex' : 'Claude',
    `- 5h 剩余: ${primaryPct}%`,
    `- 7d 剩余: ${secondaryPct}%`,
  ];
  if (result.primaryResetAt) {
    lines.push(`- 5h 重置时间: ${result.primaryResetAt}`);
  }
  if (result.secondaryResetAt) {
    lines.push(`- 7d 重置时间: ${result.secondaryResetAt}`);
  }
  lines.push(`- 数据源: ${result.source}`);
  return lines.join('\n');
}

export async function executeUsageCommand(
  options: ExecuteUsageCommandOptions,
): Promise<string> {
  const codexHome =
    options.codexHome ?? join(process.env.HOME ?? '', '.codex');
  const codex = readLatestCodexUsage(codexHome);
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
