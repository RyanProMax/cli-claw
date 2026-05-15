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
        codexUsage: {
          available: true,
          primaryRemainingPct: 90,
          secondaryRemainingPct: 67,
        },
        stockTaskDb: path.join(tempDir, 'missing-task-chain.sqlite'),
        maintenanceStateFile: path.join(tempDir, 'maintenance-loop-state.json'),
      });

      expect(output).toContain(
        '📈 market_loop: degraded (task_chain_db_missing)',
      );
      expect(output).not.toContain('market_loop: error');
      expect(output).not.toContain('better-sqlite3');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
