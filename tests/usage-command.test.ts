import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { executeUsageCommand } from '../src/usage-command.ts';

function writeCodexSession(root: string, rel: string, lines: unknown[]) {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, lines.map((line) => JSON.stringify(line)).join('\n'));
}

function expectUnavailableResetLines(reply: string) {
  expect(reply).toContain('- 5h 重置时间: unknown');
  expect(reply).toContain('- 7d 重置时间: unknown');
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
    expect(reply).toContain('- 5h 重置时间:');
    expect(reply).toContain('- 7d 重置时间:');
    expect(reply).toContain('数据源: local ~/.codex/sessions');
    expect(reply).toContain('Claude');
    expect(reply).toContain('原因: 未启用 Claude OAuth provider');
    expectUnavailableResetLines(reply);
  });

  test('selects newest snapshot by timestamp even when a newer-touched file contains older data', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-mtime-vs-ts-'));

    const newerMtimeOlderSnapshot = 'sessions/2026/04/10/newer-mtime.jsonl';
    const olderMtimeNewerSnapshot = 'sessions/2026/04/10/older-mtime.jsonl';

    writeCodexSession(codexHome, newerMtimeOlderSnapshot, [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 90, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 80, window_minutes: 10080, resets_at: 1776390000 },
          },
        },
      },
    ]);
    writeCodexSession(codexHome, olderMtimeNewerSnapshot, [
      {
        timestamp: '2026-04-10T09:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 45, window_minutes: 300, resets_at: 1775793600 },
            secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1776393600 },
          },
        },
      },
    ]);

    const nowish = new Date('2026-04-10T12:00:00.000Z');
    const earlier = new Date('2026-04-10T11:00:00.000Z');
    utimesSync(join(codexHome, newerMtimeOlderSnapshot), nowish, nowish);
    utimesSync(join(codexHome, olderMtimeNewerSnapshot), earlier, earlier);

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
    expect(reply).toContain('5h 剩余: 55%');
    expect(reply).toContain('7d 剩余: 88%');
  });

  test('selects newest snapshot by timestamp within the same file', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-same-file-ts-'));

    writeCodexSession(codexHome, 'sessions/2026/04/10/mixed.jsonl', [
      {
        timestamp: '2026-04-10T09:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 45, window_minutes: 300, resets_at: 1775793600 },
            secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1776393600 },
          },
        },
      },
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 90, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 80, window_minutes: 10080, resets_at: 1776390000 },
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

    expect(reply).toContain('Codex');
    expect(reply).toContain('5h 剩余: 55%');
    expect(reply).toContain('7d 剩余: 88%');
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
    expectUnavailableResetLines(reply);
  });

  test('returns codex unavailable when sessions path is not a directory', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-sessions-file-'));
    writeFileSync(join(codexHome, 'sessions'), 'not a directory');

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
    expect(reply).toContain('Claude');
  });

  test('reports codex unavailable when home resolution fails', async () => {
    process.env.CLI_CLAW_HOME_OVERRIDE = '';
    const reply = await executeUsageCommand({
      getClaudeUsage: vi.fn().mockResolvedValue({
        provider: 'claude',
        available: false,
        reason: '未启用 Claude OAuth provider',
        source: 'Claude OAuth API',
      }),
    });

    expect(reply).toContain('Codex');
    expect(reply).toContain('5h 剩余: unavailable');
    expect(reply).toContain('原因: 无法解析 Codex home 目录');
    expect(reply).toContain('数据源: Codex home resolution');
  });

  test('rejects relative home overrides when resolving codex home', async () => {
    process.env.CLI_CLAW_HOME_OVERRIDE = '.';
    const reply = await executeUsageCommand({
      getClaudeUsage: vi.fn().mockResolvedValue({
        provider: 'claude',
        available: false,
        reason: '未启用 Claude OAuth provider',
        source: 'Claude OAuth API',
      }),
    });

    expect(reply).toContain('Codex');
    expect(reply).toContain('5h 剩余: unavailable');
    expect(reply).toContain('原因: 无法解析 Codex home 目录');
    expect(reply).toContain('数据源: Codex home resolution');
  });

  test('ignores newer malformed codex snapshots so oldest valid data wins', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-invalid-'));
    writeCodexSession(codexHome, 'sessions/2026/04/10/valid.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 43, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 20, window_minutes: 10080, resets_at: 1776390000 },
          },
        },
      },
    ]);
    writeCodexSession(codexHome, 'sessions/2026/04/10/newer-invalid.jsonl', [
      {
        timestamp: '2026-04-10T10:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 5, window_minutes: 300, resets_at: 1775797200 },
            secondary: {
              used_percent: 'oops',
              window_minutes: 10080,
              resets_at: 1776397200,
            },
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

    expect(reply).toContain('5h 剩余: 57%');
    expect(reply).toContain('7d 剩余: 80%');
  });

  test('ignores newer codex snapshots with unexpected rate-limit windows', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-wrong-window-'));
    writeCodexSession(codexHome, 'sessions/2026/04/10/valid.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 43, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 20, window_minutes: 10080, resets_at: 1776390000 },
          },
        },
      },
    ]);
    writeCodexSession(codexHome, 'sessions/2026/04/10/wrong-window.jsonl', [
      {
        timestamp: '2026-04-10T10:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 1, window_minutes: 60, resets_at: 1775797200 },
            secondary: { used_percent: 2, window_minutes: 1440, resets_at: 1776397200 },
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

    expect(reply).toContain('5h 剩余: 57%');
    expect(reply).toContain('7d 剩余: 80%');
  });

  test('available providers with missing percentages render unknown instead of 0%', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-missing-pct-'));
    writeCodexSession(codexHome, 'sessions/2026/04/10/valid.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: {
              used_percent: 25,
              window_minutes: 300,
              resets_at: 1775790000,
            },
            secondary: {
              used_percent: 30,
              window_minutes: 10080,
              resets_at: 1776390000,
            },
          },
        },
      },
    ]);

    const reply = await executeUsageCommand({
      codexHome,
      getClaudeUsage: vi.fn().mockResolvedValue({
        provider: 'claude',
        available: true,
        source: 'Claude OAuth API',
      }),
    });

    expect(reply).toContain('Codex');
    expect(reply).toContain('Claude');
    expect(reply).toContain('- 5h 剩余: unknown');
    expect(reply).toContain('- 7d 剩余: unknown');
  });

  test('available Claude reset fields are normalized into compact local format', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-claude-reset-format-'));
    writeCodexSession(codexHome, 'sessions/2026/04/10/valid.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 25, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 30, window_minutes: 10080, resets_at: 1776390000 },
          },
        },
      },
    ]);

    const reply = await executeUsageCommand({
      codexHome,
      getClaudeUsage: vi.fn().mockResolvedValue({
        provider: 'claude',
        available: true,
        primaryRemainingPct: 10,
        secondaryRemainingPct: 20,
        primaryResetAt: '2026-04-10T09:00:00.000Z',
        secondaryResetAt: '1776393600',
        source: 'Claude OAuth API',
      }),
    });

    const claudeSection = reply.split('\n\n')[1] ?? '';
    expect(claudeSection).toContain('Claude');
    expect(claudeSection).toContain('- 5h 剩余: 10%');
    expect(claudeSection).toContain('- 7d 剩余: 20%');
    expect(claudeSection).not.toContain('2026-04-10T09:00:00.000Z');
    expect(claudeSection.match(/- 5h 重置时间: (.+)$/m)?.[1]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
    expect(claudeSection.match(/- 7d 重置时间: (.+)$/m)?.[1]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
  });

  test('reset-time output is compact local format with placeholders when missing', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-reset-format-'));
    writeCodexSession(codexHome, 'sessions/2026/04/10/reset.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: {
              used_percent: 25,
              window_minutes: 300,
              resets_at: 1775790000,
            },
            secondary: {
              used_percent: 30,
              window_minutes: 10080,
              resets_at: null,
            },
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

    const primaryMatch = reply.match(/- 5h 重置时间: (.+)$/m);
    expect(primaryMatch).not.toBeNull();
    const primaryValue = primaryMatch![1];
    expect(primaryValue).not.toContain('Z');
    expect(primaryValue).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    const secondaryMatch = reply.match(/- 7d 重置时间: (.+)$/m);
    expect(secondaryMatch).not.toBeNull();
    expect(secondaryMatch![1]).toBe('unknown');
  });

  test('Claude helper rejection degrades to unavailable instead of failing', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-claude-error-'));
    writeCodexSession(codexHome, 'sessions/2026/04/10/valid.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 10, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 15, window_minutes: 10080, resets_at: 1776390000 },
          },
        },
      },
    ]);

    const reply = await executeUsageCommand({
      codexHome,
      getClaudeUsage: vi.fn().mockRejectedValue(new Error('timeout')),
    });

    expect(reply).toContain('Claude');
    expect(reply).toContain('5h 剩余: unavailable');
    expect(reply).toContain('原因: Claude usage fetch failed: timeout');
    expect(reply).toContain('数据源: Claude OAuth API');
    expectUnavailableResetLines(reply);
  });

  test('Claude helper synchronous throw degrades to unavailable instead of failing', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-claude-throw-'));
    writeCodexSession(codexHome, 'sessions/2026/04/10/valid.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 10, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 15, window_minutes: 10080, resets_at: 1776390000 },
          },
        },
      },
    ]);

    const reply = await executeUsageCommand({
      codexHome,
      getClaudeUsage: vi.fn().mockImplementation(() => {
        throw new Error('sync failure');
      }),
    });

    expect(reply).toContain('Claude');
    expect(reply).toContain('5h 剩余: unavailable');
    expect(reply).toContain('原因: Claude usage fetch failed: sync failure');
    expect(reply).toContain('数据源: Claude OAuth API');
    expectUnavailableResetLines(reply);
  });

  test('degrades gracefully when Claude error message getter throws', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-claude-throw-message-'));
    writeCodexSession(codexHome, 'sessions/2026/04/10/valid.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 10, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 15, window_minutes: 10080, resets_at: 1776390000 },
          },
        },
      },
    ]);

    const failingMessage = {
      get message() {
        throw new Error('boom');
      },
    };

    const reply = await executeUsageCommand({
      codexHome,
      getClaudeUsage: vi.fn().mockRejectedValue(failingMessage),
    });

    expect(reply).toContain('Claude');
    expect(reply).toContain('5h 剩余: unavailable');
    expect(reply).toContain('原因: Claude usage fetch failed: unknown error');
    expect(reply).toContain('数据源: Claude OAuth API');
    expectUnavailableResetLines(reply);
  });

  test('Claude helper proxy error with throwing message getter degrades safely', async () => {
    const codexHome = mkdtempSync(
      join(tmpdir(), 'codex-home-claude-proxy-message-throw-'),
    );
    writeCodexSession(codexHome, 'sessions/2026/04/10/valid.jsonl', [
      {
        timestamp: '2026-04-10T08:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 10, window_minutes: 300, resets_at: 1775790000 },
            secondary: { used_percent: 15, window_minutes: 10080, resets_at: 1776390000 },
          },
        },
      },
    ]);

    const proxies: ProxyHandler<Error> = {
      get(target, prop, receiver) {
        if (prop === 'message') {
          throw new Error('proxy boom');
        }
        return Reflect.get(target, prop, receiver);
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'message') {
          throw new Error('descriptor boom');
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    };

    const proxiedError = new Proxy(new Error('hidden'), proxies) as Error;

    expect(proxiedError instanceof Error).toBe(true);

    const reply = await executeUsageCommand({
      codexHome,
      getClaudeUsage: vi.fn().mockRejectedValue(proxiedError),
    });

    expect(reply).toContain('Claude');
    expect(reply).toContain('5h 剩余: unavailable');
    expect(reply).toContain('原因: Claude usage fetch failed: unknown error');
    expect(reply).toContain('数据源: Claude OAuth API');
    expectUnavailableResetLines(reply);
  });

  afterEach(() => {
    delete process.env.CLI_CLAW_HOME_OVERRIDE;
    vi.restoreAllMocks();
  });
});
