# Usage Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an IM-only `/usage` command that returns both Codex and Claude 5-hour and weekly quota snapshots without routing through the agent.

**Architecture:** Keep `/usage` in the local IM command layer and delegate quota gathering to a dedicated usage module. Codex usage comes from the newest local `~/.codex/sessions/**/*.jsonl` `token_count.rate_limits` snapshot, while Claude usage reuses the existing OAuth usage fetch path through a shared helper extracted from the config route.

**Tech Stack:** TypeScript, Node `fs`/`path`, existing `runtime-config` provider state, Vitest, shared slash-command registry, backend build via `tsc`.

**Status:** Completed. Final validation passed with `npm test -- tests/usage-command.test.ts tests/runtime-command-registry.test.ts tests/im-slash-command.test.ts`, `npm run build:backend`, and `./scripts/review.sh`.

---

### Task 1: Build the local usage service with Codex parsing and stable reply formatting

**Files:**
- Create: `src/usage-command.ts`
- Test: `tests/usage-command.test.ts`

- [x] **Step 1: Write the failing tests for Codex snapshot parsing and partial-failure reply formatting**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { executeUsageCommand } from '../src/usage-command.ts';

function writeCodexSession(root: string, rel: string, lines: unknown[]) {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, lines.map((line) => JSON.stringify(line)).join('\n'));
}

describe('usage command', () => {
  test('uses the newest codex token_count rate-limit snapshot and keeps Claude unavailable non-fatal', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeCodexSession(codexHome, 'sessions/2026/04/10/older.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 61, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 54, window_minutes: 10080, resets_at: 1776390000 },
          },
        },
      },
    ]);
    writeCodexSession(codexHome, 'sessions/2026/04/10/newer.jsonl', [
      {
        timestamp: '2026-04-10T09:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 27, window_minutes: 300, resets_at: 1775793600 },
            secondary: { used_percent: 39, window_minutes: 10080, resets_at: 1776393600 },
          },
        },
      },
    ]);

    const reply = await executeUsageCommand({
      codexHome,
      getClaudeUsage: vi.fn().mockResolvedValue({
        provider: 'claude',
        available: false,
        reason: '未启用 Claude OAuth provider',
        source: 'Claude OAuth API',
      }),
    });

    expect(reply).toContain('📈 用量查询');
    expect(reply).toContain('Codex');
    expect(reply).toContain('5h 剩余: 73%');
    expect(reply).toContain('7d 剩余: 61%');
    expect(reply).toContain('数据源: local ~/.codex/sessions');
    expect(reply).toContain('Claude');
    expect(reply).toContain('原因: 未启用 Claude OAuth provider');
  });

  test('returns codex unavailable when no usable token_count snapshot exists', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-empty-'));

    const reply = await executeUsageCommand({
      codexHome,
      getClaudeUsage: vi.fn().mockResolvedValue({
        provider: 'claude',
        available: false,
        reason: '未启用 Claude OAuth provider',
        source: 'Claude OAuth API',
      }),
    });

    expect(reply).toContain('Codex');
    expect(reply).toContain('5h 剩余: unavailable');
    expect(reply).toContain('原因: 未找到 Codex usage snapshot');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail for the right reason**

Run: `npm test -- tests/usage-command.test.ts`
Expected: FAIL because `../src/usage-command.ts` does not exist yet.

- [x] **Step 3: Write the minimal usage service**

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface UsageProviderResult {
  provider: 'codex' | 'claude';
  available: boolean;
  source: string;
  primaryRemainingPct?: number;
  secondaryRemainingPct?: number;
  primaryResetAt?: string | null;
  secondaryResetAt?: string | null;
  reason?: string;
}

interface ExecuteUsageCommandOptions {
  codexHome?: string;
  getClaudeUsage: () => Promise<UsageProviderResult>;
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
    if (full.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function readLatestCodexUsage(codexHome: string): UsageProviderResult {
  const sessionRoot = join(codexHome, 'sessions');
  const files = collectJsonlFiles(sessionRoot).sort().reverse();
  let latest: { timestamp: string; primary: any; secondary: any } | null = null;

  for (const file of files) {
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as any;
        const payload = parsed?.payload;
        if (payload?.type !== 'token_count' || !payload?.rate_limits) continue;
        const candidate = {
          timestamp: parsed.timestamp ?? '',
          primary: payload.rate_limits.primary ?? null,
          secondary: payload.rate_limits.secondary ?? null,
        };
        if (!latest || candidate.timestamp > latest.timestamp) {
          latest = candidate;
        }
      } catch {
        continue;
      }
    }
  }

  if (!latest?.primary || !latest?.secondary) {
    return {
      provider: 'codex',
      available: false,
      reason: '未找到 Codex usage snapshot',
      source: 'local ~/.codex/sessions',
    };
  }

  return {
    provider: 'codex',
    available: true,
    source: 'local ~/.codex/sessions',
    primaryRemainingPct: Math.max(0, 100 - Number(latest.primary.used_percent ?? 0)),
    secondaryRemainingPct: Math.max(0, 100 - Number(latest.secondary.used_percent ?? 0)),
    primaryResetAt: new Date(Number(latest.primary.resets_at) * 1000).toISOString(),
    secondaryResetAt: new Date(Number(latest.secondary.resets_at) * 1000).toISOString(),
  };
}

function formatUsageSection(result: UsageProviderResult): string {
  if (!result.available) {
    return [
      result.provider === 'codex' ? 'Codex' : 'Claude',
      '- 5h 剩余: unavailable',
      '- 7d 剩余: unavailable',
      `- 原因: ${result.reason ?? 'unknown'}`,
      `- 数据源: ${result.source}`,
    ].join('\n');
  }

  return [
    result.provider === 'codex' ? 'Codex' : 'Claude',
    `- 5h 剩余: ${result.primaryRemainingPct}%`,
    `- 7d 剩余: ${result.secondaryRemainingPct}%`,
    `- 重置时间: ${result.primaryResetAt}`,
    `- 数据源: ${result.source}`,
  ].join('\n');
}

export async function executeUsageCommand(
  options: ExecuteUsageCommandOptions,
): Promise<string> {
  const codex = readLatestCodexUsage(options.codexHome ?? join(process.env.HOME ?? '', '.codex'));
  const claude = await options.getClaudeUsage();
  return ['📈 用量查询', '━━━━━━━━━━', formatUsageSection(codex), '', formatUsageSection(claude)].join('\n');
}
```

- [x] **Step 4: Run the tests to verify the new service passes**

Run: `npm test -- tests/usage-command.test.ts`
Expected: PASS with 2 passing tests.

- [x] **Step 5: Commit the usage service baseline**

```bash
git add src/usage-command.ts tests/usage-command.test.ts
git commit -m "feat: add usage command service"
```

### Task 2: Extract shared Claude OAuth usage access and plug it into the usage service

**Files:**
- Create: `src/claude-oauth-usage.ts`
- Modify: `src/routes/config.ts`
- Modify: `src/usage-command.ts`
- Test: `tests/usage-command.test.ts`

- [x] **Step 1: Extend the failing tests to cover Claude OAuth success and no-provider fallback**

```ts
import { getClaudeUsageSnapshot } from '../src/claude-oauth-usage.ts';

test('maps enabled Claude OAuth usage into the shared reply shape', async () => {
  const snapshot = await getClaudeUsageSnapshot({
    getEnabledProviders: () => [
      {
        id: 'provider-1',
        name: 'Official',
        type: 'official',
        enabled: true,
        weight: 1,
        anthropicBaseUrl: '',
        anthropicAuthToken: '',
        anthropicModel: 'sonnet',
        anthropicApiKey: '',
        claudeCodeOauthToken: '',
        claudeOAuthCredentials: {
          accessToken: 'token',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 60_000,
          scopes: [],
        },
        customEnv: {},
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
    ],
    fetchOAuthUsage: vi.fn().mockResolvedValue({
      data: {
        five_hour: { utilization: 62, resets_at: '2026-04-10T12:00:00.000Z' },
        seven_day: { utilization: 41, resets_at: '2026-04-14T00:00:00.000Z' },
        seven_day_opus: null,
        seven_day_sonnet: null,
      },
      fetchedAt: Date.now(),
    }),
  });

  expect(snapshot).toEqual({
    provider: 'claude',
    available: true,
    source: 'Claude OAuth API',
    primaryRemainingPct: 38,
    secondaryRemainingPct: 59,
    primaryResetAt: '2026-04-10T12:00:00.000Z',
    secondaryResetAt: '2026-04-14T00:00:00.000Z',
  });
});

test('returns unavailable when no enabled Claude OAuth provider exists', async () => {
  const snapshot = await getClaudeUsageSnapshot({
    getEnabledProviders: () => [],
    fetchOAuthUsage: vi.fn(),
  });

  expect(snapshot).toEqual({
    provider: 'claude',
    available: false,
    reason: '未启用 Claude OAuth provider',
    source: 'Claude OAuth API',
  });
});
```

- [x] **Step 2: Run the tests to verify they fail before extraction**

Run: `npm test -- tests/usage-command.test.ts`
Expected: FAIL because `../src/claude-oauth-usage.ts` does not exist yet.

- [x] **Step 3: Extract the shared Claude OAuth usage helper and wire the usage service to it**

```ts
// src/claude-oauth-usage.ts
import { getEnabledProviders } from './runtime-config.js';
import type { CachedOAuthUsage, UnifiedProvider } from './runtime-config.js';

interface ClaudeUsageDeps {
  getEnabledProviders?: () => UnifiedProvider[];
  fetchOAuthUsage: (providerId: string) => Promise<CachedOAuthUsage>;
}

export async function getClaudeUsageSnapshot(
  deps: ClaudeUsageDeps,
): Promise<{
  provider: 'claude';
  available: boolean;
  source: 'Claude OAuth API';
  primaryRemainingPct?: number;
  secondaryRemainingPct?: number;
  primaryResetAt?: string;
  secondaryResetAt?: string;
  reason?: string;
}> {
  const providers = (deps.getEnabledProviders ?? getEnabledProviders)();
  const provider = providers.find((item) => item.claudeOAuthCredentials);
  if (!provider) {
    return {
      provider: 'claude',
      available: false,
      reason: '未启用 Claude OAuth provider',
      source: 'Claude OAuth API',
    };
  }

  try {
    const usage = await deps.fetchOAuthUsage(provider.id);
    const fiveHour = usage.data.five_hour;
    const sevenDay = usage.data.seven_day;
    if (!fiveHour || !sevenDay) {
      return {
        provider: 'claude',
        available: false,
        reason: 'Claude OAuth usage bucket 缺失',
        source: 'Claude OAuth API',
      };
    }
    return {
      provider: 'claude',
      available: true,
      source: 'Claude OAuth API',
      primaryRemainingPct: Math.max(0, 100 - fiveHour.utilization),
      secondaryRemainingPct: Math.max(0, 100 - sevenDay.utilization),
      primaryResetAt: fiveHour.resets_at,
      secondaryResetAt: sevenDay.resets_at,
    };
  } catch (error) {
    return {
      provider: 'claude',
      available: false,
      reason: error instanceof Error ? error.message : 'Claude OAuth usage fetch failed',
      source: 'Claude OAuth API',
    };
  }
}
```

```ts
// src/routes/config.ts
export async function fetchOAuthUsage(providerId: string): Promise<CachedOAuthUsage> {
  // move the existing implementation here unchanged, only changing export visibility
}
```

```ts
// src/usage-command.ts
import { getClaudeUsageSnapshot } from './claude-oauth-usage.js';
import { fetchOAuthUsage } from './routes/config.js';

const claude = await getClaudeUsageSnapshot({ fetchOAuthUsage });
```

- [x] **Step 4: Run the tests again to verify Claude normalization passes**

Run: `npm test -- tests/usage-command.test.ts`
Expected: PASS with the new Claude coverage included.

- [x] **Step 5: Commit the shared Claude OAuth extraction**

```bash
git add src/claude-oauth-usage.ts src/routes/config.ts src/usage-command.ts tests/usage-command.test.ts
git commit -m "refactor: share claude oauth usage access"
```

### Task 3: Register `/usage`, wire IM local dispatch, and document the command

**Files:**
- Modify: `shared/runtime-command-registry.ts`
- Modify: `src/index.ts`
- Modify: `docs/COMMAND.md`
- Modify: `tests/runtime-command-registry.test.ts`
- Modify: `tests/usage-command.test.ts`

- [x] **Step 1: Add failing tests for IM help visibility and direct local command dispatch**

```ts
// tests/runtime-command-registry.test.ts
test('shows /usage in IM help and hides it from Web help', () => {
  const imHelp = formatCommandHelp({ entrypoint: 'im', agentType: 'codex' });
  const webHelp = formatCommandHelp({ entrypoint: 'web', agentType: 'codex' });

  expect(imHelp).toContain('/usage');
  expect(webHelp).not.toContain('/usage');
});
```

```ts
// tests/usage-command.test.ts
test('returns a local usage reply without going through the runtime workspace handler', async () => {
  const reply = await executeUsageCommand({
    codexHome,
    getClaudeUsage: vi.fn().mockResolvedValue({
      provider: 'claude',
      available: false,
      reason: '未启用 Claude OAuth provider',
      source: 'Claude OAuth API',
    }),
  });

  expect(reply).toContain('📈 用量查询');
});
```

- [x] **Step 2: Run the tests to verify `/usage` is still missing from help**

Run: `npm test -- tests/runtime-command-registry.test.ts tests/usage-command.test.ts`
Expected: FAIL because `/usage` is not yet part of the IM command registry.

- [x] **Step 3: Wire the registry, IM command switch, and docs**

```ts
// shared/runtime-command-registry.ts
{
  name: 'usage',
  usage: '/usage',
  description: '查看 Codex 和 Claude 的 5h / 7d 用量余额',
  availableEntrypoints: ['im'],
  availabilityByRuntime: 'all',
},
```

```ts
// src/index.ts
import { executeUsageCommand } from './usage-command.js';

case 'usage':
  return executeUsageCommand({
    getClaudeUsage: () => getClaudeUsageSnapshot({ fetchOAuthUsage }),
  });
```

```md
| `/usage` | - | 查看 Codex 与 Claude 的 5h / 7d 用量余额 |
```

- [x] **Step 4: Run the focused test set and then the milestone validations**

Run: `npm test -- tests/usage-command.test.ts tests/runtime-command-registry.test.ts tests/im-slash-command.test.ts`
Expected: PASS

Run: `npm run build:backend`
Expected: PASS

Run: `./scripts/review.sh`
Expected: PASS with only the standard “Semantic review is still required” reminder.

- [x] **Step 5: Commit the command wiring and docs**

```bash
git add shared/runtime-command-registry.ts src/index.ts docs/COMMAND.md tests/runtime-command-registry.test.ts tests/usage-command.test.ts
git commit -m "feat: add usage slash command"
```
