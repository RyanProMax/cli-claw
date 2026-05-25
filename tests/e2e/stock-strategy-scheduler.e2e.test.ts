import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const { runtimeUsageMock } = vi.hoisted(() => ({
  runtimeUsageMock: vi.fn(),
}));

vi.mock('../../src/core/runtime/usage.js', () => ({
  getRuntimeUsageSnapshot: runtimeUsageMock,
}));

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetModules();
  runtimeUsageMock.mockReset();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function loadRuntime() {
  const home = tempDir('cli-claw-stock-e2e-home-');
  const stockApiRoot = tempDir('cli-claw-stock-e2e-api-');
  fs.mkdirSync(path.join(stockApiRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(stockApiRoot, 'scripts', 'futu_market_data.py'),
    '',
  );
  vi.stubEnv('HOME', home);
  vi.stubEnv('STOCK_ANALYSIS_API_ROOT', stockApiRoot);

  const db = await import('../../src/storage/db.ts');
  db.initDatabase();
  const scheduler = await import('../../src/agent/scheduler/index.ts');
  return { db, scheduler };
}

describe('stock strategy scheduler E2E', () => {
  test('control loop applies a legal decision into real downstream paper setup and validation tasks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T03:00:00.000Z'));
    runtimeUsageMock.mockResolvedValue({
      provider: 'openai',
      available: true,
      source: 'test',
      primaryRemainingPct: 80,
      secondaryRemainingPct: 80,
    });
    const { db, scheduler } = await loadRuntime();
    db.ensureStockStrategyWorkspaceAndSchedules({
      now: '2026-05-25T03:00:00.000Z',
    });
    const controlTask = db.getTaskById('stock-strategy-control-loop');
    expect(controlTask).toBeDefined();

    const runWorkflowCommand = vi.fn().mockResolvedValue(
      JSON.stringify({
        action: 'switch_workflow',
        next_workflow: null,
        cadence: '30m',
        current_next_run_at: '2026-05-25T10:47:35+08:00',
        reason: 'US candidate needs paper setup first, then paper validation.',
        evidence_signature: 'control:e2e:paper-setup:20260525',
        requires_human: false,
        next_workflows: [
          {
            workflow_id: 'stock-strategy-paper-setup',
            next_run_at: 'immediate',
            cadence: '1h',
            priority: 'high',
            reason: 'simulated trading and watch are not configured.',
          },
          {
            workflow_id: 'stock-strategy-paper-validation',
            next_run_at: '2026-05-25T04:00:00.000Z',
            cadence: '1h',
            priority: 'normal',
            reason: 'validate paper ledger after setup evidence exists.',
          },
        ],
      }),
    );

    await scheduler.runWorkflowTask(
      controlTask!,
      {
        registeredGroups: () => ({
          'web:stock-strategy': {
            name: '股票策略',
            folder: 'stock-strategy',
            added_at: '2026-05-25T03:00:00.000Z',
            agentType: 'openai',
            is_home: true,
          },
        }),
        getSessions: () => ({}),
        queue: {} as never,
        sendMessage: vi.fn(),
        runWorkflowCommand,
        assistantName: 'cli-claw',
      },
      'web:stock-strategy',
    );

    expect(db.getTaskById('stock-strategy-control-loop')).toMatchObject({
      next_run: '2026-05-25T03:30:00.000Z',
      status: 'active',
    });
    expect(db.getTaskById('stock-strategy-paper-setup')).toMatchObject({
      status: 'active',
      schedule_type: 'interval',
      schedule_value: String(60 * 60 * 1000),
      next_run: '2026-05-25T03:00:00.000Z',
      workspace_jid: 'web:stock-strategy',
    });
    expect(db.getTaskById('stock-strategy-paper-validation')).toMatchObject({
      status: 'active',
      schedule_type: 'interval',
      schedule_value: String(60 * 60 * 1000),
      next_run: '2026-05-25T04:00:00.000Z',
      workspace_jid: 'web:stock-strategy',
    });
    expect(
      db.getTaskRunLogs('stock-strategy-control-loop', 1)[0],
    ).toMatchObject({
      status: 'success',
      error: null,
    });

    db.closeDatabase();
  });

  test('watchdog marks stale stock strategy task logs and workflow runs as errors', async () => {
    const { db } = await loadRuntime();
    db.logTaskRunStart(
      'stock-strategy-daily-progress-summary',
      '2026-05-25T14:22:29.732Z',
    );
    db.upsertWorkflowContext({
      id: 'ctx-stale-e2e-run',
      folder: 'stock-strategy',
      workflowId: 'stock-strategy-control-loop',
      threadId: 'thread-stock-stale-e2e',
      runtimeAgentId: 'runtime-stock-strategy-control',
    });
    db.insertWorkflowRun({
      id: 'stale-e2e-run',
      contextId: 'ctx-stale-e2e-run',
      folder: 'stock-strategy',
      workflowId: 'stock-strategy-control-loop',
      threadId: 'thread-stock-stale-e2e',
      triggerChatJid: 'web:stock-strategy',
      prompt: 'Run stale control loop',
      status: 'running',
      startedAt: '2026-05-25T03:47:34.000Z',
      createdAt: '2026-05-25T03:47:34.000Z',
      updatedAt: '2026-05-25T03:47:34.000Z',
    });

    expect(
      db.cleanupStaleRunningTaskAndWorkflowRuns({
        now: '2026-05-25T17:00:00.000Z',
        olderThanMs: 30 * 60 * 1000,
      }),
    ).toEqual({
      taskLogs: 1,
      workflowRuns: 1,
    });
    expect(
      db.getTaskRunLogs('stock-strategy-daily-progress-summary', 1)[0],
    ).toMatchObject({
      status: 'error',
      error: 'Process exceeded scheduled workflow watchdog timeout',
    });
    expect(db.getWorkflowRunById('stale-e2e-run')).toMatchObject({
      status: 'error',
      error: 'Process exceeded scheduled workflow watchdog timeout',
    });

    db.closeDatabase();
  });
});
