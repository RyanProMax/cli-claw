import { describe, expect, test } from 'vitest';

import {
  formatRouteStatus,
  resolveContextRoute,
  type ContextRouterWorkspace,
  type ImEntryRouteLike,
  type ThreadLike,
} from '../../../src/messaging/context-router.js';

const workspaces: ContextRouterWorkspace[] = [
  { jid: 'web:main', folder: 'main', name: '主工作区' },
  { jid: 'web:hkipo', folder: 'hkipo', name: 'HK IPO' },
  { jid: 'web:stock', folder: 'stock', name: '股票研究' },
];

const threads: ThreadLike[] = [
  {
    id: 'thread-main-hkipo',
    workspace_jid: 'web:hkipo',
    kind: 'main',
    title: '主线',
    runtime_agent_id: null,
    status: 'active',
    last_active_at: '2026-05-24T13:00:00.000Z',
  },
  {
    id: 'thread-watch',
    workspace_jid: 'web:stock',
    kind: 'workflow',
    title: '盯盘任务',
    runtime_agent_id: 'workflow:wfctx_watch',
    source_run_id: 'wfrun_watch',
    status: 'active',
    last_active_at: '2026-05-24T13:10:00.000Z',
  },
];

function route(input: {
  text: string;
  route?: ImEntryRouteLike | null;
  now?: string;
}) {
  return resolveContextRoute({
    entryJid: 'feishu:private-1',
    text: input.text,
    workspaces,
    threads,
    route: input.route ?? null,
    defaultWorkspaceJid: 'web:main',
    now: input.now ?? '2026-05-24T13:15:00.000Z',
  });
}

describe('resolveContextRoute', () => {
  test('/use switches the IM entry default workspace to a workspace main thread', () => {
    expect(route({ text: '/use HK IPO' })).toMatchObject({
      action: 'set_default',
      workspace_jid: 'web:hkipo',
      thread_id: 'thread-main-hkipo',
      runtime_agent_id: null,
      reason: 'explicit_use',
      reply: '已切换到 HK IPO / 主线',
      routeUpdate: {
        im_jid: 'feishu:private-1',
        default_workspace_jid: 'web:hkipo',
        active_workspace_jid: 'web:hkipo',
        active_thread_id: 'thread-main-hkipo',
      },
    });
  });

  test('/to routes one message to a workspace without changing the default target', () => {
    expect(
      route({
        text: '/to 股票研究 帮我看下腾讯今天走势',
        route: {
          im_jid: 'feishu:private-1',
          default_workspace_jid: 'web:hkipo',
          active_workspace_jid: 'web:hkipo',
          active_thread_id: 'thread-main-hkipo',
        },
      }),
    ).toMatchObject({
      action: 'dispatch',
      workspace_jid: 'web:stock',
      thread_id: null,
      runtime_agent_id: null,
      content: '帮我看下腾讯今天走势',
      reason: 'explicit_to',
      routeUpdate: null,
    });
  });

  test('continuation language reuses the most recent active thread', () => {
    expect(
      route({
        text: '继续刚才那个盯盘任务',
        route: {
          im_jid: 'feishu:private-1',
          default_workspace_jid: 'web:main',
        },
      }),
    ).toMatchObject({
      action: 'dispatch',
      workspace_jid: 'web:stock',
      thread_id: 'thread-watch',
      runtime_agent_id: 'workflow:wfctx_watch',
      reason: 'recent_thread',
    });
  });

  test('/back returns the IM entry to its default workspace mainline', () => {
    expect(
      route({
        text: '/back',
        route: {
          im_jid: 'feishu:private-1',
          default_workspace_jid: 'web:hkipo',
          active_workspace_jid: 'web:stock',
          active_thread_id: 'thread-watch',
        },
      }),
    ).toMatchObject({
      action: 'set_active',
      workspace_jid: 'web:hkipo',
      thread_id: 'thread-main-hkipo',
      runtime_agent_id: null,
      reason: 'explicit_back',
      reply: '已回到 HK IPO / 主线',
    });
  });

  test('returns a clarification when natural language mentions multiple workspaces', () => {
    expect(route({ text: 'HK IPO 和股票研究都看看' })).toMatchObject({
      action: 'clarify',
      reason: 'ambiguous_workspace',
      candidates: [
        { workspace_jid: 'web:hkipo', label: 'HK IPO' },
        { workspace_jid: 'web:stock', label: '股票研究' },
      ],
    });
  });
});

describe('formatRouteStatus', () => {
  test('shows workspace and thread without exposing runtime ids', () => {
    expect(
      formatRouteStatus({
        workspaceName: '股票研究',
        threadTitle: '盯盘任务',
        channelLabel: '飞书',
        timestamp: '09:42',
      }),
    ).toBe('股票研究（盯盘任务） | 09:42');
  });
});
