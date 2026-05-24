import { describe, expect, test } from 'vitest';

import {
  parseCadenceToIntervalMs,
  parseStockStrategyPlannerDecision,
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
});
