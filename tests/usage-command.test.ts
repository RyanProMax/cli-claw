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
