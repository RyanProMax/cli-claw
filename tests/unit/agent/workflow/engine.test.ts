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
        output: { result: '风险摘要完成' },
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
});
