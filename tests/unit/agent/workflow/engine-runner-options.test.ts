import { describe, expect, test, vi } from 'vitest';

const runAgentProcessMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/agent/runner/container-runner.js', () => ({
  runAgentProcess: runAgentProcessMock,
}));

import { runWorkflowGraph } from '../../../../src/agent/workflow/engine.ts';
import type {
  WorkflowDefinition,
  WorkflowRoleDefinition,
} from '../../../../src/agent/workflow/config.ts';
import type {
  WorkflowContext,
  WorkflowRun,
} from '../../../../src/domain/types.ts';

function makeWorkflow(id: string): WorkflowDefinition {
  return {
    id,
    name: id === 'hkipo' ? '港股 IPO 打新工作流' : '投研工作流',
    description: 'test workflow',
    roles: ['analyst'],
    start: 'research',
    nodes: [
      {
        id: 'research',
        type: 'role_task',
        roleId: 'analyst',
      },
    ],
    edges: [{ from: 'research', to: '__end__' }],
    maxRetries: 0,
    sourcePath: `/workspace/.agents/workflows/${id}.json`,
  };
}

function makeRole(): WorkflowRoleDefinition {
  return {
    id: 'analyst',
    name: '分析师',
    description: 'test analyst',
    allowedTools: [],
    skillIds: [],
    permissionMode: 'readonly',
    instructions: '输出结果。',
    sourcePath: '/workspace/.agents/agent-roles/analyst.md',
  };
}

function makeContext(workflowId: string): WorkflowContext {
  return {
    id: `wfctx_${workflowId}`,
    folder: 'workspace-a',
    workflow_id: workflowId,
    thread_id: `wfctx_${workflowId}`,
    runtime_agent_id: `workflow:wfctx_${workflowId}`,
    active_run_id: 'wfrun_1',
    metadata: null,
    created_at: '2026-05-20T10:00:00.000Z',
    updated_at: '2026-05-20T10:00:00.000Z',
  };
}

function makeRun(workflowId: string): WorkflowRun {
  return {
    id: 'wfrun_1',
    context_id: `wfctx_${workflowId}`,
    folder: 'workspace-a',
    workflow_id: workflowId,
    thread_id: `wfctx_${workflowId}`,
    trigger_chat_jid: 'web:workspace-a',
    trigger_message_id: 'msg-1',
    trigger_user_id: 'user-1',
    prompt: 'run workflow',
    status: 'running',
    result: null,
    error: null,
    metadata: null,
    started_at: '2026-05-20T10:00:00.000Z',
    completed_at: null,
    created_at: '2026-05-20T10:00:00.000Z',
    updated_at: '2026-05-20T10:00:00.000Z',
  };
}

describe('workflow graph runner options', () => {
  test('caps hkipo role agent process runtime without changing generic workflows', async () => {
    runAgentProcessMock.mockResolvedValue({
      status: 'success',
      result: 'done',
    });

    for (const workflowId of ['hkipo', 'research']) {
      await runWorkflowGraph({
        workflow: makeWorkflow(workflowId),
        roles: new Map([['analyst', makeRole()]]),
        group: {
          name: 'Workspace A',
          folder: 'workspace-a',
          added_at: '2026-05-20T10:00:00.000Z',
        },
        context: makeContext(workflowId),
        run: makeRun(workflowId),
        prompt: 'run workflow',
        recordStep: () => undefined,
        updateRunStatus: (runId, update) => ({
          ...makeRun(workflowId),
          ...update,
        }),
      });
    }

    expect(runAgentProcessMock).toHaveBeenCalledTimes(2);
    expect(runAgentProcessMock.mock.calls[0][4]).toMatchObject({
      processTimeoutMs: 180_000,
    });
    expect(runAgentProcessMock.mock.calls[1][4]).not.toHaveProperty(
      'processTimeoutMs',
    );
  });
});
