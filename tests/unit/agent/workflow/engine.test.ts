import { describe, expect, test } from 'vitest';

import {
  buildWorkflowInvokeConfig,
  runWorkflowGraph,
} from '../../../../src/agent/workflow/engine.ts';
import type {
  WorkflowContext,
  WorkflowRun,
} from '../../../../src/domain/types.ts';
import type {
  WorkflowDefinition,
  WorkflowRoleDefinition,
} from '../../../../src/agent/workflow/config.ts';

function makeWorkflow(): WorkflowDefinition {
  return {
    id: 'investment-research',
    name: '投研工作流',
    description: 'research crew',
    roles: ['analyst'],
    start: 'research',
    nodes: [
      {
        id: 'research',
        type: 'role_task',
        roleId: 'analyst',
        outputArtifact: 'research_notes',
        prompt: '围绕用户问题做投研分析',
      },
    ],
    edges: [{ from: 'research', to: '__end__' }],
    maxRetries: 1,
    sourcePath: '/workspace/.agents/workflows/investment-research.json',
  };
}

function makeRole(): WorkflowRoleDefinition {
  return {
    id: 'analyst',
    name: '投研分析师',
    description: '整理公开信息并形成观点',
    allowedTools: ['send_message', 'list_tasks'],
    skillIds: ['stock-analysis-skill'],
    permissionMode: 'readonly',
    instructions: '只输出可溯源的投研结论。',
    sourcePath: '/workspace/.agents/agent-roles/analyst.md',
  };
}

function makeContext(): WorkflowContext {
  return {
    id: 'wfctx_1234567890abcdef1234567890abcdef',
    folder: 'workspace-a',
    workflow_id: 'investment-research',
    thread_id: 'wfctx_1234567890abcdef1234567890abcdef',
    runtime_agent_id: 'workflow:wfctx_1234567890abcdef1234567890abcdef',
    active_run_id: 'wfrun_1',
    metadata: null,
    created_at: '2026-05-17T10:00:00.000Z',
    updated_at: '2026-05-17T10:00:00.000Z',
  };
}

function makeRun(): WorkflowRun {
  return {
    id: 'wfrun_1',
    context_id: 'wfctx_1234567890abcdef1234567890abcdef',
    folder: 'workspace-a',
    workflow_id: 'investment-research',
    thread_id: 'wfctx_1234567890abcdef1234567890abcdef',
    trigger_chat_jid: 'web:workspace-a',
    trigger_message_id: 'msg-1',
    trigger_user_id: 'user-1',
    prompt: '分析英伟达近期风险',
    status: 'running',
    result: null,
    error: null,
    metadata: null,
    started_at: '2026-05-17T10:00:00.000Z',
    completed_at: null,
    created_at: '2026-05-17T10:00:00.000Z',
    updated_at: '2026-05-17T10:00:00.000Z',
  };
}

describe('workflow graph engine', () => {
  test('invokes role nodes through the runner with workflow and role metadata', async () => {
    const workflow = makeWorkflow();
    const role = makeRole();
    const context = makeContext();
    const run = makeRun();
    const runnerInputs: unknown[] = [];
    const stepEvents: unknown[] = [];
    const runEvents: unknown[] = [];

    const result = await runWorkflowGraph({
      workflow,
      roles: new Map([[role.id, role]]),
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
        customCwd: '/workspace',
      },
      context,
      run,
      prompt: '分析英伟达近期风险',
      runner: async (input) => {
        runnerInputs.push(input);
        return {
          status: 'success',
          result: '风险摘要完成',
          newSessionId: 'workflow-session-1',
        };
      },
      recordStep: (step) => {
        stepEvents.push(step);
      },
      updateRunStatus: (runId, update) => {
        runEvents.push({ runId, ...update });
        return { ...run, ...update };
      },
    });

    expect(result.result).toBe('风险摘要完成');
    expect(result.artifacts).toMatchObject({
      research_notes: {
        nodeId: 'research',
        roleId: 'analyst',
        result: '风险摘要完成',
      },
    });
    expect(runnerInputs).toHaveLength(1);
    expect(runnerInputs[0]).toMatchObject({
      groupFolder: 'workspace-a',
      chatJid: 'web:workspace-a',
      agentId: context.runtime_agent_id,
      agentName: '投研分析师',
      allowedTools: ['send_message', 'list_tasks'],
      workflow: {
        id: 'investment-research',
        name: '投研工作流',
        contextId: context.id,
        runId: run.id,
        threadId: context.thread_id,
        nodeId: 'research',
      },
      role: {
        id: 'analyst',
        name: '投研分析师',
        permissionMode: 'readonly',
        skillIds: ['stock-analysis-skill'],
        allowedTools: ['send_message', 'list_tasks'],
      },
    });
    expect(String((runnerInputs[0] as { prompt: string }).prompt)).toContain(
      '只输出可溯源的投研结论。',
    );
    expect(String((runnerInputs[0] as { prompt: string }).prompt)).toContain(
      '围绕用户问题做投研分析',
    );
    expect(String((runnerInputs[0] as { prompt: string }).prompt)).toContain(
      '分析英伟达近期风险',
    );
    expect(stepEvents).toEqual([
      expect.objectContaining({
        runId: run.id,
        nodeId: 'research',
        roleId: 'analyst',
        status: 'running',
        attempt: 1,
      }),
      expect.objectContaining({
        runId: run.id,
        nodeId: 'research',
        roleId: 'analyst',
        status: 'success',
        attempt: 1,
        output: expect.objectContaining({
          result: '风险摘要完成',
          artifactKey: 'research_notes',
        }),
      }),
    ]);
    expect(runEvents).toEqual([
      { runId: run.id, status: 'running' },
      { runId: run.id, status: 'success', result: '风险摘要完成' },
    ]);
  });

  test('uses the workflow context id as the LangGraph thread id', () => {
    const context = makeContext();

    expect(buildWorkflowInvokeConfig(context)).toEqual({
      configurable: {
        thread_id: context.thread_id,
      },
    });
  });

  test('runs local tasks through a registered task runner and exposes artifacts to later roles', async () => {
    const workflow: WorkflowDefinition = {
      id: 'hkipo',
      name: 'HK IPO 工作流',
      description: '港股新股打新 crew',
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
          prompt: '基于 artifacts 生成报告',
        },
      ] as any,
      edges: [
        { from: 'ipo_pool_discovery', to: 'ranking_report_editor' },
        { from: 'ranking_report_editor', to: '__end__' },
      ],
      maxRetries: 0,
      sourcePath: '/workspace/.agents/workflows/hkipo.json',
    };
    const role = makeRole();
    const context = { ...makeContext(), workflow_id: 'hkipo' };
    const run = { ...makeRun(), workflow_id: 'hkipo' };
    const localTaskCalls: unknown[] = [];
    const runnerPrompts: string[] = [];
    const stepEvents: unknown[] = [];

    const result = await runWorkflowGraph({
      workflow,
      roles: new Map([[role.id, role]]),
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
      },
      context,
      run,
      prompt: '筛选当前港股 IPO',
      initialInput: { includeClosed: true },
      localTasks: {
        'stock.hkipo.fetch_pool': async (input: any) => {
          localTaskCalls.push(input);
          return {
            status: 'ok',
            includeClosed: input.input.includeClosed,
            data: [{ code: 'HK.01234', name: 'Demo Robotics' }],
          };
        },
      },
      runner: async (input) => {
        runnerPrompts.push(input.prompt);
        return {
          status: 'success',
          result: '报告已生成',
          newSessionId: 'workflow-session-1',
        };
      },
      recordStep: (step) => {
        stepEvents.push(step);
      },
      updateRunStatus: (runId, update) => ({ ...run, ...update }),
    } as any);

    expect(result.result).toBe('报告已生成');
    expect((result as any).artifacts).toMatchObject({
      ipo_pool: {
        status: 'ok',
        includeClosed: true,
        data: [{ code: 'HK.01234', name: 'Demo Robotics' }],
      },
    });
    expect(localTaskCalls).toEqual([
      expect.objectContaining({
        taskId: 'stock.hkipo.fetch_pool',
        nodeId: 'ipo_pool_discovery',
        input: { includeClosed: true },
      }),
    ]);
    expect(runnerPrompts[0]).toContain('[Structured Artifacts]');
    expect(runnerPrompts[0]).toContain('"ipo_pool"');
    expect(stepEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'ipo_pool_discovery',
          status: 'success',
          output: expect.objectContaining({
            artifactKey: 'ipo_pool',
            artifact: expect.objectContaining({ status: 'ok' }),
          }),
        }),
      ]),
    );
  });
});
