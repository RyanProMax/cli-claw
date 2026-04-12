import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  formatConversationStatus,
  resolveBoundChatTarget,
  type RegisteredGroupLike,
  type AgentLike,
} from '../src/im-command-utils.js';

const deleteSessionMock = vi.fn();
const getJidsByFolderMock = vi.fn();
const storeMessageDirectMock = vi.fn();
const ensureChatExistsMock = vi.fn();

vi.mock('../src/db.js', () => ({
  deleteSession: deleteSessionMock,
  getJidsByFolder: getJidsByFolderMock,
  storeMessageDirect: storeMessageDirectMock,
  ensureChatExists: ensureChatExistsMock,
}));

vi.mock('../src/config.js', () => ({
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

describe('executeSessionReset', () => {
  beforeEach(() => {
    deleteSessionMock.mockReset();
    getJidsByFolderMock.mockReset();
    storeMessageDirectMock.mockReset();
    ensureChatExistsMock.mockReset();
    vi.useRealTimers();
  });

  test('resets a bound conversation agent under the real workspace jid', async () => {
    const { executeSessionReset } = await import('../src/commands.js');
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
  });
});
