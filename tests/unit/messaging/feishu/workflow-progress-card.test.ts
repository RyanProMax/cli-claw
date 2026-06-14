import { describe, expect, test, vi } from 'vitest';

import { FeishuWorkflowProgressReporter } from '../../../../src/messaging/providers/feishu/workflow-progress-card.ts';
import type { WorkflowDefinition } from '../../../../src/agent/workflow/config.ts';
import type {
  WorkflowRun,
  WorkflowRunStep,
} from '../../../../src/domain/types.ts';

function makeClient() {
  const createdCards: any[] = [];
  const updatedCards: any[] = [];
  const messageCreateSpy = vi.fn(async () => ({
    data: { message_id: 'msg-workflow-progress' },
  }));
  return {
    createdCards,
    updatedCards,
    messageCreateSpy,
    client: {
      cardkit: {
        v1: {
          card: {
            create: vi.fn(async ({ data }: any) => {
              createdCards.push(JSON.parse(data.data));
              return { data: { card_id: 'card-workflow-progress' } };
            }),
            update: vi.fn(async ({ data }: any) => {
              updatedCards.push(JSON.parse(data.card.data));
              return { data: {} };
            }),
          },
        },
      },
      im: {
        v1: {
          message: {
            create: messageCreateSpy,
          },
        },
      },
    },
  };
}

function workflow(): WorkflowDefinition {
  return {
    id: 'status-matrix',
    name: '状态矩阵工作流',
    description: '',
    roles: [],
    start: 'pending_node',
    nodes: [
      { id: 'pending_node', type: 'local_task', taskId: 'test.pending' },
      { id: 'running_node', type: 'local_task', taskId: 'test.running' },
      { id: 'success_node', type: 'local_task', taskId: 'test.success' },
      { id: 'error_node', type: 'local_task', taskId: 'test.error' },
      { id: 'degraded_node', type: 'local_task', taskId: 'test.degraded' },
      { id: 'skipped_node', type: 'local_task', taskId: 'test.skipped' },
    ],
    edges: [],
    maxRetries: 0,
    sourcePath: '/workspace/.agents/workflows/status-matrix.json',
  };
}

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'wfrun_status_matrix',
    context_id: 'wfctx_status_matrix',
    folder: 'workspace-a',
    workflow_id: 'status-matrix',
    thread_id: 'wfctx_status_matrix',
    trigger_chat_jid: 'feishu:oc_status_matrix',
    trigger_message_id: 'om_status_matrix',
    trigger_user_id: 'ou_status_matrix',
    prompt: '覆盖所有状态',
    status: 'running',
    result: null,
    error: null,
    metadata: null,
    started_at: '2026-05-17T10:00:00.000Z',
    completed_at: null,
    created_at: '2026-05-17T10:00:00.000Z',
    updated_at: '2026-05-17T10:00:01.000Z',
    ...overrides,
  };
}

function step(
  nodeId: string,
  status: WorkflowRunStep['status'],
  overrides: Partial<WorkflowRunStep> = {},
): WorkflowRunStep {
  return {
    id: `wfstep_${nodeId}`,
    run_id: 'wfrun_status_matrix',
    node_id: nodeId,
    role_id: null,
    status,
    attempt: 1,
    input: null,
    output: null,
    error: null,
    started_at: '2026-05-17T10:00:01.000Z',
    completed_at: status === 'running' ? null : '2026-05-17T10:00:03.000Z',
    created_at: '2026-05-17T10:00:01.000Z',
    updated_at: '2026-05-17T10:00:03.000Z',
    ...overrides,
  };
}

describe('Feishu workflow progress card', () => {
  test('renders pending, running, success, error, degraded, and skipped node states', async () => {
    const { client, createdCards, updatedCards } = makeClient();
    const reporter = new FeishuWorkflowProgressReporter({
      client: client as any,
      chatId: 'oc_status_matrix',
    });

    await reporter.onRunCreated({
      workflow: workflow(),
      roles: new Map(),
      run: run(),
      prompt: '覆盖所有状态',
    });
    await reporter.onStep(step('running_node', 'running'));
    await reporter.onStep(
      step('success_node', 'success', {
        output: { result: '普通节点完成' },
      }),
    );
    await reporter.onStep(
      step('error_node', 'error', {
        error: '节点失败',
      }),
    );
    await reporter.onStep(
      step('degraded_node', 'success', {
        output: {
          artifact: {
            status: 'degraded',
            reason: '外部数据源失败',
          },
        },
      }),
    );
    await reporter.onStep(step('skipped_node', 'skipped'));
    await reporter.onRunStatus(
      run({
        status: 'error',
        error: 'workflow failed',
        completed_at: '2026-05-17T10:00:05.000Z',
        updated_at: '2026-05-17T10:00:05.000Z',
      }),
    );
    await reporter.waitForIdle();

    const payload = JSON.stringify([...createdCards, ...updatedCards]);
    expect(payload).toContain('待处理');
    expect(payload).toContain('运行中');
    expect(payload).toContain('已完成');
    expect(payload).toContain('失败');
    expect(payload).toContain('降级完成');
    expect(payload).toContain('已跳过');
    expect(payload).toContain('耗时');
    expect(payload).toContain('外部数据源失败');
    expect(payload).toContain('Workflow 进度｜状态矩阵工作流');
    expect(payload).toContain('📌 状态：失败');
    expect(payload).toContain('🧩 节点：6');
    expect(payload).toContain('**3. ✅ success_node**<br>');
    expect(payload).toContain('🧾 内容：普通节点完成');
    expect(payload).toContain('🧩 本地任务：`test.success`');
    expect(payload).not.toContain('3. ✅ **success_node**');
    expect(payload).not.toContain(
      '状态：已完成 · 耗时：2s\\n内容：普通节点完成',
    );

    const finalCard = updatedCards.at(-1) ?? createdCards.at(-1);
    const elements = finalCard.body.elements as Array<{
      tag: string;
      content?: string;
    }>;
    const titleElement = elements[0];
    expect(titleElement.content).toContain('Workflow 进度｜状态矩阵工作流');
    expect(titleElement.content).toBe('## ❌ Workflow 进度｜状态矩阵工作流');
    expect(titleElement.content).not.toContain('#####');
    expect(titleElement.content).not.toContain('<br>');
    const dividerIndex = elements.findIndex(
      (element) => element.content === '---',
    );
    const headerContent = elements
      .slice(0, dividerIndex)
      .map((element) => element.content)
      .join('\n');
    expect(headerContent).not.toContain('🆔 Run');
    expect(headerContent).not.toContain('🔄 更新');
    expect(headerContent).not.toContain('📝 任务');
    expect(elements[1].content).toContain('📌 状态：失败');
    expect(elements[1].content).toContain('🧩 节点：6');
    expect(elements[1].content).toContain('⏱️ 总耗时：5s');
    expect(elements[1].content).toContain('🕘 开始：');
    expect(payload).toContain('最后更新');
  });

  test('keeps long role report bodies out of the progress card', async () => {
    const { client, createdCards, updatedCards } = makeClient();
    const reporter = new FeishuWorkflowProgressReporter({
      client: client as any,
      chatId: 'oc_status_matrix',
    });
    const reportWorkflow: WorkflowDefinition = {
      ...workflow(),
      nodes: [
        {
          id: 'kol_report_editor',
          type: 'role_task',
          roleId: 'kol-intel-reporter',
          outputArtifact: 'final_report',
        },
      ] as any,
    };

    await reporter.onRunCreated({
      workflow: reportWorkflow,
      roles: new Map([
        [
          'kol-intel-reporter',
          {
            id: 'kol-intel-reporter',
            name: '股票 KOL 情报编辑',
            description: '',
            instructions: '',
            allowedTools: [],
            skillIds: [],
            permissionMode: 'readonly',
            sourcePath: '/workspace/.agents/agent-roles/kol.md',
          },
        ],
      ]),
      run: run(),
      prompt: '股票 KOL 情报报告',
    });
    await reporter.onStep(
      step('kol_report_editor', 'success', {
        output: {
          result: [
            '**KOL 情报报告｜默认白名单**',
            '窗口：最近 30 天',
            '覆盖 KOL（7）：Dexter Yang（@dexteryy）、Serenity（@aleabitoreddit）',
            '高信号主题：暂无满足原文核验条件的高信号主题',
          ].join('\n'),
        },
      }),
    );
    await reporter.waitForIdle();

    const payload = JSON.stringify([...createdCards, ...updatedCards]);
    expect(payload).toContain('🧾 内容：报告已生成，完整内容见下方终态消息。');
    expect(payload).not.toContain('覆盖 KOL（7）');
    expect(payload).not.toContain('暂无满足原文核验条件');
  });

  test('retries sending the visible card message when initial message creation fails after CardKit create', async () => {
    const { client, createdCards, updatedCards, messageCreateSpy } =
      makeClient();
    const onCardCreated = vi.fn();
    messageCreateSpy
      .mockRejectedValueOnce(new Error('message create failed'))
      .mockResolvedValueOnce({ data: { message_id: 'msg-workflow-retry' } });
    const reporter = new FeishuWorkflowProgressReporter({
      client: client as any,
      chatId: 'oc_status_matrix',
      onCardCreated,
    });

    await reporter.onRunCreated({
      workflow: workflow(),
      roles: new Map(),
      run: run(),
      prompt: '覆盖所有状态',
    });
    await reporter.waitForIdle();

    expect(createdCards).toHaveLength(1);
    expect(messageCreateSpy).toHaveBeenCalledTimes(1);
    expect(onCardCreated).not.toHaveBeenCalled();

    await reporter.onRunStatus(
      run({
        status: 'running',
        updated_at: '2026-05-17T10:00:02.000Z',
      }),
    );
    await reporter.waitForIdle();

    expect(createdCards).toHaveLength(1);
    expect(updatedCards).toHaveLength(1);
    expect(messageCreateSpy).toHaveBeenCalledTimes(2);
    expect(messageCreateSpy.mock.calls[1]?.[0]).toMatchObject({
      data: {
        receive_id: 'oc_status_matrix',
        msg_type: 'interactive',
      },
    });
    expect(messageCreateSpy.mock.calls[1]?.[0].data.content).toContain(
      '"card_id":"card-workflow-progress"',
    );
    expect(onCardCreated).toHaveBeenCalledWith('msg-workflow-retry');
  });
});
