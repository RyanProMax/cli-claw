import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  discoverWorkflowConfigs,
  loadWorkflowDefinition,
} from '../../../../src/agent/workflow/config.ts';

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeWorkflow(
  workspaceRoot: string,
  id: string,
  definition: Record<string, unknown>,
): void {
  writeFile(
    path.join(workspaceRoot, '.agents', 'workflows', `${id}.json`),
    JSON.stringify(definition, null, 2),
  );
}

function writeRole(
  workspaceRoot: string,
  id: string,
  frontmatter: Record<string, string>,
  body: string,
): void {
  const lines = [
    '---',
    ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`),
    '---',
    '',
    body,
  ];
  writeFile(
    path.join(workspaceRoot, '.agents', 'agent-roles', `${id}.md`),
    lines.join('\n'),
  );
}

describe('workflow config discovery', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('loads workflow definitions and runtime role cards from .agents', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-config-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: '投研分析师',
        description: '整理公开信息并形成观点',
        allowedTools: 'send_message,list_tasks',
        skillIds: 'stock-kol-intel,stock-analysis-skill',
        permissionMode: 'standard',
      },
      '只输出可溯源的投研结论。',
    );
    writeWorkflow(workspaceRoot, 'investment-research', {
      id: 'investment-research',
      name: '投研工作流',
      description: '从用户问题触发投研 crew',
      roles: ['analyst'],
      start: 'research',
      nodes: [
        {
          id: 'research',
          type: 'role_task',
          roleId: 'analyst',
          prompt: '围绕用户问题做投研分析',
        },
      ],
      edges: [{ from: 'research', to: '__end__' }],
      maxRetries: 2,
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message', 'list_tasks', 'schedule_task'],
    });

    expect(discovered.errors).toEqual([]);
    expect(discovered.workflows).toHaveLength(1);
    expect(discovered.workflows[0]).toMatchObject({
      id: 'investment-research',
      name: '投研工作流',
      roles: ['analyst'],
      start: 'research',
      maxRetries: 2,
    });
    expect(discovered.roles.get('analyst')).toMatchObject({
      id: 'analyst',
      name: '投研分析师',
      allowedTools: ['send_message', 'list_tasks'],
      skillIds: ['stock-kol-intel', 'stock-analysis-skill'],
      permissionMode: 'standard',
      instructions: '只输出可溯源的投研结论。',
    });
  });

  test('rejects workflows that reference missing roles', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-missing-role-'),
    );
    tempDirs.push(workspaceRoot);

    writeWorkflow(workspaceRoot, 'broken', {
      id: 'broken',
      name: 'Broken',
      roles: ['missing'],
      start: 'research',
      nodes: [
        {
          id: 'research',
          type: 'role_task',
          roleId: 'missing',
          prompt: 'run',
        },
      ],
      edges: [{ from: 'research', to: '__end__' }],
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.workflows).toEqual([]);
    expect(discovered.errors).toEqual([
      'workflow broken references missing role missing',
    ]);
  });

  test('rejects role cards that request unknown tools', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-unknown-tool-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: 'Analyst',
        allowedTools: 'send_message,delete_everything',
      },
      'Stay focused.',
    );

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.roles.size).toBe(0);
    expect(discovered.errors).toEqual([
      'role analyst references unknown tool delete_everything',
    ]);
  });

  test('rejects workflows with invalid node definitions', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-invalid-node-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: 'Analyst',
        allowedTools: 'send_message',
      },
      'Stay focused.',
    );
    writeWorkflow(workspaceRoot, 'malformed', {
      id: 'malformed',
      roles: ['analyst'],
      start: 'research',
      nodes: [
        {
          id: 'research',
          type: 'role_task',
          roleId: 'analyst',
          prompt: 'run',
        },
        {
          id: 'native',
          type: 'native_graph',
        },
      ],
      edges: [{ from: 'research', to: '__end__' }],
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.workflows).toEqual([]);
    expect(discovered.errors).toContain(
      'workflow malformed contains invalid node at index 1',
    );
  });

  test('loads local task nodes only when task ids are registered', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-local-task-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: 'Analyst',
        allowedTools: 'send_message',
      },
      'Use structured artifacts before writing.',
    );
    writeWorkflow(workspaceRoot, 'hkipo', {
      id: 'hkipo',
      roles: ['analyst'],
      start: 'ipo_pool_discovery',
      nodes: [
        {
          id: 'ipo_pool_discovery',
          type: 'local_task',
          taskId: 'stock.hkipo.fetch_pool',
          outputArtifact: 'ipo_pool',
        },
        {
          id: 'ranking_report_editor',
          type: 'role_task',
          roleId: 'analyst',
        },
      ],
      edges: [
        { from: 'ipo_pool_discovery', to: 'ranking_report_editor' },
        { from: 'ranking_report_editor', to: '__end__' },
      ],
    });
    writeWorkflow(workspaceRoot, 'broken-local-task', {
      id: 'broken-local-task',
      roles: ['analyst'],
      start: 'crawl',
      nodes: [
        {
          id: 'crawl',
          type: 'local_task',
          taskId: 'shell.rm_everything',
        },
      ],
      edges: [{ from: 'crawl', to: '__end__' }],
    });

    const discovered = (
      discoverWorkflowConfigs as (
        options: Record<string, unknown>,
      ) => ReturnType<typeof discoverWorkflowConfigs>
    )({
      workspaceRoot,
      knownTools: ['send_message'],
      knownLocalTasks: ['stock.hkipo.fetch_pool'],
    });

    expect(discovered.workflows.map((workflow) => workflow.id)).toEqual([
      'hkipo',
    ]);
    expect(discovered.errors).toContain(
      'workflow broken-local-task node crawl references unknown local task shell.rm_everything',
    );
  });

  test('rejects workflows with malformed edges', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-invalid-edge-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: 'Analyst',
        allowedTools: 'send_message',
      },
      'Stay focused.',
    );
    writeWorkflow(workspaceRoot, 'malformed', {
      id: 'malformed',
      roles: ['analyst'],
      start: 'research',
      nodes: [
        {
          id: 'research',
          type: 'role_task',
          roleId: 'analyst',
          prompt: 'run',
        },
      ],
      edges: [{ from: 'research', to: '' }],
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.workflows).toEqual([]);
    expect(discovered.errors).toContain(
      'workflow malformed contains invalid edge at index 0',
    );
  });

  test('rejects workflow graphs with cycles or unreachable nodes', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-invalid-graph-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: 'Analyst',
        allowedTools: 'send_message',
      },
      'Stay focused.',
    );
    writeWorkflow(workspaceRoot, 'cycle', {
      id: 'cycle',
      roles: ['analyst'],
      start: 'first',
      nodes: [
        { id: 'first', type: 'role_task', roleId: 'analyst' },
        { id: 'second', type: 'role_task', roleId: 'analyst' },
      ],
      edges: [
        { from: 'first', to: 'second' },
        { from: 'second', to: 'first' },
      ],
    });
    writeWorkflow(workspaceRoot, 'unreachable', {
      id: 'unreachable',
      roles: ['analyst'],
      start: 'first',
      nodes: [
        { id: 'first', type: 'role_task', roleId: 'analyst' },
        { id: 'orphan', type: 'role_task', roleId: 'analyst' },
      ],
      edges: [{ from: 'first', to: '__end__' }],
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.workflows).toEqual([]);
    expect(discovered.errors).toEqual([
      'workflow cycle contains a cycle',
      'workflow unreachable node orphan is unreachable',
    ]);
  });

  test('loads one workflow by id and reports a clear not-found error', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-load-one-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'qa',
      {
        id: 'qa',
        name: 'QA',
        allowedTools: 'send_message',
      },
      '验证结果是否满足要求。',
    );
    writeWorkflow(workspaceRoot, 'qa-review', {
      id: 'qa-review',
      name: 'QA Review',
      roles: ['qa'],
      start: 'review',
      nodes: [
        {
          id: 'review',
          type: 'role_task',
          roleId: 'qa',
          prompt: 'review',
        },
      ],
      edges: [{ from: 'review', to: '__end__' }],
    });

    expect(
      loadWorkflowDefinition({
        workspaceRoot,
        workflowId: 'qa-review',
        knownTools: ['send_message'],
      })?.workflow,
    ).toMatchObject({ id: 'qa-review', start: 'review' });
    expect(
      loadWorkflowDefinition({
        workspaceRoot,
        workflowId: 'missing',
        knownTools: ['send_message'],
      })?.errors,
    ).toEqual(['workflow missing not found']);
  });

  test('bundled hkipo workflow requires core structure and valuation evidence', () => {
    const repoRoot = process.cwd();
    const workflow = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.agents', 'workflows', 'hkipo.json'),
        'utf-8',
      ),
    ) as { nodes: Array<{ id: string; prompt?: string }> };
    const workflowPrompts = workflow.nodes
      .map((node) => `${node.id}: ${node.prompt ?? ''}`)
      .join('\n');
    const structureRole = fs.readFileSync(
      path.join(
        repoRoot,
        '.agents',
        'agent-roles',
        'hkipo-structure-fundamental-analyst.md',
      ),
      'utf-8',
    );
    const reportRole = fs.readFileSync(
      path.join(
        repoRoot,
        '.agents',
        'agent-roles',
        'hkipo-ranking-report-editor.md',
      ),
      'utf-8',
    );

    expect(workflowPrompts).toContain('structure_evidence');
    expect(workflowPrompts).toContain('valuation_evidence');
    expect(workflowPrompts).toContain('官方文件');
    expect(workflowPrompts).toContain('不把正文全文写入 artifact');
    expect(workflowPrompts).toContain('多源');
    expect(structureRole).toContain('公司核心能力');
    expect(structureRole).toContain('同类股票');
    expect(structureRole).toContain('合理区间');
    expect(reportRole).toContain('绿鞋');
    expect(reportRole).toContain('基石');
    expect(reportRole).toContain('估值区间');
    expect(reportRole).toContain('无同日可用热度证据时，热度分必须为 0/N/A');
    expect(reportRole).toContain('核心因子不足时不要输出精确总分');
    expect(reportRole).toContain('每只 IPO 的 🔥 热度行必须写出具体倍数和来源');
    expect(reportRole).toContain('不要使用“卡：热17”这类内部短码');
  });

  test('bundled stock strategy loop workflow keeps review, value analysis, and planning separated', () => {
    const repoRoot = process.cwd();
    const workflow = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.agents', 'workflows', 'stock-strategy-loop.json'),
        'utf-8',
      ),
    ) as {
      roles: string[];
      nodes: Array<{
        id: string;
        taskId?: string;
        roleId?: string;
        prompt?: string;
      }>;
    };
    const workflowPrompts = workflow.nodes
      .map((node) => `${node.id}: ${node.prompt ?? ''}`)
      .join('\n');

    expect(workflow.roles).toEqual([
      'stock-strategy-task-reviewer',
      'stock-strategy-value-analyst',
      'stock-strategy-iteration-planner',
    ]);
    expect(workflow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'collect_results',
          taskId: 'stock.strategy.collect_results',
        }),
        expect.objectContaining({
          id: 'review_results',
          roleId: 'stock-strategy-task-reviewer',
        }),
        expect.objectContaining({
          id: 'analyze_value',
          taskId: 'stock.strategy.analyze_value',
        }),
        expect.objectContaining({
          id: 'judge_strategy_value',
          roleId: 'stock-strategy-value-analyst',
        }),
        expect.objectContaining({
          id: 'plan_next_iteration',
          roleId: 'stock-strategy-iteration-planner',
        }),
      ]),
    );

    for (const roleId of workflow.roles) {
      const role = fs.readFileSync(
        path.join(repoRoot, '.agents', 'agent-roles', `${roleId}.md`),
        'utf-8',
      );
      expect(role).toContain('禁止真实交易');
      expect(role).toContain('禁止自动 approve');
      expect(role).toContain('禁止自动 activate');
    }

    const plannerRole = fs.readFileSync(
      path.join(
        repoRoot,
        '.agents',
        'agent-roles',
        'stock-strategy-iteration-planner.md',
      ),
      'utf-8',
    );
    expect(workflowPrompts).toContain('change_summary');
    expect(workflowPrompts).toContain('repeat_decision');
    expect(workflowPrompts).toContain('本轮无新增收益证据');
    expect(plannerRole).toContain('本轮增量');
    expect(plannerRole).toContain('change_summary');
    expect(plannerRole).toContain('repeat_decision');
  });

  test('bundled stock strategy discovery workflow is short-cadence and readonly', () => {
    const repoRoot = process.cwd();
    const workflow = JSON.parse(
      fs.readFileSync(
        path.join(
          repoRoot,
          '.agents',
          'workflows',
          'stock-strategy-discovery-loop.json',
        ),
        'utf-8',
      ),
    ) as {
      roles: string[];
      nodes: Array<{
        id: string;
        taskId?: string;
        roleId?: string;
        prompt?: string;
      }>;
    };
    const workflowPrompts = workflow.nodes
      .map((node) => `${node.id}: ${node.prompt ?? ''}`)
      .join('\n');

    expect(workflow.roles).toEqual([
      'stock-strategy-discovery-reviewer',
      'stock-strategy-iteration-planner',
    ]);
    expect(workflow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'collect_results',
          taskId: 'stock.strategy.collect_results',
        }),
        expect.objectContaining({
          id: 'discover_candidates',
          taskId: 'stock.strategy.discovery_cycle',
        }),
        expect.objectContaining({
          id: 'review_discovery',
          roleId: 'stock-strategy-discovery-reviewer',
        }),
        expect.objectContaining({
          id: 'plan_next_iteration',
          roleId: 'stock-strategy-iteration-planner',
        }),
      ]),
    );

    const role = fs.readFileSync(
      path.join(
        repoRoot,
        '.agents',
        'agent-roles',
        'stock-strategy-discovery-reviewer.md',
      ),
      'utf-8',
    );
    expect(role).toContain('按需 discovery worker');
    expect(role).toContain('禁止真实交易');
    expect(role).toContain('禁止自动 approve');
    expect(role).toContain('禁止自动 activate');
    expect(workflowPrompts).toContain('change_summary');
    expect(workflowPrompts).toContain('repeat_decision');
    expect(workflowPrompts).toContain('本轮无新增');
    expect(workflowPrompts).toContain('strategy_usability');
    expect(workflowPrompts).toContain('current_next_run_at');
    expect(workflowPrompts).toContain('next_workflows');
    expect(workflowPrompts).toContain('quality_gate');
    expect(workflowPrompts).toContain('按需 worker');
  });

  test('bundled stock strategy state workflows split US validation, HK design review, and CN coverage check', () => {
    const repoRoot = process.cwd();
    const loadWorkflow = (file: string) =>
      JSON.parse(
        fs.readFileSync(
          path.join(repoRoot, '.agents', 'workflows', file),
          'utf-8',
        ),
      ) as {
        id: string;
        roles: string[];
        nodes: Array<{ id: string; taskId?: string; roleId?: string }>;
      };

    const us = loadWorkflow('stock-strategy-us-candidate-validation.json');
    const hk = loadWorkflow('stock-strategy-hk-design-review.json');
    const cn = loadWorkflow('stock-strategy-cn-coverage-check.json');

    expect(us).toMatchObject({
      id: 'stock-strategy-us-candidate-validation',
      roles: ['stock-strategy-iteration-planner'],
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'validate_candidate',
          taskId: 'stock.strategy.candidate_validation',
        }),
        expect.objectContaining({
          id: 'plan_next_iteration',
          roleId: 'stock-strategy-iteration-planner',
        }),
      ]),
    });
    expect(hk.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'review_design',
          taskId: 'stock.strategy.design_review',
        }),
      ]),
    );
    expect(cn.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'check_coverage',
          taskId: 'stock.strategy.coverage_check',
        }),
      ]),
    );

    const plannerRole = fs.readFileSync(
      path.join(
        repoRoot,
        '.agents',
        'agent-roles',
        'stock-strategy-iteration-planner.md',
      ),
      'utf-8',
    );
    expect(plannerRole).toContain('action');
    expect(plannerRole).toContain('next_workflow');
    expect(plannerRole).toContain('evidence_signature');
    expect(plannerRole).toContain('requires_human');
    expect(plannerRole).toContain('quality_gate');
  });

  test('bundled stock strategy daily progress workflow reports progress without approval side effects', () => {
    const repoRoot = process.cwd();
    const workflow = JSON.parse(
      fs.readFileSync(
        path.join(
          repoRoot,
          '.agents',
          'workflows',
          'stock-strategy-daily-progress-summary.json',
        ),
        'utf-8',
      ),
    ) as {
      id: string;
      roles: string[];
      nodes: Array<{ id: string; taskId?: string; roleId?: string }>;
    };

    expect(workflow).toMatchObject({
      id: 'stock-strategy-daily-progress-summary',
      roles: ['stock-strategy-progress-reporter'],
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'collect_results',
          taskId: 'stock.strategy.collect_results',
        }),
        expect.objectContaining({
          id: 'analyze_value',
          taskId: 'stock.strategy.analyze_value',
        }),
        expect.objectContaining({
          id: 'write_daily_progress',
          roleId: 'stock-strategy-progress-reporter',
        }),
      ]),
    });

    const role = fs.readFileSync(
      path.join(
        repoRoot,
        '.agents',
        'agent-roles',
        'stock-strategy-progress-reporter.md',
      ),
      'utf-8',
    );
    expect(role).toContain('当日完成进度');
    expect(role).toContain('策略挖掘');
    expect(role).toContain('回测');
    expect(role).toContain('模拟盘');
    expect(role).toContain('禁止自动 approve');
    expect(role).toContain('禁止自动 activate');
    expect(role).toContain('禁止真实交易');
  });

  test('bundled stock strategy control and paper validation workflows separate orchestration and quality review', () => {
    const repoRoot = process.cwd();
    const loadWorkflow = (file: string) =>
      JSON.parse(
        fs.readFileSync(
          path.join(repoRoot, '.agents', 'workflows', file),
          'utf-8',
        ),
      ) as {
        id: string;
        roles: string[];
        nodes: Array<{
          id: string;
          taskId?: string;
          roleId?: string;
          prompt?: string;
        }>;
      };

    const control = loadWorkflow('stock-strategy-control-loop.json');
    const paper = loadWorkflow('stock-strategy-paper-validation.json');
    const paperSetup = loadWorkflow('stock-strategy-paper-setup.json');
    const controlPrompts = control.nodes
      .map((node) => `${node.id}: ${node.prompt ?? ''}`)
      .join('\n');
    const paperPrompts = paper.nodes
      .map((node) => `${node.id}: ${node.prompt ?? ''}`)
      .join('\n');
    const paperSetupPrompts = paperSetup.nodes
      .map((node) => `${node.id}: ${node.prompt ?? ''}`)
      .join('\n');

    expect(control).toMatchObject({
      id: 'stock-strategy-control-loop',
      roles: [
        'stock-strategy-quality-reviewer',
        'stock-strategy-chief-orchestrator',
      ],
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'collect_results',
          taskId: 'stock.strategy.collect_results',
        }),
        expect.objectContaining({
          id: 'analyze_value',
          taskId: 'stock.strategy.analyze_value',
        }),
        expect.objectContaining({
          id: 'quality_review',
          roleId: 'stock-strategy-quality-reviewer',
        }),
        expect.objectContaining({
          id: 'coordinate_next_work',
          roleId: 'stock-strategy-chief-orchestrator',
        }),
      ]),
    });
    expect(paper).toMatchObject({
      id: 'stock-strategy-paper-validation',
      roles: [
        'stock-strategy-quality-reviewer',
        'stock-strategy-chief-orchestrator',
      ],
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'collect_results',
          taskId: 'stock.strategy.collect_results',
        }),
        expect.objectContaining({
          id: 'analyze_value',
          taskId: 'stock.strategy.analyze_value',
        }),
        expect.objectContaining({
          id: 'quality_review',
          roleId: 'stock-strategy-quality-reviewer',
        }),
        expect.objectContaining({
          id: 'coordinate_next_work',
          roleId: 'stock-strategy-chief-orchestrator',
        }),
      ]),
    });

    expect(controlPrompts).toContain('next_workflows');
    expect(controlPrompts).toContain('current_next_run_at');
    expect(controlPrompts).toContain('quality_gate');
    expect(controlPrompts).toContain('work_budget');
    expect(controlPrompts).toContain('stock-strategy-paper-validation');
    expect(paperPrompts).toContain('paper/live ledger');
    expect(paperPrompts).toContain('reconciliation');
    expect(paperPrompts).toContain('human_review_ready');
    expect(paperSetup).toMatchObject({
      id: 'stock-strategy-paper-setup',
      roles: [
        'stock-strategy-quality-reviewer',
        'stock-strategy-chief-orchestrator',
      ],
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'collect_results',
          taskId: 'stock.strategy.collect_results',
        }),
        expect.objectContaining({
          id: 'quality_review',
          roleId: 'stock-strategy-quality-reviewer',
        }),
        expect.objectContaining({
          id: 'coordinate_next_work',
          roleId: 'stock-strategy-chief-orchestrator',
        }),
      ]),
    });
    expect(paperSetupPrompts).toContain('simulated trading');
    expect(paperSetupPrompts).toContain('watch');
    expect(paperSetupPrompts).toContain('paper ledger');
    expect(paperSetupPrompts).toContain('stock-strategy-paper-validation');

    for (const roleId of [
      'stock-strategy-quality-reviewer',
      'stock-strategy-chief-orchestrator',
    ]) {
      const role = fs.readFileSync(
        path.join(repoRoot, '.agents', 'agent-roles', `${roleId}.md`),
        'utf-8',
      );
      expect(role).toContain('next_workflows');
      expect(role).toContain('quality_gate');
      expect(role).toContain('current_next_run_at');
      expect(role).toContain('禁止真实交易');
      expect(role).toContain('禁止自动 approve');
      expect(role).toContain('禁止自动 activate');
    }
  });
});
