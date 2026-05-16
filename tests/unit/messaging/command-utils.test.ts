import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  formatConversationStatus,
  formatImLifecycleStatus,
  formatSelfCheckResult,
  formatSelfRestartAccepted,
  formatSelfRestartSuccess,
  formatSelfStatus,
  formatSystemStatus,
  resolveBoundChatTarget,
  type RegisteredGroupLike,
  type AgentLike,
} from '../../../src/messaging/command-utils.js';

const deleteSessionMock = vi.fn();
const deletePrimaryRuntimeSessionsMock = vi.fn();
const getJidsByFolderMock = vi.fn();
const storeMessageDirectMock = vi.fn();
const ensureChatExistsMock = vi.fn();

vi.mock('../../../src/storage/db.js', () => ({
  deleteSession: deleteSessionMock,
  deletePrimaryRuntimeSessions: deletePrimaryRuntimeSessionsMock,
  getJidsByFolder: getJidsByFolderMock,
  storeMessageDirect: storeMessageDirectMock,
  ensureChatExists: ensureChatExistsMock,
}));

vi.mock('../../../src/core/config.js', () => ({
  DATA_DIR: '/tmp/cli-claw-test',
}));

describe('resolveBoundChatTarget', () => {
  const registeredGroups = new Map<string, RegisteredGroupLike>([
    [
      'web:graduation-jid',
      {
        name: 'graduation',
        folder: 'flow-graduation',
      },
    ],
  ]);

  const agents = new Map<string, AgentLike>([
    [
      'agent-1234',
      {
        name: 'Thesis Agent',
        chat_jid: 'web:graduation-jid',
      },
    ],
  ]);

  const getRegisteredGroup = (jid: string) => registeredGroups.get(jid);
  const getAgent = (id: string) => agents.get(id);
  const findGroupNameByFolder = (folder: string) =>
    folder === 'home-u1' ? 'Home' : folder;

  test('uses the real bound workspace jid for main-conversation bindings', () => {
    const target = resolveBoundChatTarget(
      'feishu:chat-1',
      {
        name: 'Feishu Chat',
        folder: 'home-u1',
        target_main_jid: 'web:graduation-jid',
      },
      getRegisteredGroup,
      getAgent,
      findGroupNameByFolder,
    );

    expect(target).toEqual({
      baseChatJid: 'web:graduation-jid',
      targetChatJid: 'web:graduation-jid',
      folder: 'flow-graduation',
      agentId: null,
      locationLine: 'graduation / 主对话',
    });
  });

  test('uses the agent parent workspace jid for agent bindings', () => {
    const target = resolveBoundChatTarget(
      'feishu:chat-1',
      {
        name: 'Feishu Chat',
        folder: 'home-u1',
        target_agent_id: 'agent-1234',
      },
      getRegisteredGroup,
      getAgent,
      findGroupNameByFolder,
    );

    expect(target).toEqual({
      baseChatJid: 'web:graduation-jid',
      targetChatJid: 'web:graduation-jid#agent:agent-1234',
      folder: 'flow-graduation',
      agentId: 'agent-1234',
      locationLine: 'graduation / Thesis Agent',
    });
  });
});

describe('formatConversationStatus', () => {
  test('marks the current workspace main conversation and explicit main binding', () => {
    expect(
      formatConversationStatus({
        workspace: {
          name: 'Graduation',
          folder: 'flow-graduation',
          agents: [
            { id: 'agent-1234', name: 'Thesis Agent', status: 'idle' },
            { id: 'agent-5678', name: 'Review Agent', status: 'running' },
          ],
        },
        currentAgentId: null,
        currentOnMain: true,
        binding: {
          type: 'main',
          label: 'Graduation / 主对话',
          replyPolicy: 'source_only',
        },
      }),
    ).toBe(
      [
        '🧵 会话与绑定',
        '━━━━━━━━━━',
        '📁 工作区: Graduation (flow-graduation)',
        '🔗 当前绑定: Graduation / 主对话',
        '🔁 回复策略: source_only',
        '💬 会话:',
        '  ▶ 主对话 ← 当前',
        '  · Thesis Agent [agen] idle',
        '  · Review Agent [agen] running',
      ].join('\n'),
    );
  });

  test('marks the bound conversation agent as current', () => {
    expect(
      formatConversationStatus({
        workspace: {
          name: 'Home',
          folder: 'home-u1',
          agents: [
            { id: 'agent-1234', name: 'Thesis Agent', status: 'running' },
          ],
        },
        currentAgentId: 'agent-1234',
        currentOnMain: false,
        binding: {
          type: 'agent',
          label: 'Home / Thesis Agent',
          replyPolicy: 'source_only',
        },
      }),
    ).toBe(
      [
        '🧵 会话与绑定',
        '━━━━━━━━━━',
        '📁 工作区: Home (home-u1)',
        '🔗 当前绑定: Home / Thesis Agent',
        '🔁 回复策略: source_only',
        '💬 会话:',
        '  · 主对话',
        '  ▶ Thesis Agent [agen] running ← 当前',
      ].join('\n'),
    );
  });
});

describe('formatSystemStatus', () => {
  test('renders the IM status template with agent and runtime sections', () => {
    expect(
      formatSystemStatus(
        {
          activeContainerCount: 0,
          activeHostProcessCount: 0,
          maxContainers: 20,
          maxHostProcesses: 5,
          waitingCount: 0,
          waitingGroupJids: [],
        },
        false,
        null,
        {
          agentType: 'openai',
          model: 'gpt-5.4',
          reasoningEffort: 'xhigh',
          speedTier: 'fast',
          primaryRemaining: '42%',
          primaryReset: '2026-04-13 02:09',
          secondaryRemaining: '75%',
          secondaryReset: '2026-04-19 11:50',
          workspaceName: '主工作区',
          currentSessionName: '主对话',
          sessionCount: 3,
          cwd: '/Users/ryan/projects/cli-claw',
        },
      ),
    ).toBe(
      [
        '🤖 Agent',
        '━━━━━━━━━━',
        '🤖 当前 Agent: openai',
        '🧠 当前模型: gpt-5.4',
        '⚙️ 当前推理强度: xhigh',
        '🚀 当前速度: fast (2x)',
        '⏳ 5h 剩余: 42%（重置时间：2026-04-13 02:09）',
        '📅 7d 剩余: 75%（重置时间：2026-04-19 11:50）',
        '',
        '📊 运行状态',
        '━━━━━━━━━━',
        '🗂️ 当前工作区: 主工作区',
        '💬 当前会话: 主对话',
        '🔢 会话数: 3',
        '⚡ 状态: 空闲',
        '📦 负载: 0/20 容器, 0/5 进程',
        '📍 cwd: /Users/ryan/projects/cli-claw',
      ].join('\n'),
    );
  });
});

describe('formatImLifecycleStatus', () => {
  test('renders compact recent Feishu lifecycle evidence', () => {
    expect(
      formatImLifecycleStatus([
        {
          id: 3,
          provider: 'feishu',
          chat_jid: 'feishu:chat-1',
          source_jid: 'feishu:chat-1',
          message_id: 'om_recent_message_003',
          stage: 'notified',
          status: 'ok',
          reason: null,
          details: null,
          created_at: '2026-04-25T12:20:03.000Z',
        },
        {
          id: 2,
          provider: 'feishu',
          chat_jid: 'feishu:chat-1',
          source_jid: 'feishu:chat-1',
          message_id: 'om_recent_message_002',
          stage: 'skipped',
          status: 'skipped',
          reason: 'stale_before_reconnection',
          details: null,
          created_at: '2026-04-25T12:20:02.000Z',
        },
      ]),
    ).toBe(
      '🧭 飞书链路: ...message_003 notified · ...message_002 skipped(stale_before_reconnection)',
    );
  });

  test('renders recent non-ok Feishu lifecycle issues separately', () => {
    expect(
      formatImLifecycleStatus(
        [
          {
            id: 4,
            provider: 'feishu',
            chat_jid: 'web:main',
            source_jid: 'feishu:chat-1',
            message_id: 'om_recent_ok',
            stage: 'cursor_committed',
            status: 'ok',
            reason: null,
            details: null,
            created_at: '2026-04-25T12:20:04.000Z',
          },
        ],
        [
          {
            id: 3,
            provider: 'feishu',
            chat_jid: 'web:main',
            source_jid: 'feishu:chat-1',
            message_id: 'om_failed_delivery',
            stage: 'im_delivered',
            status: 'error',
            reason: 'send_failed_after_retries',
            details: null,
            created_at: '2026-04-25T12:20:03.000Z',
          },
          {
            id: 2,
            provider: 'feishu',
            chat_jid: 'feishu:chat-1',
            source_jid: 'feishu:chat-1',
            message_id: 'om_mention_skipped',
            stage: 'skipped',
            status: 'skipped',
            reason: 'require_mention',
            details: null,
            created_at: '2026-04-25T12:20:02.000Z',
          },
        ],
      ),
    ).toBe(
      [
        '🧭 飞书链路: ...m_recent_ok cursor_committed',
        '⚠️ 飞书异常: ...ed_delivery im_delivered error(send_failed_after_retries)',
      ].join('\n'),
    );
  });

  test('keeps empty lifecycle status short', () => {
    expect(formatImLifecycleStatus([])).toBe('🧭 飞书链路: 最近无记录');
  });
});

describe('formatSelfStatus', () => {
  test('summarizes the running service and stale build state concisely', () => {
    expect(
      formatSelfStatus({
        pid: 1234,
        startedAt: '2026-04-12T12:00:00.000Z',
        cwd: '/Users/ryan/projects/cli-claw',
        stale: true,
        backend: {
          stale: true,
          loadedMtimeIso: '2026-04-12T11:00:00.000Z',
          currentMtimeIso: '2026-04-12T12:10:00.000Z',
        },
        agentRunner: {
          stale: false,
          loadedMtimeIso: '2026-04-12T11:00:00.000Z',
          currentMtimeIso: '2026-04-12T11:00:00.000Z',
        },
        lastCheck: null,
        restart: {
          restartable: true,
          source: 'cli_start',
          displayCommand:
            '/usr/local/bin/node /Users/ryan/projects/cli-claw/dist/cli.js start',
          validationError: null,
        },
      } as any),
    ).toBe(
      [
        '🧭 自迭代状态',
        '━━━━━━━━━━',
        '🆔 PID: 1234',
        '⏱️ 启动: 2026-04-12T12:00:00.000Z',
        '📂 cwd: /Users/ryan/projects/cli-claw',
        '🔁 自重启: 可用 (cli_start)',
        '🚀 启动命令: /usr/local/bin/node /Users/ryan/projects/cli-claw/dist/cli.js start',
        '📦 build: 需要重启',
        '  backend: stale 2026-04-12T11:00:00.000Z → 2026-04-12T12:10:00.000Z',
        '  agent-runner: ok 2026-04-12T11:00:00.000Z',
        '🧪 最近自检: 未运行',
        '💡 /self-check 冷启动验证，不会重启当前服务',
      ].join('\n'),
    );
  });

  test('surfaces recent Feishu lifecycle issues in self status', () => {
    expect(
      formatSelfStatus({
        pid: 1234,
        startedAt: '2026-04-12T12:00:00.000Z',
        cwd: '/Users/ryan/projects/cli-claw',
        stale: false,
        backend: {
          stale: false,
          loadedMtimeIso: '2026-04-12T11:00:00.000Z',
          currentMtimeIso: '2026-04-12T11:00:00.000Z',
        },
        agentRunner: {
          stale: false,
          loadedMtimeIso: '2026-04-12T11:00:00.000Z',
          currentMtimeIso: '2026-04-12T11:00:00.000Z',
        },
        lastCheck: null,
        restart: {
          restartable: true,
          source: 'direct_backend',
          displayCommand: '/Users/ryan/.bun/bin/bun src/index.ts',
          validationError: null,
        },
        feishuIssueEvents: [
          {
            id: 3,
            provider: 'feishu',
            chat_jid: 'web:main',
            source_jid: 'feishu:oc_abc123',
            message_id: 'om_failed_delivery',
            stage: 'im_delivered',
            status: 'error',
            reason: 'send_failed_after_retries',
            details: null,
            created_at: '2026-04-25T12:20:03.000Z',
          },
          {
            id: 2,
            provider: 'feishu',
            chat_jid: 'feishu:oc_def456',
            source_jid: 'feishu:oc_def456',
            message_id: 'om_require_mention',
            stage: 'skipped',
            status: 'skipped',
            reason: 'require_mention',
            details: null,
            created_at: '2026-04-25T12:20:02.000Z',
          },
        ],
      } as any),
    ).toContain(
      '⚠️ 飞书异常: ...ed_delivery im_delivered error(send_failed_after_retries)',
    );
  });

  test('warns when the service is running through direct backend launch', () => {
    const status = formatSelfStatus({
      pid: 1234,
      startedAt: '2026-04-12T12:00:00.000Z',
      cwd: '/Users/ryan/projects/cli-claw',
      stale: false,
      backend: {
        stale: false,
        loadedMtimeIso: '2026-04-12T11:00:00.000Z',
        currentMtimeIso: '2026-04-12T11:00:00.000Z',
      },
      agentRunner: {
        stale: false,
        loadedMtimeIso: '2026-04-12T11:00:00.000Z',
        currentMtimeIso: '2026-04-12T11:00:00.000Z',
      },
      lastCheck: null,
      restart: {
        restartable: true,
        source: 'direct_backend',
        displayCommand: '/Users/ryan/.bun/bin/bun src/index.ts',
        validationError: null,
      },
    } as any);

    expect(status).toContain('⚠️ 启动模式: direct_backend 是开发直启路径');
    expect(status).toContain('✅ 推荐入口: cli-claw start / cli-claw restart');
  });

  test('marks source-launched services without implying dist build freshness', () => {
    const status = formatSelfStatus({
      pid: 1234,
      startedAt: '2026-04-12T12:00:00.000Z',
      cwd: '/Users/ryan/projects/cli-claw',
      stale: false,
      backend: {
        stale: false,
        loadedMtimeIso: '2026-04-12T11:00:00.000Z',
        currentMtimeIso: '2026-04-12T11:00:00.000Z',
      },
      agentRunner: {
        stale: false,
        loadedMtimeIso: '2026-04-12T11:00:00.000Z',
        currentMtimeIso: '2026-04-12T11:00:00.000Z',
      },
      lastCheck: null,
      restart: {
        restartable: true,
        source: 'cli_start',
        artifactMode: 'source',
        displayCommand: '/Users/ryan/.bun/bin/bun src/cli.ts start',
        validationError: null,
      },
    } as any);

    expect(status).toContain(
      '⚠️ 启动模式: repo-local source launcher 是开发入口',
    );
    expect(status).toContain('✅ 推荐入口: cli-claw start / cli-claw restart');
    expect(status).toContain('📦 build: 源码运行，dist build 仅供打包参考');
    expect(status).not.toContain('📦 build: 已是当前 build');
  });
});

describe('formatSelfCheckResult', () => {
  test('formats a passed shadow-start check', () => {
    expect(
      formatSelfCheckResult({
        status: 'passed',
        startedAt: '2026-04-12T12:01:00.000Z',
        finishedAt: '2026-04-12T12:01:03.000Z',
        durationMs: 3000,
        port: 3101,
        command: 'node',
        args: ['/repo/dist/index.js'],
        cwd: '/repo',
        tempHome: '/tmp/cli-claw-self-check-abc',
        healthUrl: 'http://127.0.0.1:3101/api/health',
        error: null,
        exitCode: null,
        signal: null,
        outputTail: [],
      }),
    ).toBe(
      [
        '🧪 自检结果: 通过',
        '━━━━━━━━━━',
        '⏱️ 耗时: 3000ms',
        '🚀 候选命令: node /repo/dist/index.js',
        '🌐 端口: 3101',
        '📂 隔离 HOME: /tmp/cli-claw-self-check-abc',
        '✅ 候选服务冷启动健康，当前服务未重启',
      ].join('\n'),
    );
  });

  test('formats a failed shadow-start check with the failure reason', () => {
    expect(
      formatSelfCheckResult({
        status: 'failed',
        startedAt: '2026-04-12T12:01:00.000Z',
        finishedAt: '2026-04-12T12:01:03.000Z',
        durationMs: 3000,
        port: 3101,
        command: 'node',
        args: ['/repo/dist/index.js'],
        cwd: '/repo',
        tempHome: '/tmp/cli-claw-self-check-abc',
        healthUrl: 'http://127.0.0.1:3101/api/health',
        error: 'candidate exited before health check passed',
        exitCode: 1,
        signal: null,
        outputTail: ['Error: bad config'],
      }),
    ).toBe(
      [
        '🧪 自检结果: 失败',
        '━━━━━━━━━━',
        '⏱️ 耗时: 3000ms',
        '🚀 候选命令: node /repo/dist/index.js',
        '🌐 端口: 3101',
        '📂 隔离 HOME: /tmp/cli-claw-self-check-abc',
        '❌ 原因: candidate exited before health check passed',
        '🚪 退出: code=1',
        '📜 输出:',
        'Error: bad config',
      ].join('\n'),
    );
  });
});

describe('formatSelfRestartAccepted', () => {
  test('formats the watchdog intent location and warning', () => {
    expect(
      formatSelfRestartAccepted({
        intentPath: '/Users/ryan/.cli-claw/ops/restarts/restart-abc.json',
        watchdogPid: 4321,
      }),
    ).toBe(
      [
        '🔁 自重启已受理',
        '━━━━━━━━━━',
        '🧾 intent: /Users/ryan/.cli-claw/ops/restarts/restart-abc.json',
        '👁️ watchdog PID: 4321',
        '💬 重启成功后会回到当前会话补发结果',
        '⚠️ 后续由独立 watchdog 执行；当前 IM 可能短暂离线',
      ].join('\n'),
    );
  });
});

describe('formatSelfRestartSuccess', () => {
  test('formats the restart success message with service status and residual summary', () => {
    expect(
      formatSelfRestartSuccess({
        intentPath: '/Users/ryan/.cli-claw/ops/restarts/restart-abc.json',
        selfStatus: '🧭 自迭代状态\n🆔 PID: 17510',
        residualSummary:
          '🧹 残留检查: backend 1 个（额外 0），runner 2 个（孤儿 0）',
      }),
    ).toBe(
      [
        '✅ 自重启成功',
        '━━━━━━━━━━',
        '🧾 intent: /Users/ryan/.cli-claw/ops/restarts/restart-abc.json',
        '🧭 自迭代状态\n🆔 PID: 17510',
        '🧹 残留检查: backend 1 个（额外 0），runner 2 个（孤儿 0）',
      ].join('\n'),
    );
  });
});

describe('executeSessionReset', () => {
  beforeEach(() => {
    deleteSessionMock.mockReset();
    deletePrimaryRuntimeSessionsMock.mockReset();
    getJidsByFolderMock.mockReset();
    storeMessageDirectMock.mockReset();
    ensureChatExistsMock.mockReset();
    vi.useRealTimers();
  });

  test('resets a bound conversation agent under the real workspace jid', async () => {
    const { executeSessionReset } = await import('../../../src/commands.js');
    const stopGroup = vi.fn(async () => {});
    const broadcast = vi.fn();
    const setLastAgentTimestamp = vi.fn();
    const sessions = { 'flow-graduation': 'session-1' } as Record<
      string,
      string
    >;

    await executeSessionReset(
      'web:graduation-jid',
      'flow-graduation',
      {
        queue: { stopGroup },
        sessions,
        broadcast,
        setLastAgentTimestamp,
      },
      'agent-1234',
    );

    expect(stopGroup).toHaveBeenCalledWith(
      'web:graduation-jid#agent:agent-1234',
      { force: true },
    );
    expect(ensureChatExistsMock).toHaveBeenCalledWith(
      'web:graduation-jid#agent:agent-1234',
    );
    expect(setLastAgentTimestamp).toHaveBeenCalledWith(
      'web:graduation-jid#agent:agent-1234',
      expect.objectContaining({ id: expect.any(String) }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      'web:graduation-jid#agent:agent-1234',
      expect.objectContaining({
        chat_jid: 'web:graduation-jid#agent:agent-1234',
      }),
    );
    expect(deleteSessionMock).toHaveBeenCalledWith(
      'flow-graduation',
      'agent-1234',
    );
    expect(deletePrimaryRuntimeSessionsMock).not.toHaveBeenCalled();
  });

  test('resets all primary runtime session slots for a main workspace clear', async () => {
    const { executeSessionReset } = await import('../../../src/commands.js');
    const stopGroup = vi.fn(async () => {});
    const broadcast = vi.fn();
    const setLastAgentTimestamp = vi.fn();
    const sessions = { 'flow-graduation': 'web-session-1' } as Record<
      string,
      string
    >;
    getJidsByFolderMock.mockReturnValue([
      'web:graduation-jid',
      'feishu:chat-1',
    ]);

    await executeSessionReset('web:graduation-jid', 'flow-graduation', {
      queue: { stopGroup },
      sessions,
      broadcast,
      setLastAgentTimestamp,
    });

    expect(deletePrimaryRuntimeSessionsMock).toHaveBeenCalledWith(
      'flow-graduation',
    );
    expect(deleteSessionMock).not.toHaveBeenCalled();
    expect(sessions).not.toHaveProperty('flow-graduation');
  });
});
