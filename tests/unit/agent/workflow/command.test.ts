import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeWorkflowFixture(workspaceRoot: string): void {
  writeFile(
    path.join(workspaceRoot, '.agents', 'agent-roles', 'analyst.md'),
    [
      '---',
      'id: analyst',
      'name: 投研分析师',
      'allowedTools: send_message',
      'permissionMode: readonly',
      '---',
      '',
      '只输出可溯源的投研结论。',
    ].join('\n'),
  );
  writeFile(
    path.join(workspaceRoot, '.agents', 'workflows', 'research.json'),
    JSON.stringify(
      {
        id: 'research',
        name: '投研工作流',
        roles: ['analyst'],
        start: 'research',
        nodes: [{ id: 'research', type: 'role_task', roleId: 'analyst' }],
        edges: [{ from: 'research', to: '__end__' }],
      },
      null,
      2,
    ),
  );
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 500,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function loadWorkflowCommand() {
  const home = tempDir('cli-claw-workflow-command-home-');
  vi.stubEnv('HOME', home);
  const db = await import('../../../../src/storage/db.ts');
  const command = await import('../../../../src/agent/workflow/command.ts');
  db.initDatabase();
  return { command, db };
}

describe('workflow command execution', () => {
  test('lists workflows from the current workspace', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-workspace-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();

    await expect(
      command.executeWorkflowCommand({
        group: {
          name: 'Workspace A',
          folder: 'workspace-a',
          added_at: '2026-05-17T10:00:00.000Z',
        },
        chatJid: 'web:workspace-a',
        argsText: '',
        workspaceRoot,
      }),
    ).resolves.toContain('- research：投研工作流');

    db.closeDatabase();
  });

  test('creates an isolated workflow run and invokes the graph runner', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-run-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: '分析英伟达',
      result: '投研结论完成',
      stepResults: {},
    });

    const reply = await command.executeWorkflowCommand({
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
      },
      chatJid: 'web:workspace-a',
      argsText: 'research 分析英伟达',
      triggerUserId: 'user-1',
      workspaceRoot,
      runGraph,
    });

    expect(reply).toContain('✅ 工作流 投研工作流 (research) 完成');
    expect(reply).toContain('投研结论完成');
    expect(runGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '分析英伟达',
        workflow: expect.objectContaining({ id: 'research' }),
        context: expect.objectContaining({
          folder: 'workspace-a',
          workflow_id: 'research',
        }),
        run: expect.objectContaining({
          folder: 'workspace-a',
          workflow_id: 'research',
          trigger_chat_jid: 'web:workspace-a',
          trigger_user_id: 'user-1',
        }),
        checkpointer: expect.any(Object),
      }),
    );

    db.closeDatabase();
  });

  test('passes structured initial input into workflow runs', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-input-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: '分析港股 IPO',
      result: 'IPO 报告完成',
      stepResults: {},
      artifacts: {},
    });

    const reply = await command.executeWorkflowCommand({
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
      },
      chatJid: 'web:workspace-a',
      argsText: 'research 分析港股 IPO',
      workspaceRoot,
      runGraph,
      initialInput: {
        command: 'hkipo',
        includeClosed: true,
      },
    } as any);

    expect(reply).toContain('IPO 报告完成');
    expect(runGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        initialInput: {
          command: 'hkipo',
          includeClosed: true,
        },
      }),
    );

    db.closeDatabase();
  });

  test('background workflow returns a started acknowledgement before graph completion', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-background-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();
    const gate = deferred<void>();
    const backgroundResults: string[] = [];
    const runGraph = vi.fn(async () => {
      await gate.promise;
      return {
        prompt: '分析英伟达',
        result: '投研结论完成',
        stepResults: {},
      };
    });

    const execution = command.executeWorkflowCommand({
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
      },
      chatJid: 'web:workspace-a',
      argsText: 'research 分析英伟达',
      triggerUserId: 'user-1',
      workspaceRoot,
      runGraph,
      background: true,
      onBackgroundResult: async (message: string) => {
        backgroundResults.push(message);
      },
    } as any);

    const firstResult = await Promise.race([
      execution,
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 25),
      ),
    ]);
    gate.resolve();

    expect(firstResult).not.toBe('timeout');
    expect(firstResult).toContain('🚀 已启动工作流 投研工作流 (research)');
    expect(backgroundResults).toEqual([]);

    await waitForCondition(() => backgroundResults.length === 1);
    expect(backgroundResults[0]).toContain(
      '✅ 工作流 投研工作流 (research) 完成',
    );
    expect(backgroundResults[0]).toContain('投研结论完成');

    db.closeDatabase();
  });

  test('background workflow reports failures and timeouts to the trigger session', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-background-fail-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();
    const backgroundResults: string[] = [];
    const runGraph = vi.fn(async () => {
      throw new Error('Agent Process timed out after 1800000ms');
    });

    const reply = await command.executeWorkflowCommand({
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
      },
      chatJid: 'web:workspace-a',
      argsText: 'research 分析英伟达',
      triggerUserId: 'user-1',
      workspaceRoot,
      runGraph,
      background: true,
      onBackgroundResult: async (message: string) => {
        backgroundResults.push(message);
      },
    } as any);

    expect(reply).toContain('🚀 已启动工作流 投研工作流 (research)');
    await waitForCondition(() => backgroundResults.length === 1);
    expect(backgroundResults[0]).toContain(
      '❌ 工作流 投研工作流 (research) 失败',
    );
    expect(backgroundResults[0]).toContain(
      'Agent Process timed out after 1800000ms',
    );

    db.closeDatabase();
  });

  test('normalizes hkipo final report before delivery', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-hkipo-report-');
    writeFile(
      path.join(workspaceRoot, '.agents', 'agent-roles', 'editor.md'),
      [
        '---',
        'id: editor',
        'name: 报告编辑',
        'allowedTools: send_message',
        'permissionMode: readonly',
        '---',
        '',
        '输出最终报告。',
      ].join('\n'),
    );
    writeFile(
      path.join(workspaceRoot, '.agents', 'workflows', 'hkipo.json'),
      JSON.stringify(
        {
          id: 'hkipo',
          name: '港股 IPO 打新工作流',
          roles: ['editor'],
          start: 'ranking_report_editor',
          nodes: [
            {
              id: 'ranking_report_editor',
              type: 'role_task',
              roleId: 'editor',
            },
          ],
          edges: [{ from: 'ranking_report_editor', to: '__end__' }],
        },
        null,
        2,
      ),
    );
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: '分析港股 IPO',
      result: [
        '🟢 1｜深演智能 02723｜38分｜5/21截止 | 5/26开奖',
        '💵 入场：HK$5,605.97｜一手100｜招股中｜卡：热17 结构8 回测15 基本面7 估值1 证据7',
        '🔥 热度：认购倍数 61.74x（Chief Securities IPO，5/18，单一券商下限）；孖展多源未取到',
      ].join('\n'),
      stepResults: {},
    });

    const reply = await command.executeWorkflowCommand({
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
      },
      chatJid: 'web:workspace-a',
      argsText: 'hkipo 分析港股 IPO',
      workspaceRoot,
      runGraph,
    });

    expect(reply).toContain('致富证券 IPO');
    expect(reply).toContain(
      '🧮 评分：热度17/20｜结构8/20｜回测15/20｜基本面7/20｜估值1/10｜证据7/10',
    );
    expect(reply).not.toContain('Chief Securities IPO');
    expect(reply).not.toContain('卡：热17');
    expect(reply).not.toContain('孖展多源未取到');
    expect(reply).toContain('融资/孖展倍数暂无多源核验');

    db.closeDatabase();
  });

  test('formats stock strategy workflow results as a concise Feishu summary', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-stock-strategy-');
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: 'Run stock strategy discovery.',
      result: JSON.stringify(
        {
          change_summary:
            '本轮无新增可上线策略，只确认 US momentum_5d 仍是唯一可补证候选。',
          repeat_decision: {
            verdict: 'HK 与 CN 仍是重复阻断',
            action: '暂停同配置原样重跑，转向 US 候选补证与 CN universe 修复。',
          },
          next_iteration_objective: {
            summary:
              '下一轮采取最小有价值迭代：以 US momentum_5d 候选做补证验证；HK 暂停相同三因子原样重跑；CN 先补 universe/扫描链路证据。',
            priority_order: ['US 候选验证与补证', 'HK 失败原因拆解'],
            cadence_decision: {
              us: '进入 2 小时候选验证前的补证阶段',
              hk: '仅限修改研究设计后的单轮验证',
            },
          },
          candidate_tasks: [
            {
              task_name: 'US_momentum_5d_候选补证验证',
              market: 'us',
              goal: '验证 alpha_topn_momentum_5d 是否具备进入候选验证的最低证据完整性。',
              input_evidence: [
                '已知指标：rank_ic_mean=0.05800525，rank_ic_tstat=2.81729218，cost_adjusted_quantile_spread=0.00359111，turnover=0.28063241，observations=1252',
              ],
            },
          ],
          validation_plan: ['补齐 OOS 明细', '补 champion/challenger 对比'],
          stop_conditions: ['不自动 approve', '不自动 activate'],
        },
        null,
        2,
      ),
      stepResults: {},
    });

    const reply = await command.executeWorkflowCommand({
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
      },
      chatJid: 'web:workspace-a',
      argsText: 'stock-strategy-discovery-loop Run stock strategy discovery.',
      workspaceRoot,
      runGraph,
    });

    expect(reply).toContain('✅ 工作流 股票策略短间隔发现工作流');
    expect(reply).toContain('🎯 阶段目标');
    expect(reply).toContain('📍 本轮完成');
    expect(reply).toContain('📈 策略效果');
    expect(reply).toContain('🧭 后续规划');
    expect(reply).toContain('🎯 阶段目标\n\n- **目标：**');
    expect(reply).toContain('📍 本轮完成\n\n- **本轮：**');
    expect(reply).toContain(
      '- **重复判断：** HK 与 CN 仍是重复阻断；暂停同配置原样重跑',
    );
    expect(reply).toContain('US_momentum_5d');
    expect(reply).toContain('rank IC 0.058');
    expect(reply).not.toContain('📍 当前进展');
    expect(reply).not.toContain('next_iteration_objective');
    expect(reply).not.toContain('candidate_tasks');
    expect(reply).not.toContain('change_summary');
    expect(reply).not.toContain('repeat_decision');
    expect(reply).not.toContain('{\n');

    db.closeDatabase();
  });

  test('keeps only the scheduler decision JSON when stock planner emits the fixed decision schema', async () => {
    const workspaceRoot = tempDir(
      'cli-claw-workflow-command-stock-strategy-decision-',
    );
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: 'Run stock strategy orchestrator.',
      result: JSON.stringify({
        action: 'pause_discovery',
        next_workflow: 'stock-strategy-us-candidate-validation',
        cadence: '2h',
        current_cadence: '30m',
        next_cadence: '2h',
        current_next_run_at: '2026-05-24T14:45:00.000Z',
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
          summary: 'OOS evidence still missing.',
        },
        next_workflows: [
          {
            workflow_id: 'stock-strategy-us-candidate-validation',
            next_run_at: 'immediate',
            cadence: '2h',
            priority: 'high',
            reason: '补齐 OOS 与 champion/challenger 对比。',
          },
          {
            workflow_id: 'stock-strategy-paper-validation',
            next_run_at: '2026-05-24T15:00:00.000Z',
            cadence: '1h',
            priority: 'normal',
            reason: '读取 paper/live ledger 做 reconciliation。',
          },
        ],
        change_summary: '本轮无新增发现，只做路由判断。',
        candidate_tasks: [{ name: 'raw task should stay out of delivery' }],
      }),
      stepResults: {},
    });

    const reply = await command.executeWorkflowCommand({
      group: {
        name: '股票策略',
        folder: 'stock-strategy',
        added_at: '2026-05-24T10:00:00.000Z',
      },
      chatJid: 'web:stock-strategy',
      argsText: 'stock-strategy-discovery-loop Route by state.',
      workspaceRoot,
      runGraph,
    });

    expect(reply).toContain('[Scheduler Decision]');
    expect(reply).toContain('"action":"pause_discovery"');
    expect(reply).toContain(
      '"next_workflow":"stock-strategy-us-candidate-validation"',
    );
    expect(reply).toContain('"current_cadence":"30m"');
    expect(reply).toContain('"next_cadence":"2h"');
    expect(reply).toContain('"current_next_run_at":"2026-05-24T14:45:00.000Z"');
    expect(reply).toContain('"next_workflows"');
    expect(reply).toContain('"workflow_id":"stock-strategy-paper-validation"');
    expect(reply).toContain('"quality_gate"');
    expect(reply).toContain('"status":"failed"');
    expect(reply).not.toContain('raw task should stay out of delivery');
    expect(reply).not.toContain('"change_summary"');
    expect(reply).not.toContain('"candidate_tasks"');

    db.closeDatabase();
  });

  test('formats stock strategy paper setup results without exposing raw structures', async () => {
    const workspaceRoot = tempDir(
      'cli-claw-workflow-command-stock-strategy-paper-setup-',
    );
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: 'Check paper setup.',
      result: JSON.stringify(
        {
          change_summary:
            'watch 列表和 paper ledger 还没接上，不能进入模拟盘验证。',
          repeat_decision: '继续补基础证据，不重复 discovery。',
          candidate_tasks: [
            {
              task_name: 'raw task should stay out of delivery',
              goal: 'raw goal should stay out of delivery',
            },
          ],
          validation_plan: ['补 watch list', '补 paper ledger'],
        },
        null,
        2,
      ),
      stepResults: {},
    });

    const reply = await command.executeWorkflowCommand({
      group: {
        name: '股票策略',
        folder: 'stock-strategy',
        added_at: '2026-05-24T10:00:00.000Z',
      },
      chatJid: 'web:stock-strategy',
      argsText: 'stock-strategy-paper-setup Check paper setup.',
      workspaceRoot,
      runGraph,
    });

    expect(reply).toContain('✅ 工作流 股票策略模拟盘准备工作流');
    expect(reply).toContain('🎯 阶段目标');
    expect(reply).toContain('watch 列表和 paper ledger 还没接上');
    expect(reply).toContain('继续补基础证据');
    expect(reply).not.toContain('candidate_tasks');
    expect(reply).not.toContain('raw task should stay out of delivery');
    expect(reply).not.toContain('{\n');

    db.closeDatabase();
  });
});
