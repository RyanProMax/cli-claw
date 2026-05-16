import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, test } from 'vitest';

import { formatLoopStatusSection } from '../src/loop-status.js';

const emptyTaskReader = {
  getTaskById: () => undefined,
  getTaskRunLogs: () => [],
};

describe('formatLoopStatusSection', () => {
  test('does not expose low-level SQLite reader errors in market loop status', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'cli-claw-loop-status-'));
    try {
      const output = formatLoopStatusSection({
        taskReader: emptyTaskReader,
        runtimeUsage: {
          available: true,
          primaryRemainingPct: 90,
          secondaryRemainingPct: 67,
        },
        stockTaskDb: path.join(tempDir, 'missing-task-chain.sqlite'),
        maintenanceStateFile: path.join(tempDir, 'maintenance-loop-state.json'),
      });

      expect(output).toContain('📈 市场策略循环：降级（任务链数据库未找到）');
      expect(output).not.toContain('market_loop: error');
      expect(output).not.toContain('market_loop');
      expect(output).not.toContain('better-sqlite3');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('uses a blank line before the loop section and human-readable labels', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'cli-claw-loop-status-'));
    try {
      const output = formatLoopStatusSection({
        taskReader: emptyTaskReader,
        runtimeUsage: {
          available: true,
          primaryRemainingPct: 90,
          secondaryRemainingPct: 67,
        },
        stockTaskDb: path.join(tempDir, 'missing-task-chain.sqlite'),
        maintenanceStateFile: path.join(tempDir, 'maintenance-loop-state.json'),
      });

      expect(output).toMatch(/^\n\n🔁 循环状态/);
      expect(output).toContain('🛠️ 自迭代维护循环：未启动');
      expect(output).toContain('🛡️ 用量护栏：正常，7d=67%');
      expect(output).not.toContain('maintenance_loop');
      expect(output).not.toContain('usage_guard');
      expect(output).not.toContain('not_registered');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
