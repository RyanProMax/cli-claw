import { describe, expect, test } from 'vitest';

import {
  parseCadenceToIntervalMs,
  parseStockStrategyPlannerDecision,
  parseStockStrategyPlannerDecisionResult,
} from '../../../../src/agent/scheduler/stock-strategy-decision.ts';

describe('stock strategy scheduler decision parsing', () => {
  test('parses a planner JSON decision from a workflow success message', () => {
    const result = [
      '✅ 工作流 股票策略短间隔发现工作流 (stock-strategy-discovery-loop) 完成：',
      JSON.stringify({
        action: 'pause_discovery',
        next_workflow: 'stock-strategy-us-candidate-validation',
        cadence: '2h',
        reason: 'same evidence signature, candidate requires validation',
        evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
        requires_human: false,
      }),
    ].join('\n');

    expect(parseStockStrategyPlannerDecision(result)).toEqual({
      action: 'pause_discovery',
      next_workflow: 'stock-strategy-us-candidate-validation',
      cadence: '2h',
      reason: 'same evidence signature, candidate requires validation',
      evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
      requires_human: false,
    });
  });

  test('parses strategy usability gate evidence from planner decisions', () => {
    const result = JSON.stringify({
      action: 'pause',
      next_workflow: null,
      cadence: 'manual',
      reason: 'candidate meets the strategy usability standard',
      evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
      requires_human: true,
      strategy_usability: {
        status: 'passed',
        standard_version: 'stock_strategy_usability_v1',
        passed_checks: [
          'artifact_integrity',
          'oos_segment_performance',
          'champion_challenger_comparison',
        ],
        failed_checks: [],
        summary: 'US candidate is ready for human review.',
      },
    });

    expect(parseStockStrategyPlannerDecision(result)).toEqual({
      action: 'pause',
      next_workflow: null,
      cadence: 'manual',
      reason: 'candidate meets the strategy usability standard',
      evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
      requires_human: true,
      strategy_usability: {
        status: 'passed',
        standard_version: 'stock_strategy_usability_v1',
        passed_checks: [
          'artifact_integrity',
          'oos_segment_performance',
          'champion_challenger_comparison',
        ],
        failed_checks: [],
        missing_checks: [],
        summary: 'US candidate is ready for human review.',
      },
    });
  });

  test('normalizes cadence labels into interval milliseconds', () => {
    expect(parseCadenceToIntervalMs('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseCadenceToIntervalMs('6 小时')).toBe(6 * 60 * 60 * 1000);
    expect(parseCadenceToIntervalMs('30m')).toBe(30 * 60 * 1000);
    expect(parseCadenceToIntervalMs('manual')).toBeNull();
  });

  test('parses separate current and downstream cadence fields', () => {
    const result = JSON.stringify({
      action: 'switch_workflow',
      next_workflow: 'stock-strategy-us-candidate-validation',
      cadence: '2h',
      current_cadence: '30m',
      next_cadence: '2h',
      reason: 'candidate validation should continue without slowing router',
      evidence_signature: 'us:momentum_5d:all:default_cost:5d:20260524',
      requires_human: false,
    });

    expect(parseStockStrategyPlannerDecision(result)).toMatchObject({
      action: 'switch_workflow',
      cadence: '2h',
      current_cadence: '30m',
      next_cadence: '2h',
    });
  });

  test('parses dynamic control decisions with multiple downstream workflow assignments and quality gate', () => {
    const result = JSON.stringify({
      action: 'switch_workflow',
      next_workflow: null,
      cadence: 'dynamic',
      current_next_run_at: '2026-05-24T14:45:00.000Z',
      reason: 'US candidate needs validation and paper-readiness checks.',
      evidence_signature: 'control:portfolio:all:default_cost:mixed:20260524',
      requires_human: false,
      work_budget: {
        max_runtime_minutes: 25,
        max_retries: 1,
        priority: 'high',
      },
      quality_gate: {
        status: 'failed',
        standard_version: 'stock_strategy_quality_gate_v1',
        stage: 'backtest_validation',
        score: 0.64,
        passed_checks: ['artifact_integrity'],
        failed_checks: ['oos_segment_performance'],
        missing_checks: ['paper_reconciliation'],
        defects: ['OOS 分段缺失，不能进入人工审批。'],
        summary: '验证证据不足，继续补 OOS 和模拟盘对账。',
      },
      next_workflows: [
        {
          workflow_id: 'stock-strategy-us-candidate-validation',
          next_run_at: 'immediate',
          cadence: '2h',
          priority: 'high',
          reason: '补齐 OOS 与 champion/challenger 对比。',
          prompt: 'Validate US momentum_5d candidate with OOS evidence.',
          quality_gate: 'backtest_validation',
        },
        {
          workflow_id: 'stock-strategy-paper-validation',
          next_run_at: '2026-05-24T15:00:00.000Z',
          cadence: '1h',
          priority: 'normal',
          reason: '读取 paper/live ledger 做 reconciliation。',
        },
      ],
    });

    expect(parseStockStrategyPlannerDecision(result)).toEqual({
      action: 'switch_workflow',
      next_workflow: null,
      cadence: 'dynamic',
      current_next_run_at: '2026-05-24T14:45:00.000Z',
      reason: 'US candidate needs validation and paper-readiness checks.',
      evidence_signature: 'control:portfolio:all:default_cost:mixed:20260524',
      requires_human: false,
      work_budget: {
        max_runtime_minutes: 25,
        max_retries: 1,
        priority: 'high',
      },
      quality_gate: {
        status: 'failed',
        standard_version: 'stock_strategy_quality_gate_v1',
        stage: 'backtest_validation',
        score: 0.64,
        passed_checks: ['artifact_integrity'],
        failed_checks: ['oos_segment_performance'],
        missing_checks: ['paper_reconciliation'],
        defects: ['OOS 分段缺失，不能进入人工审批。'],
        summary: '验证证据不足，继续补 OOS 和模拟盘对账。',
      },
      next_workflows: [
        {
          workflow_id: 'stock-strategy-us-candidate-validation',
          next_run_at: 'immediate',
          cadence: '2h',
          priority: 'high',
          reason: '补齐 OOS 与 champion/challenger 对比。',
          prompt: 'Validate US momentum_5d candidate with OOS evidence.',
          quality_gate: 'backtest_validation',
        },
        {
          workflow_id: 'stock-strategy-paper-validation',
          next_run_at: '2026-05-24T15:00:00.000Z',
          cadence: '1h',
          priority: 'normal',
          reason: '读取 paper/live ledger 做 reconciliation。',
        },
      ],
    });
  });

  test('rejects invented scheduler actions with a structured error', () => {
    const result = JSON.stringify({
      action: 'dispatch_failed_gate_remediation',
      next_workflow: 'stock-strategy-paper-validation',
      cadence: '30m',
      reason: 'The planner invented an action name.',
      evidence_signature: 'control:bad-action:20260525',
      requires_human: false,
    });

    expect(parseStockStrategyPlannerDecision(result)).toBeNull();
    expect(parseStockStrategyPlannerDecisionResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_action',
        message:
          'Invalid stock strategy scheduler action: dispatch_failed_gate_remediation',
        action: 'dispatch_failed_gate_remediation',
      },
    });
  });
});
