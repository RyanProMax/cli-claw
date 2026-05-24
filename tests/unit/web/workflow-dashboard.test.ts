import { describe, expect, test } from 'vitest';

import {
  buildWorkflowDashboardData,
  type WorkflowDashboardInput,
} from '../../../src/web/workflow-dashboard.ts';

const dayStart = '2026-05-22T00:00:00.000Z';
const dayEnd = '2026-05-23T00:00:00.000Z';
const generatedAt = '2026-05-22T12:00:00.000Z';

function input(
  overrides: Partial<WorkflowDashboardInput> = {},
): WorkflowDashboardInput {
  return {
    dayStart,
    dayEnd,
    generatedAt,
    runningTaskIds: ['task-discovery'],
    workflowRuns: [
      {
        id: 'run-running',
        context_id: 'ctx-1',
        folder: 'main',
        workflow_id: 'stock-strategy-discovery-loop',
        thread_id: 'thread-1',
        trigger_chat_jid: 'web:main',
        trigger_message_id: null,
        trigger_user_id: null,
        prompt: 'Run discovery',
        status: 'running',
        result: null,
        error: null,
        metadata: {
          source: 'slash-command',
          initialInput: { scheduledTaskId: 'task-discovery' },
        },
        started_at: '2026-05-22T10:00:00.000Z',
        completed_at: null,
        created_at: '2026-05-22T10:00:00.000Z',
        updated_at: '2026-05-22T10:05:00.000Z',
      },
      {
        id: 'run-success',
        context_id: 'ctx-1',
        folder: 'main',
        workflow_id: 'stock-strategy-discovery-loop',
        thread_id: 'thread-1',
        trigger_chat_jid: 'web:main',
        trigger_message_id: null,
        trigger_user_id: null,
        prompt: 'Run discovery',
        status: 'success',
        result: 'completed',
        error: null,
        metadata: {
          source: 'slash-command',
          initialInput: { scheduledTaskId: 'task-discovery' },
        },
        started_at: '2026-05-22T09:00:00.000Z',
        completed_at: '2026-05-22T09:02:30.000Z',
        created_at: '2026-05-22T09:00:00.000Z',
        updated_at: '2026-05-22T09:02:30.000Z',
      },
      {
        id: 'run-error',
        context_id: 'ctx-2',
        folder: 'main',
        workflow_id: 'hkipo',
        thread_id: 'thread-2',
        trigger_chat_jid: 'web:main',
        trigger_message_id: null,
        trigger_user_id: null,
        prompt: 'Run IPO report',
        status: 'error',
        result: null,
        error: 'OpenAI server_is_overloaded',
        metadata: null,
        started_at: '2026-05-22T08:00:00.000Z',
        completed_at: '2026-05-22T08:01:00.000Z',
        created_at: '2026-05-22T08:00:00.000Z',
        updated_at: '2026-05-22T08:01:00.000Z',
      },
    ],
    workflowSteps: [
      {
        id: 'step-running-1',
        run_id: 'run-running',
        node_id: 'collect_results',
        role_id: null,
        status: 'success',
        attempt: 1,
        input: null,
        output: { ok: true },
        error: null,
        started_at: '2026-05-22T10:00:05.000Z',
        completed_at: '2026-05-22T10:00:25.000Z',
        created_at: '2026-05-22T10:00:05.000Z',
        updated_at: '2026-05-22T10:00:25.000Z',
      },
      {
        id: 'step-running-2',
        run_id: 'run-running',
        node_id: 'plan_next_iteration',
        role_id: 'planner',
        status: 'running',
        attempt: 1,
        input: null,
        output: null,
        error: null,
        started_at: '2026-05-22T10:00:25.000Z',
        completed_at: null,
        created_at: '2026-05-22T10:00:25.000Z',
        updated_at: '2026-05-22T10:05:00.000Z',
      },
      {
        id: 'step-error-1',
        run_id: 'run-error',
        node_id: 'final_report',
        role_id: 'reporter',
        status: 'error',
        attempt: 1,
        input: null,
        output: null,
        error: 'socket closed',
        started_at: '2026-05-22T08:00:20.000Z',
        completed_at: '2026-05-22T08:01:00.000Z',
        created_at: '2026-05-22T08:00:20.000Z',
        updated_at: '2026-05-22T08:01:00.000Z',
      },
    ],
    scheduledTasks: [
      {
        id: 'task-discovery',
        group_folder: 'main',
        chat_jid: 'web:main',
        prompt: 'Run stock strategy discovery',
        schedule_type: 'interval',
        schedule_value: String(30 * 60 * 1000),
        context_mode: 'isolated',
        execution_type: 'workflow',
        script_command: 'stock-strategy-discovery-loop',
        workspace_jid: null,
        workspace_folder: null,
        next_run: '2026-05-22T10:30:00.000Z',
        last_run: '2026-05-22T10:00:00.000Z',
        last_result: 'workflow started',
        status: 'active',
        created_at: '2026-05-21T00:00:00.000Z',
        created_by: 'instance-1',
        notify_channels: null,
      },
      {
        id: 'task-script',
        group_folder: 'main',
        chat_jid: 'web:main',
        prompt: 'Script health check',
        schedule_type: 'interval',
        schedule_value: String(60 * 60 * 1000),
        context_mode: 'isolated',
        execution_type: 'script',
        script_command: 'echo ok',
        workspace_jid: null,
        workspace_folder: null,
        next_run: '2026-05-22T11:00:00.000Z',
        last_run: null,
        last_result: null,
        status: 'active',
        created_at: '2026-05-21T00:00:00.000Z',
        created_by: 'instance-1',
        notify_channels: null,
      },
    ],
    taskRunLogs: [
      {
        id: 1,
        task_id: 'task-discovery',
        run_at: '2026-05-22T09:00:00.000Z',
        duration_ms: 150000,
        status: 'success',
        result: 'workflow started',
        error: null,
      },
      {
        id: 2,
        task_id: 'task-discovery',
        run_at: '2026-05-22T10:00:00.000Z',
        duration_ms: 0,
        status: 'running',
        result: null,
        error: null,
      },
    ],
    ...overrides,
  };
}

describe('workflow dashboard aggregation', () => {
  test('summarizes today workflow runs, running runs, steps, and scheduled workflow tasks', () => {
    const dashboard = buildWorkflowDashboardData(input());

    expect(dashboard.summary).toMatchObject({
      totalRuns: 3,
      runningRuns: 1,
      queuedRuns: 0,
      successRuns: 1,
      errorRuns: 1,
      scheduledWorkflowTasks: 1,
      runningScheduledTasks: 1,
      failedTaskRuns: 0,
      completedTaskRuns: 1,
    });

    expect(dashboard.runningRuns.map((run) => run.id)).toEqual(['run-running']);
    expect(dashboard.todayRuns.map((run) => run.id)).toEqual([
      'run-running',
      'run-success',
      'run-error',
    ]);
    expect(dashboard.todayRuns[0].stepSummary).toEqual({
      total: 2,
      pending: 0,
      running: 1,
      success: 1,
      error: 0,
      skipped: 0,
    });
    expect(dashboard.todayRuns[0].steps.map((step) => step.nodeId)).toEqual([
      'collect_results',
      'plan_next_iteration',
    ]);
    expect(dashboard.todayRuns[2].sourceTask).toBeNull();

    expect(dashboard.scheduledTasks).toHaveLength(1);
    expect(dashboard.scheduledTasks[0]).toMatchObject({
      id: 'task-discovery',
      workflowId: 'stock-strategy-discovery-loop',
      running: true,
      todayRunCount: 2,
      todayErrorCount: 0,
      todayLastLogStatus: 'running',
    });
  });

  test('keeps active runs visible even when they started before the selected day', () => {
    const dashboard = buildWorkflowDashboardData(
      input({
        workflowRuns: [
          {
            id: 'run-overnight',
            context_id: 'ctx-overnight',
            folder: 'main',
            workflow_id: 'overnight',
            thread_id: 'thread-overnight',
            trigger_chat_jid: 'web:main',
            trigger_message_id: null,
            trigger_user_id: null,
            prompt: 'Continue overnight workflow',
            status: 'running',
            result: null,
            error: null,
            metadata: null,
            started_at: '2026-05-21T23:50:00.000Z',
            completed_at: null,
            created_at: '2026-05-21T23:50:00.000Z',
            updated_at: '2026-05-22T00:10:00.000Z',
          },
        ],
        workflowSteps: [],
        scheduledTasks: [],
        taskRunLogs: [],
      }),
    );

    expect(dashboard.summary.totalRuns).toBe(1);
    expect(dashboard.summary.runningRuns).toBe(1);
    expect(dashboard.runningRuns[0]).toMatchObject({
      id: 'run-overnight',
      createdAt: '2026-05-21T23:50:00.000Z',
    });
  });

  test('summarizes stock strategy market states from planner decisions and local artifacts', () => {
    const dashboard = buildWorkflowDashboardData(
      input({
        workflowRuns: [
          {
            id: 'run-discovery',
            context_id: 'ctx-stock',
            folder: 'stock-strategy',
            workflow_id: 'stock-strategy-discovery-loop',
            thread_id: 'thread-stock',
            trigger_chat_jid: 'web:stock-strategy',
            trigger_message_id: null,
            trigger_user_id: null,
            prompt: 'Route stock strategy work by state',
            status: 'success',
            result: JSON.stringify({
              action: 'pause_discovery',
              next_workflow: 'stock-strategy-us-candidate-validation',
              cadence: '2h',
              current_next_run_at: '2026-05-22T09:30:00.000Z',
              reason: 'same evidence signature, candidate requires validation',
              evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
              requires_human: false,
              quality_gate: {
                status: 'failed',
                standard_version: 'stock_strategy_quality_gate_v1',
                stage: 'backtest_validation',
                passed_checks: ['artifact_integrity'],
                failed_checks: ['oos_segment_performance'],
                missing_checks: ['paper_reconciliation'],
                summary: 'Still missing OOS and paper reconciliation.',
              },
              next_workflows: [
                {
                  workflow_id: 'stock-strategy-us-candidate-validation',
                  next_run_at: 'immediate',
                  cadence: '2h',
                  priority: 'high',
                },
                {
                  workflow_id: 'stock-strategy-paper-validation',
                  next_run_at: '2026-05-22T10:00:00.000Z',
                  cadence: '1h',
                  priority: 'normal',
                },
              ],
              market_states: [
                {
                  market: 'US',
                  state: 'human_review_ready',
                },
              ],
            }),
            error: null,
            metadata: {
              source: 'scheduled_task',
              scheduledTaskId: 'stock-strategy-discovery-loop',
            },
            started_at: '2026-05-22T09:00:00.000Z',
            completed_at: '2026-05-22T09:02:30.000Z',
            created_at: '2026-05-22T09:00:00.000Z',
            updated_at: '2026-05-22T09:02:30.000Z',
          },
          {
            id: 'run-hk',
            context_id: 'ctx-stock',
            folder: 'stock-strategy',
            workflow_id: 'stock-strategy-hk-design-review',
            thread_id: 'thread-stock',
            trigger_chat_jid: 'web:stock-strategy',
            trigger_message_id: null,
            trigger_user_id: null,
            prompt: 'Review HK design',
            status: 'success',
            result: 'ok',
            error: null,
            metadata: null,
            started_at: '2026-05-22T10:00:00.000Z',
            completed_at: '2026-05-22T10:05:00.000Z',
            created_at: '2026-05-22T10:00:00.000Z',
            updated_at: '2026-05-22T10:05:00.000Z',
          },
          {
            id: 'run-cn',
            context_id: 'ctx-stock',
            folder: 'stock-strategy',
            workflow_id: 'stock-strategy-cn-coverage-check',
            thread_id: 'thread-stock',
            trigger_chat_jid: 'web:stock-strategy',
            trigger_message_id: null,
            trigger_user_id: null,
            prompt: 'Check CN coverage',
            status: 'success',
            result: 'ok',
            error: null,
            metadata: null,
            started_at: '2026-05-22T10:10:00.000Z',
            completed_at: '2026-05-22T10:12:00.000Z',
            created_at: '2026-05-22T10:10:00.000Z',
            updated_at: '2026-05-22T10:12:00.000Z',
          },
        ],
        workflowSteps: [
          {
            id: 'step-hk-design',
            run_id: 'run-hk',
            node_id: 'review_design',
            role_id: null,
            status: 'success',
            attempt: 1,
            input: null,
            output: {
              taskId: 'stock.strategy.design_review',
              artifactKey: 'design_review',
              artifact: {
                source: 'stock_strategy_design_review',
                market: 'hk',
                evidence_signature:
                  'hk:value+momentum:all:default_cost:1,5,10,20:2026-05-22',
                market_state: {
                  market: 'hk',
                  state: 'candidate_review',
                },
              },
            },
            error: null,
            started_at: '2026-05-22T10:00:10.000Z',
            completed_at: '2026-05-22T10:03:00.000Z',
            created_at: '2026-05-22T10:00:10.000Z',
            updated_at: '2026-05-22T10:03:00.000Z',
          },
          {
            id: 'step-cn-coverage',
            run_id: 'run-cn',
            node_id: 'check_coverage',
            role_id: null,
            status: 'success',
            attempt: 1,
            input: null,
            output: {
              taskId: 'stock.strategy.coverage_check',
              artifactKey: 'coverage',
              artifact: {
                source: 'stock_strategy_coverage_check',
                market: 'cn',
                evidence_signature: 'cn:coverage:all:none:none:2026-05-22',
                coverage_status: 'empty',
                market_state: {
                  market: 'cn',
                  state: 'coverage_check',
                },
              },
            },
            error: null,
            started_at: '2026-05-22T10:10:10.000Z',
            completed_at: '2026-05-22T10:11:00.000Z',
            created_at: '2026-05-22T10:10:10.000Z',
            updated_at: '2026-05-22T10:11:00.000Z',
          },
        ],
        scheduledTasks: [
          {
            id: 'stock-strategy-discovery-loop',
            group_folder: 'stock-strategy',
            chat_jid: 'web:stock-strategy',
            prompt: 'Route stock strategy work by state',
            schedule_type: 'interval',
            schedule_value: String(30 * 60 * 1000),
            context_mode: 'isolated',
            execution_type: 'workflow',
            script_command: 'stock-strategy-discovery-loop',
            workspace_jid: 'web:stock-strategy',
            workspace_folder: 'stock-strategy',
            next_run: null,
            last_run: '2026-05-22T09:00:00.000Z',
            last_result: null,
            status: 'paused',
            created_at: '2026-05-21T00:00:00.000Z',
            created_by: null,
            notify_channels: ['feishu:private'],
          },
          {
            id: 'stock-strategy-us-candidate-validation',
            group_folder: 'stock-strategy',
            chat_jid: 'web:stock-strategy',
            prompt: 'Validate US candidate',
            schedule_type: 'interval',
            schedule_value: String(2 * 60 * 60 * 1000),
            context_mode: 'isolated',
            execution_type: 'workflow',
            script_command: 'stock-strategy-us-candidate-validation',
            workspace_jid: 'web:stock-strategy',
            workspace_folder: 'stock-strategy',
            next_run: '2026-05-22T11:00:00.000Z',
            last_run: null,
            last_result: null,
            status: 'active',
            created_at: '2026-05-21T00:00:00.000Z',
            created_by: null,
            notify_channels: ['feishu:private'],
          },
        ],
        taskRunLogs: [],
      }),
    );

    expect(dashboard.stockStrategy?.globalDecision).toMatchObject({
      action: 'pause_discovery',
      nextWorkflow: 'stock-strategy-us-candidate-validation',
      cadence: '2h',
      requiresHuman: false,
      qualityGateStatus: 'failed',
      currentNextRunAt: '2026-05-22T09:30:00.000Z',
      nextWorkflows: [
        expect.objectContaining({
          workflowId: 'stock-strategy-us-candidate-validation',
          cadence: '2h',
          priority: 'high',
        }),
        expect.objectContaining({
          workflowId: 'stock-strategy-paper-validation',
          nextRunAt: '2026-05-22T10:00:00.000Z',
          cadence: '1h',
        }),
      ],
    });
    expect(dashboard.stockStrategy?.markets).toEqual([
      expect.objectContaining({
        market: 'US',
        state: 'human_review_ready',
        action: 'pause_discovery',
        nextWorkflow: 'stock-strategy-us-candidate-validation',
        cadence: '2h',
        evidenceSignature: 'us:momentum_5d:all:default_cost:5d:20260524',
        requiresHuman: false,
      }),
      expect.objectContaining({
        market: 'HK',
        state: 'blocked',
        workflowId: 'stock-strategy-hk-design-review',
        evidenceSignature:
          'hk:value+momentum:all:default_cost:1,5,10,20:2026-05-22',
      }),
      expect.objectContaining({
        market: 'CN',
        state: 'blocked',
        workflowId: 'stock-strategy-cn-coverage-check',
        evidenceSignature: 'cn:coverage:all:none:none:2026-05-22',
      }),
    ]);
  });
});
