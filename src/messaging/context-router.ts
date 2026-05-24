export type ThreadKind = 'main' | 'task' | 'workflow';
export type ThreadStatus = 'active' | 'archived';

export interface ThreadLike {
  id: string;
  workspace_jid: string;
  kind: ThreadKind;
  title: string;
  runtime_agent_id?: string | null;
  source_run_id?: string | null;
  status: ThreadStatus;
  last_active_at: string;
}

export interface ContextRouterWorkspace {
  jid: string;
  folder: string;
  name: string;
}

export interface ImEntryRouteLike {
  im_jid: string;
  default_workspace_jid?: string | null;
  active_workspace_jid?: string | null;
  active_thread_id?: string | null;
  active_until?: string | null;
  pinned?: boolean | null;
}

export interface RouteCandidate {
  workspace_jid: string;
  thread_id?: string | null;
  label: string;
}

export type ContextRouteDecision =
  | {
      action: 'dispatch';
      workspace_jid: string;
      thread_id: string | null;
      runtime_agent_id: string | null;
      content: string;
      reason:
        | 'explicit_to'
        | 'active_thread'
        | 'recent_thread'
        | 'mentioned_workspace'
        | 'default_workspace';
      routeUpdate: null;
    }
  | {
      action: 'set_default' | 'set_active';
      workspace_jid: string;
      thread_id: string | null;
      runtime_agent_id: string | null;
      content: '';
      reason: 'explicit_use' | 'explicit_back';
      reply: string;
      routeUpdate: ImEntryRouteLike;
    }
  | {
      action: 'status';
      workspace_jid: string;
      thread_id: string | null;
      runtime_agent_id: string | null;
      content: '';
      reason: 'explicit_where';
      reply: string;
      routeUpdate: null;
    }
  | {
      action: 'list_threads';
      workspace_jid: string;
      thread_id: string | null;
      runtime_agent_id: string | null;
      content: '';
      reason: 'explicit_threads';
      reply: string;
      routeUpdate: null;
    }
  | {
      action: 'clarify';
      reason: 'ambiguous_workspace' | 'unknown_workspace' | 'missing_message';
      candidates: RouteCandidate[];
      reply: string;
      routeUpdate: null;
    };

export interface ResolveContextRouteInput {
  entryJid: string;
  text: string;
  workspaces: readonly ContextRouterWorkspace[];
  threads: readonly ThreadLike[];
  route?: ImEntryRouteLike | null;
  defaultWorkspaceJid: string;
  now?: string;
}

export interface MessageFooterMeta {
  workspaceName: string;
  threadTitle: string;
  channelLabel: string;
  timestamp: string;
  runId?: string | null;
}

const CONTINUATION_PATTERNS = ['继续', '刚才', '上面', '这个', '那个', '跟进'];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function stripCommand(text: string): { name: string; argsText: string } | null {
  const normalized = text.trim();
  if (!normalized.startsWith('/')) return null;
  const match = normalized.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return {
    name: match[1]!.toLowerCase(),
    argsText: (match[2] ?? '').trim(),
  };
}

function workspaceMatches(
  workspace: ContextRouterWorkspace,
  spec: string,
): boolean {
  const normalized = normalizeText(spec);
  return (
    normalizeText(workspace.name) === normalized ||
    normalizeText(workspace.folder) === normalized ||
    normalizeText(workspace.jid) === normalized
  );
}

function workspaceMentioned(
  workspace: ContextRouterWorkspace,
  text: string,
): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.includes(normalizeText(workspace.name)) ||
    normalized.includes(normalizeText(workspace.folder))
  );
}

function findWorkspace(
  workspaces: readonly ContextRouterWorkspace[],
  spec: string,
): ContextRouterWorkspace | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  return (
    workspaces.find((workspace) => workspaceMatches(workspace, trimmed)) ?? null
  );
}

function findWorkspaceAndMessage(
  workspaces: readonly ContextRouterWorkspace[],
  argsText: string,
): { workspace: ContextRouterWorkspace; message: string } | null {
  const trimmed = argsText.trim();
  if (!trimmed) return null;
  const candidates = workspaces
    .map((workspace) => {
      const specs = [workspace.name, workspace.folder, workspace.jid]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
      const matchedSpec = specs.find((spec) =>
        normalizeText(trimmed).startsWith(normalizeText(spec)),
      );
      if (!matchedSpec) return null;
      return { workspace, matchedSpec };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        workspace: ContextRouterWorkspace;
        matchedSpec: string;
      } => Boolean(candidate),
    )
    .sort((a, b) => b.matchedSpec.length - a.matchedSpec.length);
  const first = candidates[0];
  if (!first) return null;
  const message = trimmed.slice(first.matchedSpec.length).trim();
  return { workspace: first.workspace, message };
}

function findMainThread(
  threads: readonly ThreadLike[],
  workspaceJid: string,
): ThreadLike | null {
  return (
    threads.find(
      (thread) =>
        thread.workspace_jid === workspaceJid &&
        thread.kind === 'main' &&
        thread.status !== 'archived',
    ) ?? null
  );
}

function findThread(
  threads: readonly ThreadLike[],
  threadId?: string | null,
): ThreadLike | null {
  if (!threadId) return null;
  return (
    threads.find(
      (thread) => thread.id === threadId && thread.status !== 'archived',
    ) ?? null
  );
}

function findRecentThread(threads: readonly ThreadLike[]): ThreadLike | null {
  return (
    [...threads]
      .filter(
        (thread) => thread.status !== 'archived' && thread.kind !== 'main',
      )
      .sort((a, b) => b.last_active_at.localeCompare(a.last_active_at))[0] ??
    null
  );
}

function defaultWorkspace(
  input: ResolveContextRouteInput,
): ContextRouterWorkspace {
  const routeDefault = input.route?.default_workspace_jid;
  return (
    input.workspaces.find((workspace) => workspace.jid === routeDefault) ??
    input.workspaces.find(
      (workspace) => workspace.jid === input.defaultWorkspaceJid,
    ) ??
    input.workspaces[0] ?? {
      jid: input.defaultWorkspaceJid,
      folder: input.defaultWorkspaceJid.replace(/^web:/, ''),
      name: input.defaultWorkspaceJid,
    }
  );
}

function threadRuntime(thread: ThreadLike | null): string | null {
  return thread?.runtime_agent_id ?? null;
}

function routeUpdateFor(
  input: ResolveContextRouteInput,
  workspaceJid: string,
  threadId: string | null,
): ImEntryRouteLike {
  return {
    im_jid: input.entryJid,
    default_workspace_jid: workspaceJid,
    active_workspace_jid: workspaceJid,
    active_thread_id: threadId,
    active_until: input.now ?? new Date().toISOString(),
  };
}

function candidateFor(workspace: ContextRouterWorkspace): RouteCandidate {
  return {
    workspace_jid: workspace.jid,
    label: workspace.name,
  };
}

function formatWorkspaceThread(
  workspace: ContextRouterWorkspace,
  thread: ThreadLike | null,
): string {
  return `${workspace.name} / ${thread?.title || '主线'}`;
}

export function resolveContextRoute(
  input: ResolveContextRouteInput,
): ContextRouteDecision {
  const command = stripCommand(input.text);
  const fallbackWorkspace = defaultWorkspace(input);

  if (command?.name === 'use' || command?.name === 'bind') {
    const workspace = findWorkspace(input.workspaces, command.argsText);
    if (!workspace) {
      return {
        action: 'clarify',
        reason: 'unknown_workspace',
        candidates: input.workspaces.map(candidateFor),
        reply: '未找到工作区，请从候选工作区中选择。',
        routeUpdate: null,
      };
    }
    const thread = findMainThread(input.threads, workspace.jid);
    return {
      action: 'set_default',
      workspace_jid: workspace.jid,
      thread_id: thread?.id ?? null,
      runtime_agent_id: threadRuntime(thread),
      content: '',
      reason: 'explicit_use',
      reply: `已切换到 ${formatWorkspaceThread(workspace, thread)}`,
      routeUpdate: routeUpdateFor(input, workspace.jid, thread?.id ?? null),
    };
  }

  if (command?.name === 'to') {
    const resolved = findWorkspaceAndMessage(
      input.workspaces,
      command.argsText,
    );
    if (!resolved) {
      return {
        action: 'clarify',
        reason: 'unknown_workspace',
        candidates: input.workspaces.map(candidateFor),
        reply: '未找到投递目标，请指定工作区名称后再发送。',
        routeUpdate: null,
      };
    }
    if (!resolved.message) {
      return {
        action: 'clarify',
        reason: 'missing_message',
        candidates: [candidateFor(resolved.workspace)],
        reply: `要发送到 ${resolved.workspace.name} 的内容为空。`,
        routeUpdate: null,
      };
    }
    return {
      action: 'dispatch',
      workspace_jid: resolved.workspace.jid,
      thread_id: null,
      runtime_agent_id: null,
      content: resolved.message,
      reason: 'explicit_to',
      routeUpdate: null,
    };
  }

  if (command?.name === 'back') {
    const workspace = fallbackWorkspace;
    const thread = findMainThread(input.threads, workspace.jid);
    return {
      action: 'set_active',
      workspace_jid: workspace.jid,
      thread_id: thread?.id ?? null,
      runtime_agent_id: threadRuntime(thread),
      content: '',
      reason: 'explicit_back',
      reply: `已回到 ${formatWorkspaceThread(workspace, thread)}`,
      routeUpdate: {
        im_jid: input.entryJid,
        default_workspace_jid: workspace.jid,
        active_workspace_jid: workspace.jid,
        active_thread_id: thread?.id ?? null,
        active_until: input.now ?? new Date().toISOString(),
      },
    };
  }

  if (command?.name === 'where') {
    const activeThread = findThread(
      input.threads,
      input.route?.active_thread_id,
    );
    const workspace =
      input.workspaces.find(
        (item) =>
          item.jid ===
          (activeThread?.workspace_jid ??
            input.route?.active_workspace_jid ??
            fallbackWorkspace.jid),
      ) ?? fallbackWorkspace;
    return {
      action: 'status',
      workspace_jid: workspace.jid,
      thread_id: activeThread?.id ?? null,
      runtime_agent_id: threadRuntime(activeThread),
      content: '',
      reason: 'explicit_where',
      reply: `当前入口：${formatWorkspaceThread(workspace, activeThread)}`,
      routeUpdate: null,
    };
  }

  if (command?.name === 'threads') {
    const workspace = fallbackWorkspace;
    const activeThreads = input.threads.filter(
      (thread) =>
        thread.workspace_jid === workspace.jid && thread.status !== 'archived',
    );
    const lines =
      activeThreads.length === 0
        ? ['暂无任务线程']
        : activeThreads.map((thread) => `- ${thread.title}`);
    return {
      action: 'list_threads',
      workspace_jid: workspace.jid,
      thread_id: null,
      runtime_agent_id: null,
      content: '',
      reason: 'explicit_threads',
      reply: [`${workspace.name} 的任务线程：`, ...lines].join('\n'),
      routeUpdate: null,
    };
  }

  const mentionedWorkspaces = input.workspaces.filter((workspace) =>
    workspaceMentioned(workspace, input.text),
  );
  if (mentionedWorkspaces.length > 1) {
    return {
      action: 'clarify',
      reason: 'ambiguous_workspace',
      candidates: mentionedWorkspaces.map(candidateFor),
      reply: `你提到了多个工作区：${mentionedWorkspaces
        .map((workspace) => workspace.name)
        .join('、')}。请指定要投递到哪一个。`,
      routeUpdate: null,
    };
  }
  if (mentionedWorkspaces.length === 1) {
    const workspace = mentionedWorkspaces[0]!;
    return {
      action: 'dispatch',
      workspace_jid: workspace.jid,
      thread_id: null,
      runtime_agent_id: null,
      content: input.text.trim(),
      reason: 'mentioned_workspace',
      routeUpdate: null,
    };
  }

  const activeThread = findThread(input.threads, input.route?.active_thread_id);
  if (activeThread) {
    return {
      action: 'dispatch',
      workspace_jid: activeThread.workspace_jid,
      thread_id: activeThread.id,
      runtime_agent_id: threadRuntime(activeThread),
      content: input.text.trim(),
      reason: 'active_thread',
      routeUpdate: null,
    };
  }

  if (CONTINUATION_PATTERNS.some((pattern) => input.text.includes(pattern))) {
    const recentThread = findRecentThread(input.threads);
    if (recentThread) {
      return {
        action: 'dispatch',
        workspace_jid: recentThread.workspace_jid,
        thread_id: recentThread.id,
        runtime_agent_id: threadRuntime(recentThread),
        content: input.text.trim(),
        reason: 'recent_thread',
        routeUpdate: null,
      };
    }
  }

  return {
    action: 'dispatch',
    workspace_jid: fallbackWorkspace.jid,
    thread_id: null,
    runtime_agent_id: null,
    content: input.text.trim(),
    reason: 'default_workspace',
    routeUpdate: null,
  };
}

export function formatRouteStatus(meta: MessageFooterMeta): string {
  const runSuffix = meta.runId ? ` #${meta.runId}` : '';
  return `| ${meta.workspaceName}（${meta.threadTitle}${runSuffix}）| ${meta.channelLabel} | ${meta.timestamp} |`;
}
