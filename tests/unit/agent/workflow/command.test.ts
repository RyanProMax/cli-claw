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
  const home = tempDir('agent-fabric-workflow-command-home-');
  vi.stubEnv('HOME', home);
  const db = await import('../../../../src/storage/db.ts');
  const command = await import('../../../../src/agent/workflow/command.ts');
  db.initDatabase();
  return { command, db };
}

describe('workflow command execution', () => {
  test('lists workflows from the current workspace', async () => {
    const workspaceRoot = tempDir('agent-fabric-workflow-command-workspace-');
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
    const workspaceRoot = tempDir('agent-fabric-workflow-command-run-');
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
      triggerMessageId: 'msg-trigger-1',
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
          trigger_message_id: 'msg-trigger-1',
          trigger_user_id: 'user-1',
        }),
        checkpointer: expect.any(Object),
      }),
    );

    db.closeDatabase();
  });

  test('passes structured initial input into workflow runs', async () => {
    const workspaceRoot = tempDir('agent-fabric-workflow-command-input-');
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
    const workspaceRoot = tempDir('agent-fabric-workflow-command-background-');
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
    expect(firstResult).toContain('🚀 已启动：投研工作流');
    expect(firstResult).toContain('🧩 Workflow：research');
    expect(firstResult).toContain('🆔 Run：wfrun_');
    expect(firstResult).toContain('📝 任务：分析英伟达');
    expect(firstResult).toContain(
      '📬 完成、失败或超时后，我会回到这里通知你。',
    );
    expect(firstResult).not.toContain('已启动工作流 投研工作流 (research)');
    expect(firstResult).not.toContain('Run: ');
    expect(backgroundResults).toEqual([]);

    await waitForCondition(() => backgroundResults.length === 1);
    expect(backgroundResults[0]).toContain(
      '✅ 工作流 投研工作流 (research) 完成',
    );
    expect(backgroundResults[0]).toContain('投研结论完成');

    db.closeDatabase();
  });

  test('background workflow reports failures and timeouts to the trigger session', async () => {
    const workspaceRoot = tempDir(
      'agent-fabric-workflow-command-background-fail-',
    );
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

    expect(reply).toContain('🚀 已启动：投研工作流');
    expect(reply).toContain('🧩 Workflow：research');
    expect(reply).toContain('🆔 Run：wfrun_');
    expect(reply).toContain('📝 任务：分析英伟达');
    await waitForCondition(() => backgroundResults.length === 1);
    expect(backgroundResults[0]).toContain(
      '❌ 工作流 投研工作流 (research) 失败',
    );
    expect(backgroundResults[0]).toContain(
      'Agent Process timed out after 1800000ms',
    );

    db.closeDatabase();
  });

  test('summarizes transient socket failures instead of exposing raw undici details', async () => {
    const workspaceRoot = tempDir('agent-fabric-workflow-command-socket-fail-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn(async () => {
      throw new Error(
        "Agent process exited with code 1: remoteFamily: 'IPv4', timeout: undefined, Symbol(undici.error.UND_ERR_SOCKET): true",
      );
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
    } as any);

    expect(reply).toContain('❌ 工作流 投研工作流 (research) 失败');
    expect(reply).toContain('Agent runtime socket 异常');
    expect(reply).not.toContain('remoteFamily');
    expect(reply).not.toContain('timeout: undefined');

    db.closeDatabase();
  });

  test('normalizes hkipo final report before delivery', async () => {
    const workspaceRoot = tempDir(
      'agent-fabric-workflow-command-hkipo-report-',
    );
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

  test('normalizes kol final report separators and removes default confidence footer', async () => {
    const workspaceRoot = tempDir('agent-fabric-workflow-command-kol-report-');
    writeFile(
      path.join(workspaceRoot, '.agents', 'agent-roles', 'editor.md'),
      [
        '---',
        'id: editor',
        'name: KOL 编辑',
        'allowedTools: send_message',
        'permissionMode: readonly',
        '---',
        '',
        '输出 KOL 报告。',
      ].join('\n'),
    );
    writeFile(
      path.join(workspaceRoot, '.agents', 'workflows', 'kol.json'),
      JSON.stringify(
        {
          id: 'kol',
          name: '股票 KOL 情报工作流',
          roles: ['editor'],
          start: 'kol_report_editor',
          nodes: [
            {
              id: 'kol_report_editor',
              type: 'role_task',
              roleId: 'editor',
            },
          ],
          edges: [{ from: 'kol_report_editor', to: '__end__' }],
        },
        null,
        2,
      ),
    );
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: '股票 KOL 情报报告',
      result: [
        '**KOL 情报报告｜默认白名单**',
        '窗口：最近 30 天',
        '覆盖：2 位 KOL',
        '覆盖 KOL：Dexter Yang（@dexteryy）、Serenity（@aleabitoreddit）',
        '',
        '🧾 **结论/总结**：本轮最高置信共识仍围绕 AI 基础设施持续扩张 展开，尤其是光互连、CPO、存储、网络芯片和上游半导体链条；多位 KOL 同时给出“需求强、但市场会在细分环节间快速轮动”的信号。与此对应，AI 应用层的商业闭环仍未完全验证，价值更可能先向模型、云、平台入口和高壁垒生态集中。除 AI 主线外，物理 AI/机器人零部件 与 大型药企/精准医疗创新 也出现了较清晰的可跟踪方向。下一步重点核验：1）800G/1.6T、CPO 与激光器/硅光的订单兑现；2）超大厂 CapEx 是否继续上修并传导至 MU、MRVL、AVGO、TSM 等链条；3）AI 应用的付费、留存与成本回收；4）机器人核心零部件客户扩张与量产节奏；5）医药突破能否转化为持续的产品收入与临床里程碑。',
        '',
        '---',
        '**近期投资方向与高信号内容**',
        '',
        '**1. CPO/光互连链条：从概念验证转向订单兑现**',
        '🧭 **核心论点**：订单和产能成为关键。',
        '',
        '🔗 **来源**：',
        '- Dexter Yang：[原文 | x](https://x.com/dexteryy/status/1790000000000000000) [2026-06-01]',
        '',
        '---',
        '',
        '**2. AI 电力：数据中心建设带来电力约束**',
        '🧭 **核心论点**：电力瓶颈继续被交易。',
        '',
        '📝 **观点摘要**：',
        '',
        '- **事实**：电力设备订单仍强。',
        '',
        '- **推断**：电力约束可能继续成为 AI 数据中心建设的交易线索。',
        '',
        '**账号与来源可信度**',
        '- Dexter Yang confirmed；Serenity confirmed。',
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
      argsText: 'kol 股票 KOL 情报报告',
      workspaceRoot,
      runGraph,
    });

    expect(reply).toContain(
      [
        '🧾 **结论/总结**',
        '1. 本轮最高置信共识仍围绕 AI 基础设施持续扩张 展开',
      ].join('\n'),
    );
    expect(reply).toContain(
      [
        '🔍 **下一步重点核验**',
        '1. 800G/1.6T、CPO 与激光器/硅光的订单兑现；',
      ].join('\n'),
    );
    expect(reply).toContain(
      '- Dexter Yang：[原文](https://x.com/dexteryy/status/1790000000000000000) [2026-06-01]\n---\n**2. AI 电力',
    );
    expect(reply).toContain(
      '覆盖 KOL（2）：Dexter Yang（@dexteryy）、Serenity（@aleabitoreddit）',
    );
    expect(reply).not.toContain('覆盖：2 位 KOL');
    expect(reply).not.toContain('覆盖 KOL：Dexter Yang');
    expect(reply).not.toContain('| x');
    expect(reply).not.toContain('\n---\n---\n');
    expect(reply).not.toContain('🧭 **核心论点**：订单和产能成为关键。\n\n🔗');
    expect(reply).not.toContain('📝 **观点摘要**：\n\n- **事实**');
    expect(reply).not.toContain('- **事实**：电力设备订单仍强。\n\n- **推断**');
    expect(reply).not.toContain('账号与来源可信度');
    expect(reply).not.toContain('confirmed');

    db.closeDatabase();
  });

  test('keeps kol source warnings while renaming the old confidence section', async () => {
    const workspaceRoot = tempDir(
      'agent-fabric-workflow-command-kol-warning-report-',
    );
    writeFile(
      path.join(workspaceRoot, '.agents', 'agent-roles', 'editor.md'),
      [
        '---',
        'id: editor',
        'name: KOL 编辑',
        'permissionMode: readonly',
        '---',
        '',
        '输出 KOL 报告。',
      ].join('\n'),
    );
    writeFile(
      path.join(workspaceRoot, '.agents', 'workflows', 'kol.json'),
      JSON.stringify(
        {
          id: 'kol',
          name: '股票 KOL 情报工作流',
          roles: ['editor'],
          start: 'kol_report_editor',
          nodes: [
            {
              id: 'kol_report_editor',
              type: 'role_task',
              roleId: 'editor',
            },
          ],
          edges: [{ from: 'kol_report_editor', to: '__end__' }],
        },
        null,
        2,
      ),
    );
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: '股票 KOL 情报报告',
      result: [
        '🧾 **结论/总结**：暂无高信号。',
        '',
        '**近期投资方向与高信号内容**',
        '',
        '**1. 暂无：等待核验**',
        '',
        '**账号与来源可信度**',
        '- Serenity 原站不可访问，暂不作为主证据。',
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
      argsText: 'kol 股票 KOL 情报报告',
      workspaceRoot,
      runGraph,
    });

    expect(reply).toContain('**来源提醒**\n- Serenity 原站不可访问');
    expect(reply).not.toContain('账号与来源可信度');

    db.closeDatabase();
  });

  test('compacts noisy kol reports to key signals and the first three themes', async () => {
    const workspaceRoot = tempDir('agent-fabric-workflow-command-kol-compact-');
    writeFile(
      path.join(workspaceRoot, '.agents', 'agent-roles', 'editor.md'),
      [
        '---',
        'id: editor',
        'name: KOL 编辑',
        'permissionMode: readonly',
        '---',
        '',
        '输出 KOL 报告。',
      ].join('\n'),
    );
    writeFile(
      path.join(workspaceRoot, '.agents', 'workflows', 'kol.json'),
      JSON.stringify(
        {
          id: 'kol',
          name: '股票 KOL 情报工作流',
          roles: ['editor'],
          start: 'kol_report_editor',
          nodes: [
            {
              id: 'kol_report_editor',
              type: 'role_task',
              roleId: 'editor',
            },
          ],
          edges: [{ from: 'kol_report_editor', to: '__end__' }],
        },
        null,
        2,
      ),
    );
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: '股票 KOL 情报报告',
      result: [
        '**KOL 情报报告｜默认白名单**',
        '窗口：最近 30 天',
        '覆盖 KOL（2）：Dexter Yang（@dexteryy）、Serenity（@aleabitoreddit）',
        '高信号主题：AI 算力、电力设备、医药创新、宏观情绪、消费复苏',
        '',
        '📌 **说明**：以下内容仅为公开信息整理，不构成投资建议，仅供参考。',
        '🧾 **结论/总结**：整体来看市场仍需继续观察，相关方向都值得关注。AI 基础设施订单兑现仍是主线。电力设备和铜连接链条出现多位 KOL 共识。以上内容不构成投资建议，仅供参考。下一步重点核验：1）NVDA/AVGO/CredO 订单能否兑现；2）电网设备订单和毛利率能否同步上修；3）医药创新能否出现临床里程碑；4）继续观察市场情绪。',
        '',
        '---',
        '**近期投资方向与高信号内容**',
        '',
        '**1. AI 算力：订单兑现优先于概念扩散**',
        '🧭 **核心论点**：NVDA、AVGO、TSM 的订单和产能是更可核验的主线。',
        '📝 **观点摘要**：',
        '- **事实**：Dexter Yang 提到 800G/1.6T 需求继续上修。',
        '- **推断**：光模块和交换芯片链条可能继续被交易。',
        '🔗 **来源**：',
        '- Dexter Yang：[AI infra checks](https://x.com/dexteryy/status/1790000000000000000) [2026-06-01]',
        '',
        '---',
        '**2. 电力设备：数据中心 CapEx 外溢**',
        '🧭 **核心论点**：电力约束正在从主题叙事变成订单约束。',
        '🔗 **来源**：',
        '- Serenity：[Grid bottleneck](https://x.com/aleabitoreddit/status/1790000000000000001) [2026-06-02]',
        '',
        '---',
        '**3. 医药创新：大型药企管线催化**',
        '🧭 **核心论点**：LLY、NVO 的临床和产品收入仍是可跟踪变量。',
        '🔗 **来源**：',
        '- Serenity：[Pharma watch](https://x.com/aleabitoreddit/status/1790000000000000002) [2026-06-03]',
        '',
        '---',
        '**4. 宏观情绪：仍需等待确认**',
        '🧭 **核心论点**：整体来看仍需保持关注，后续可能受到多因素影响。',
        '🔗 **来源**：',
        '- Dexter Yang：[Macro](https://x.com/dexteryy/status/1790000000000000003) [2026-06-04]',
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
      argsText: 'kol 股票 KOL 情报报告',
      workspaceRoot,
      runGraph,
    });

    expect(reply).toContain('高信号主题：AI 算力、电力设备、医药创新');
    expect(reply).not.toContain('宏观情绪、消费复苏');
    expect(reply).not.toContain('📌 **说明**');
    expect(reply).not.toContain('不构成投资建议');
    expect(reply).not.toContain('仅供参考');
    expect(reply).not.toContain('整体来看市场仍需继续观察');
    expect(reply).not.toContain('继续观察市场情绪');
    expect(reply).toContain('1. AI 基础设施订单兑现仍是主线。');
    expect(reply).toContain('2. 电力设备和铜连接链条出现多位 KOL 共识。');
    expect(reply).toContain('1. NVDA/AVGO/CredO 订单能否兑现；');
    expect(reply).toContain('3. 医药创新能否出现临床里程碑；');
    expect(reply).toContain('**3. 医药创新：大型药企管线催化**');
    expect(reply).not.toContain('**4. 宏观情绪');

    db.closeDatabase();
  });

  test('does not expose retired stock strategy built-in workflows', async () => {
    const { command, db } = await loadWorkflowCommand();

    const reply = await command.executeWorkflowCommand({
      group: {
        name: '主工作区',
        folder: 'main',
        added_at: '2026-05-27T10:00:00.000Z',
      },
      chatJid: 'web:main',
      argsText: 'stock-strategy-control-loop Route by state.',
      workspaceRoot: process.cwd(),
    });

    expect(reply).toContain('workflow stock-strategy-control-loop not found');

    db.closeDatabase();
  });
});
