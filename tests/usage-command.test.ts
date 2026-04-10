import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

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
    expect(reply).toContain('- 5h 重置时间:');
    expect(reply).toContain('- 7d 重置时间:');
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
            secondary: null,
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
  });
});
