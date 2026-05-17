import { Hono } from 'hono';
import type { Variables } from '../context.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  GroupCreateSchema,
  GroupPatchSchema,
  GroupMemberAddSchema,
} from '../../core/schemas.js';
import type {
  AgentType,
  AuthUser,
  RegisteredGroup,
  MessageHistoryCursor,
} from '../../domain/types.js';
import { checkGroupLimit } from '../../core/billing.js';
import { DATA_DIR, GROUPS_DIR } from '../../core/config.js';
import { LAUNCH_CWD } from '../../core/app-root.js';
import {
  buildEffectiveGroupFromHomeSibling,
  normalizeAgentType,
  resolveEffectiveRuntimeIdentity,
} from '../../core/runtime/group-runtime.js';
import {
  materializeWorkspaceDefaultCwd,
  validateWorkspaceCwd,
} from '../../core/workspace/workspace-cwd.js';
import {
  normalizeReasoningEffortPreset,
  normalizeSpeedTierPreset,
  supportsReasoningEffort,
  supportsSpeedTier,
} from '../../core/runtime/command-registry.js';
import {
  getAvailableRuntimeModelOptions,
  getAvailableRuntimeModelPresets,
  normalizeAvailableRuntimeModelPreset,
} from '../../core/runtime/model-options.js';
import {
  hasLocalWorkspacePermission,
  canAccessGroup,
  canModifyGroup,
  canDeleteGroup,
  canManageGroupMembers,
  MAX_GROUP_NAME_LEN,
  getWebDeps,
} from '../context.js';
import {
  getRegisteredGroup,
  setRegisteredGroup,
  deleteRegisteredGroup,
  getAllRegisteredGroups,
  getAllChats,
  getJidsByFolder,
  updateChatName,
  deleteAllSessionsForFolder,
  deletePrimaryRuntimeSessions,
  deleteSession,
  deleteChatHistory,
  deleteGroupData,
  ensureChatExists,
  storeMessageDirect,
  getMessagesPage,
  getMessagesAfter,
  getMessagesPageMulti,
  getMessagesAfterMulti,
  addGroupMember,
  removeGroupMember,
  getGroupMembers,
  getGroupMemberRole,
  getUserById,
  getAgent,
  listUsers,
  listAgentsByJid,
  getGroupsByTargetAgent,
  getGroupsByTargetMainJid,
  getMessage,
  deleteMessage,
  getUserPinnedGroups,
  pinGroup,
  unpinGroup,
} from '../../storage/db.js';
import { logger } from '../../core/logger.js';
import { getOpenAiRuntimeDefaults } from '../../core/runtime/config.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { broadcastNewMessage, invalidateAllowedUserCache } from '../app.js';
import { getStreamingSession } from '../../messaging/providers/feishu/streaming-card.js';

function normalizeOptionalRuntimeModel(
  agentType: AgentType,
  rawValue: string | null | undefined,
  currentModel?: string | null,
): string | null {
  if (rawValue == null) return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  return normalizeAvailableRuntimeModelPreset(agentType, trimmed, {
    currentModel,
  });
}

function normalizeOptionalReasoningEffort(
  agentType: AgentType,
  rawValue: string | null | undefined,
): string | null {
  if (!supportsReasoningEffort(agentType) || rawValue == null) return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  return normalizeReasoningEffortPreset(trimmed);
}

function normalizeOptionalSpeedTier(
  agentType: AgentType,
  rawValue: string | null | undefined,
): string | null {
  if (rawValue == null) return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (!supportsSpeedTier(agentType)) return null;
  return normalizeSpeedTierPreset(trimmed);
}

function findHomeSiblingGroup(group: RegisteredGroup): RegisteredGroup | null {
  for (const siblingJid of getJidsByFolder(group.folder)) {
    const sibling = getRegisteredGroup(siblingJid);
    if (sibling?.is_home) return sibling;
  }
  return null;
}

function resolveEffectiveGroupForRuntime(
  group: RegisteredGroup,
): RegisteredGroup {
  if (group.is_home) return group;
  const homeGroup = findHomeSiblingGroup(group);
  return homeGroup
    ? buildEffectiveGroupFromHomeSibling(group, homeGroup)
    : group;
}

function resolveRuntimeIdentityForGroup(group: RegisteredGroup) {
  const openAiRuntimeDefaults = getOpenAiRuntimeDefaults();
  return resolveEffectiveRuntimeIdentity(
    resolveEffectiveGroupForRuntime(group),
    {
      openAiModel: openAiRuntimeDefaults.model,
      openAiReasoningEffort: openAiRuntimeDefaults.reasoningEffort,
      openAiSpeedTier: openAiRuntimeDefaults.speedTier,
    },
  );
}

function readHistoryCursorQuery(
  c: any,
  prefix: 'before' | 'after',
): string | MessageHistoryCursor | undefined {
  const timestamp = c.req.query(prefix);
  if (!timestamp) return undefined;
  const id = c.req.query(`${prefix}_id`);
  const chatJid = c.req.query(`${prefix}_chat_jid`);
  if (!id) return timestamp;
  return {
    timestamp,
    id,
    ...(chatJid ? { chat_jid: chatJid } : {}),
  };
}

const groupRoutes = new Hono<{ Variables: Variables }>();

// --- Helper functions ---

function normalizeGroupName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, MAX_GROUP_NAME_LEN);
}

interface GroupPayloadItem {
  name: string;
  folder: string;
  added_at: string;
  agent_type: AgentType;
  model?: string | null;
  reasoning_effort?: string | null;
  speed_tier?: string | null;
  kind: 'home' | 'feishu' | 'web';
  editable: boolean;
  deletable: boolean;
  lastMessage?: string;
  lastMessageTime?: string;
  custom_cwd?: string;
  is_home?: boolean;
  is_my_home?: boolean;
  is_shared?: boolean;
  member_role?: 'owner' | 'member';
  member_count?: number;
  pinned_at?: string;
  activation_mode?: 'auto' | 'always' | 'when_mentioned' | 'disabled';
}

function buildGroupsPayload(user: AuthUser): Record<string, GroupPayloadItem> {
  const groups = getAllRegisteredGroups();
  const chats = new Map(getAllChats().map((chat) => [chat.jid, chat]));
  const isAdmin = hasLocalWorkspacePermission(user);
  const isSharedAdminHomeGroup = (
    jid: string,
    group: RegisteredGroup,
  ): boolean =>
    isAdmin && !!group.is_home && jid === 'web:main' && group.folder === 'main';
  const homeFolders = new Set(
    Object.entries(groups)
      .filter(([jid, group]) => jid.startsWith('web:') && !!group.is_home)
      .map(([_, group]) => group.folder),
  );

  const result: Record<string, GroupPayloadItem> = {};

  // 先过滤出要显示的群组 jid
  const visibleEntries: Array<[string, (typeof groups)[string]]> = [];
  for (const [jid, group] of Object.entries(groups)) {
    const isHome = !!group.is_home;
    const isWeb = jid.startsWith('web:');
    const isSharedAdminHome = isSharedAdminHomeGroup(jid, group);

    // Hide IM channels that belong to a home folder.
    // These are merged into the home conversation in UI and message APIs.
    if (!isWeb && !isHome && homeFolders.has(group.folder)) continue;

    // Hide other users' home groups from the chat sidebar.
    // Each user only sees their own home workspace.
    if (isHome && group.created_by !== user.id && !isSharedAdminHome) continue;

    // User isolation: all users only see their own groups + shared groups
    if (!canAccessGroup({ id: user.id, role: user.role }, { ...group, jid }))
      continue;

    visibleEntries.push([jid, group]);
  }

  // 批量获取每个 jid 的最新消息（替代 N+1 逐个查询）
  const visibleJids = visibleEntries.map(([jid]) => jid);
  const latestByJid = new Map<string, { content: string; timestamp: string }>();
  if (visibleJids.length > 0) {
    // 用 multi 查询获取足够多的消息来覆盖所有 jid
    const allLatest = getMessagesPageMulti(
      visibleJids,
      undefined,
      visibleJids.length * 3,
    );
    for (const msg of allLatest) {
      if (!latestByJid.has(msg.chat_jid)) {
        latestByJid.set(msg.chat_jid, {
          content: msg.content,
          timestamp: msg.timestamp,
        });
      }
    }
  }

  // Fetch user's pinned groups
  const pins = getUserPinnedGroups(user.id);

  // Cache member info per folder (avoid repeated queries)
  const memberCache = new Map<
    string,
    { count: number; role: 'owner' | 'member' | null }
  >();
  function getMemberInfo(folder: string) {
    let cached = memberCache.get(folder);
    if (!cached) {
      const members = getGroupMembers(folder);
      const role = members.find((m) => m.user_id === user.id)?.role ?? null;
      cached = { count: members.length, role };
      memberCache.set(folder, cached);
    }
    return cached;
  }

  for (const [jid, group] of visibleEntries) {
    const isHome = !!group.is_home;
    const isWeb = jid.startsWith('web:');
    const isSharedAdminHome = isSharedAdminHomeGroup(jid, group);

    const latest = latestByJid.get(jid);
    const memberInfo = !isHome ? getMemberInfo(group.folder) : null;
    const isShared = memberInfo ? memberInfo.count > 1 : false;

    result[jid] = {
      name: group.name,
      folder: group.folder,
      added_at: group.added_at,
      agent_type: normalizeAgentType(group.agentType),
      model: group.model ?? null,
      reasoning_effort: group.reasoningEffort ?? null,
      speed_tier: group.speedTier ?? null,
      kind: isHome ? 'home' : isWeb ? 'web' : 'feishu',
      editable: isWeb,
      deletable: isWeb && !isHome,
      lastMessage: latest?.content,
      lastMessageTime:
        latest?.timestamp ||
        chats.get(jid)?.last_message_time ||
        group.added_at,
      custom_cwd: isAdmin ? group.customCwd : undefined,
      is_home: isHome || undefined,
      is_my_home:
        (isHome && (group.created_by === user.id || isSharedAdminHome)) ||
        undefined,
      is_shared: isShared || undefined,
      member_role: memberInfo?.role ?? undefined,
      member_count: isShared ? memberInfo?.count : undefined,
      pinned_at: pins[jid] || undefined,
      activation_mode: group.activation_mode ?? 'auto',
    };
  }

  return result;
}

import { removeFlowArtifacts } from '../../core/workspace/file-manager.js';
import {
  clearSessionJsonlFiles,
  resetWorkspaceRuntimeState,
} from '../../agent/runner/workspace-reset.js';
export { removeFlowArtifacts };

function resetWorkspaceForGroup(folder: string): void {
  // 1. 清除工作目录（Agent 文件、AGENTS.md、logs/ 等），然后重建空目录
  const groupDir = path.join(GROUPS_DIR, folder);
  fs.rmSync(groupDir, { recursive: true, force: true });
  fs.mkdirSync(groupDir, { recursive: true });

  // 2. 清除 runtime 会话目录（下次启动时 runner 会重建）
  fs.rmSync(path.join(DATA_DIR, 'sessions', folder), {
    recursive: true,
    force: true,
  });

  // 3. 清除 IPC 残留并重建目录结构
  const ipcDir = path.join(DATA_DIR, 'ipc', folder);
  fs.rmSync(ipcDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(ipcDir, 'input'), { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'tasks'), { recursive: true });
}

// --- Routes ---

// GET /api/groups - 获取群组列表
groupRoutes.get('/', authMiddleware, (c) => {
  const user = c.get('user') as AuthUser;
  const groups = buildGroupsPayload(user);
  return c.json({ groups });
});

// GET /api/groups/:jid/runtime-model-options - 当前工作区模型选择列表
groupRoutes.get('/:jid/runtime-model-options', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  if (
    !canAccessGroup({ id: authUser.id, role: authUser.role }, { ...group, jid })
  ) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const runtimeIdentity = resolveRuntimeIdentityForGroup(group);
  const modelCatalog = getAvailableRuntimeModelOptions(
    runtimeIdentity.agentType,
    { currentModel: runtimeIdentity.model },
  );

  return c.json({
    current_model: runtimeIdentity.model,
    options: modelCatalog,
  });
});

// POST /api/groups - 创建新群组
groupRoutes.post('/', authMiddleware, async (c) => {
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not initialized' }, 500);

  const body = await c.req.json().catch(() => ({}));

  const validation = GroupCreateSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const name = normalizeGroupName(validation.data.name);
  if (!name) {
    return c.json({ error: 'Group name is required' }, 400);
  }

  const agentType = normalizeAgentType(validation.data.agent_type);
  const model = normalizeOptionalRuntimeModel(agentType, validation.data.model);
  if (validation.data.model && !model) {
    return c.json(
      {
        error: `Unsupported ${agentType} model`,
        presets: getAvailableRuntimeModelPresets(agentType),
      },
      400,
    );
  }
  const reasoningEffort = normalizeOptionalReasoningEffort(
    agentType,
    validation.data.reasoning_effort,
  );
  if (validation.data.reasoning_effort && !reasoningEffort) {
    return c.json(
      {
        error: supportsReasoningEffort(agentType)
          ? 'Unsupported reasoning_effort preset'
          : `${agentType} does not support reasoning_effort`,
      },
      400,
    );
  }
  const speedTier = normalizeOptionalSpeedTier(
    agentType,
    validation.data.speed_tier,
  );
  if (validation.data.speed_tier && !speedTier) {
    return c.json(
      {
        error: supportsSpeedTier(agentType)
          ? 'Unsupported speed_tier preset'
          : `${agentType} does not support speed_tier`,
      },
      400,
    );
  }
  const customCwd = validation.data.custom_cwd; // Schema already trims and converts empty to undefined
  const authUser = c.get('user') as AuthUser;
  let normalizedCustomCwd: string | undefined;

  // Billing: check group limit
  const groupLimit = checkGroupLimit(authUser.id, authUser.role);
  if (!groupLimit.allowed) {
    return c.json({ error: groupLimit.reason }, 403);
  }

  if (customCwd) {
    if (!hasLocalWorkspacePermission(authUser)) {
      return c.json({ error: 'Insufficient permissions for custom_cwd' }, 403);
    }
    const validation = validateWorkspaceCwd(customCwd, {
      fieldLabel: 'custom_cwd',
    });
    if ('error' in validation) {
      return c.json(
        { error: validation.error },
        validation.error.includes('under an allowed root') ? 403 : 400,
      );
    }
    normalizedCustomCwd = validation.cwd;
  }

  const jid = `web:${crypto.randomUUID()}`;
  const folder = `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  const group: RegisteredGroup = {
    name,
    folder,
    added_at: now,
    agentType,
    model,
    reasoningEffort,
    speedTier,
    customCwd: normalizedCustomCwd,
    created_by: authUser.id,
  };

  const materializedGroup = materializeWorkspaceDefaultCwd(group, {
    launchCwd: LAUNCH_CWD,
    fieldLabel: 'CLI launch cwd',
  });
  if ('error' in materializedGroup) {
    return c.json({ error: materializedGroup.error }, 500);
  }

  setRegisteredGroup(jid, materializedGroup.group);
  updateChatName(jid, name);
  deps.getRegisteredGroups()[jid] = materializedGroup.group;

  // Register creator as owner in group_members
  addGroupMember(folder, authUser.id, 'owner', authUser.id);

  return c.json({
    success: true,
    jid,
    group: {
      name: group.name,
      folder: group.folder,
      added_at: group.added_at,
      agent_type: normalizeAgentType(group.agentType),
      model: group.model ?? null,
      reasoning_effort: group.reasoningEffort ?? null,
      speed_tier: group.speedTier ?? null,
      custom_cwd: hasLocalWorkspacePermission(authUser)
        ? materializedGroup.group.customCwd
        : undefined,
      kind: 'web',
      editable: true,
      deletable: true,
      lastMessage: undefined,
      lastMessageTime: now,
      member_role: 'owner',
      member_count: 1,
      is_shared: false,
    },
  });
});

// PATCH /api/groups/:jid - 重命名群组
groupRoutes.patch('/:jid', authMiddleware, async (c) => {
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not initialized' }, 500);

  const jid = c.req.param('jid');
  const existing = getRegisteredGroup(jid);
  if (!existing) return c.json({ error: 'Group not found' }, 404);

  const authUser = c.get('user') as AuthUser;

  const body = await c.req.json().catch(() => ({}));
  const validation = GroupPatchSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const {
    name: rawName,
    is_pinned,
    activation_mode,
    agent_type,
    model,
    reasoning_effort,
    speed_tier,
  } = validation.data;
  const name = rawName ? normalizeGroupName(rawName) : undefined;

  // 至少需要提供一个字段
  if (
    !name &&
    is_pinned === undefined &&
    activation_mode === undefined &&
    agent_type === undefined &&
    model === undefined &&
    reasoning_effort === undefined &&
    speed_tier === undefined
  ) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  // Pin/unpin only requires canAccessGroup (it's a per-user preference)
  const isPinOnly =
    is_pinned !== undefined &&
    !name &&
    activation_mode === undefined &&
    agent_type === undefined &&
    model === undefined &&
    reasoning_effort === undefined &&
    speed_tier === undefined;
  if (isPinOnly) {
    if (
      !canAccessGroup(
        { id: authUser.id, role: authUser.role },
        { ...existing, jid },
      )
    ) {
      return c.json({ error: 'Group not found' }, 404);
    }
  } else {
    // Name/skills changes require canModifyGroup (owner only)
    if (
      !canModifyGroup(
        { id: authUser.id, role: authUser.role },
        { ...existing, jid },
      )
    ) {
      return c.json({ error: 'Group not found' }, 404);
    }
    if (!jid.startsWith('web:') && authUser.role !== 'admin') {
      return c.json({ error: 'This group cannot be edited' }, 403);
    }
  }

  // Handle pin/unpin (per-user, separate table)
  let pinned_at: string | undefined;
  if (is_pinned === true) {
    pinned_at = pinGroup(authUser.id, jid);
  } else if (is_pinned === false) {
    unpinGroup(authUser.id, jid);
  }

  // Update registered group if any editable field changed
  if (
    name ||
    activation_mode !== undefined ||
    agent_type !== undefined ||
    model !== undefined ||
    reasoning_effort !== undefined ||
    speed_tier !== undefined
  ) {
    const nextAgentType =
      agent_type !== undefined
        ? normalizeAgentType(agent_type)
        : normalizeAgentType(existing.agentType);
    const currentRuntimeIdentity = resolveRuntimeIdentityForGroup(existing);
    const currentModelForNextAgent =
      currentRuntimeIdentity.agentType === nextAgentType
        ? currentRuntimeIdentity.model
        : null;
    const nextModel =
      model !== undefined
        ? normalizeOptionalRuntimeModel(
            nextAgentType,
            model,
            currentModelForNextAgent,
          )
        : (existing.model ?? null);
    if (model !== undefined && model !== null && !nextModel) {
      return c.json(
        {
          error: `Unsupported ${nextAgentType} model`,
          presets: getAvailableRuntimeModelPresets(nextAgentType, {
            currentModel: currentModelForNextAgent,
          }),
        },
        400,
      );
    }
    const nextReasoningEffort =
      reasoning_effort !== undefined
        ? normalizeOptionalReasoningEffort(nextAgentType, reasoning_effort)
        : (existing.reasoningEffort ?? null);
    if (
      reasoning_effort !== undefined &&
      reasoning_effort !== null &&
      !nextReasoningEffort
    ) {
      return c.json(
        {
          error: supportsReasoningEffort(nextAgentType)
            ? 'Unsupported reasoning_effort preset'
            : `${nextAgentType} does not support reasoning_effort`,
        },
        400,
      );
    }
    const nextSpeedTier =
      speed_tier !== undefined
        ? normalizeOptionalSpeedTier(nextAgentType, speed_tier)
        : (existing.speedTier ?? null);
    if (speed_tier !== undefined && speed_tier !== null && !nextSpeedTier) {
      return c.json(
        {
          error: supportsSpeedTier(nextAgentType)
            ? 'Unsupported speed_tier preset'
            : `${nextAgentType} does not support speed_tier`,
        },
        400,
      );
    }
    const runtimeSettingsChanged =
      normalizeAgentType(existing.agentType) !== nextAgentType ||
      (existing.model ?? null) !== nextModel ||
      (existing.reasoningEffort ?? null) !== nextReasoningEffort ||
      (existing.speedTier ?? null) !== nextSpeedTier;

    const updated: RegisteredGroup = {
      name: name || existing.name,
      folder: existing.folder,
      added_at: existing.added_at,
      agentType: nextAgentType,
      model: nextModel,
      reasoningEffort: nextReasoningEffort,
      speedTier: nextSpeedTier,
      customCwd: existing.customCwd,
      created_by: existing.created_by,
      is_home: existing.is_home,
      target_agent_id: existing.target_agent_id,
      target_main_jid: existing.target_main_jid,
      reply_policy: existing.reply_policy,
      require_mention: existing.require_mention,
      activation_mode:
        activation_mode !== undefined
          ? activation_mode
          : existing.activation_mode,
    };

    const materializedGroup = materializeWorkspaceDefaultCwd(updated, {
      launchCwd: LAUNCH_CWD,
      fieldLabel: 'CLI launch cwd',
    });
    if ('error' in materializedGroup) {
      return c.json({ error: materializedGroup.error }, 500);
    }
    const persistedGroup = materializedGroup.group;

    setRegisteredGroup(jid, persistedGroup);
    if (name) updateChatName(jid, name);
    deps.getRegisteredGroups()[jid] = persistedGroup;

    if (runtimeSettingsChanged) {
      try {
        await resetWorkspaceRuntimeState(deps, jid, persistedGroup);
      } catch (err) {
        logger.error(
          {
            jid,
            folder: persistedGroup.folder,
            previousAgentType: normalizeAgentType(existing.agentType),
            nextAgentType,
            previousModel: existing.model ?? null,
            nextModel,
            previousReasoningEffort: existing.reasoningEffort ?? null,
            nextReasoningEffort,
            previousSpeedTier: existing.speedTier ?? null,
            nextSpeedTier,
            err,
          },
          'Workspace runtime changed but failed to reset active runners',
        );
        return c.json(
          {
            error:
              'Workspace runtime updated, but failed to reset active sessions',
          },
          500,
        );
      }
      logger.info(
        {
          jid,
          folder: persistedGroup.folder,
          previousAgentType: normalizeAgentType(existing.agentType),
          nextAgentType,
          previousModel: existing.model ?? null,
          nextModel,
          previousReasoningEffort: existing.reasoningEffort ?? null,
          nextReasoningEffort,
          previousSpeedTier: existing.speedTier ?? null,
          nextSpeedTier,
        },
        'Workspace runtime changed, reset active runners and sessions',
      );
    }
  }

  return c.json({ success: true, pinned_at });
});

// DELETE /api/groups/:jid - 删除群组
groupRoutes.delete('/:jid', authMiddleware, async (c) => {
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not initialized' }, 500);

  const jid = c.req.param('jid');
  const existing = getRegisteredGroup(jid);
  if (!existing) return c.json({ error: 'Group not found' }, 404);

  const authUser = c.get('user') as AuthUser;
  if (!canDeleteGroup({ id: authUser.id, role: authUser.role }, existing)) {
    return c.json({ error: 'Group not found' }, 404);
  }

  if (!jid.startsWith('web:')) {
    return c.json({ error: 'This group cannot be deleted' }, 403);
  }

  // Block deletion if any IM binding exists (agent or main conversation)
  const agents = listAgentsByJid(jid);
  const boundAgents: Array<{
    agentId: string;
    agentName: string;
    imGroups: Array<{ jid: string; name: string }>;
  }> = [];
  for (const a of agents) {
    if (a.kind === 'conversation') {
      const linked = getGroupsByTargetAgent(a.id);
      if (linked.length > 0) {
        boundAgents.push({
          agentId: a.id,
          agentName: a.name,
          imGroups: linked.map((l) => ({ jid: l.jid, name: l.group.name })),
        });
      }
    }
  }
  // Search by actual JID; also check legacy folder-based format for backward compat
  const mainBoundByJid = getGroupsByTargetMainJid(jid);
  const legacyMainJid = `web:${existing.folder}`;
  const mainBoundByFolder =
    legacyMainJid !== jid ? getGroupsByTargetMainJid(legacyMainJid) : [];
  const mainBoundJids = new Set(mainBoundByJid.map((l) => l.jid));
  const mainBound = [
    ...mainBoundByJid,
    ...mainBoundByFolder.filter((l) => !mainBoundJids.has(l.jid)),
  ];
  if (boundAgents.length > 0 || mainBound.length > 0) {
    const mainImGroups = mainBound.map((l) => ({
      jid: l.jid,
      name: l.group.name,
    }));
    return c.json(
      {
        error: '该工作区绑定了 IM 群组，请先解绑后再删除。',
        bound_agents: boundAgents,
        bound_main_im_groups: mainImGroups,
      },
      409,
    );
  }

  // Wait for the runner to fully stop before cleaning up its files.
  try {
    await deps.queue.stopGroup(jid);
  } catch (err) {
    logger.error({ jid, err }, 'Failed to stop runner before deleting group');
    return c.json({ error: 'Failed to stop runner, group not deleted' }, 500);
  }
  deleteGroupData(jid, existing.folder);
  removeFlowArtifacts(existing.folder);

  delete deps.getRegisteredGroups()[jid];
  delete deps.getSessions()[existing.folder];
  deps.setLastAgentTimestamp(jid, { timestamp: '', id: '' });

  return c.json({ success: true });
});

// POST /api/groups/:jid/stop - 停止当前运行的进程
groupRoutes.post('/:jid/stop', authMiddleware, async (c) => {
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not initialized' }, 500);

  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  const authUser = c.get('user') as AuthUser;
  if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
    return c.json({ error: 'Group not found' }, 404);
  }

  try {
    await deps.queue.stopGroup(jid);
    return c.json({ success: true });
  } catch (err) {
    logger.error({ jid, err }, 'Failed to stop group');
    return c.json({ error: 'Failed to stop runner' }, 500);
  }
});

// POST /api/groups/:jid/interrupt - 中断当前查询
groupRoutes.post('/:jid/interrupt', authMiddleware, async (c) => {
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not initialized' }, 500);

  const rawJid = c.req.param('jid');
  const jid = decodeURIComponent(rawJid);
  // Support virtual JIDs for conversation agents: {jid}#agent:{agentId}
  const agentSep = jid.indexOf('#agent:');
  const baseJid = agentSep >= 0 ? jid.slice(0, agentSep) : jid;
  const group = getRegisteredGroup(baseJid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  const authUser = c.get('user') as AuthUser;
  if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
    return c.json({ error: 'Group not found' }, 404);
  }

  const interrupted = deps.queue.interruptQuery(jid);
  if (interrupted) {
    // ── 立即 abort 飞书流式卡片 ──
    const session = getStreamingSession(jid);
    if (session?.isActive()) {
      session.abort('已中断').catch(() => {});
    }

    // Persist interrupt as a system marker so refresh/state-restore can
    // deterministically clear waiting even when no assistant reply exists.
    const messageId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    try {
      ensureChatExists(jid);
      storeMessageDirect(
        messageId,
        jid,
        '__system__',
        'system',
        'query_interrupted',
        timestamp,
        true,
      );
      broadcastNewMessage(jid, {
        id: messageId,
        chat_jid: jid,
        sender: '__system__',
        sender_name: 'system',
        content: 'query_interrupted',
        timestamp,
        is_from_me: true,
      });
    } catch (err) {
      logger.warn(
        { jid, err },
        'Interrupt succeeded but failed to append system marker',
      );
    }
  }
  return c.json({ success: true, interrupted });
});

// POST /api/groups/:jid/reset-session - 重置会话上下文
// Optional body: { agentId?: string } — when provided, only reset that agent's session
groupRoutes.post('/:jid/reset-session', authMiddleware, async (c) => {
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not initialized' }, 500);

  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  const authUser = c.get('user') as AuthUser;
  if (
    !canModifyGroup({ id: authUser.id, role: authUser.role }, { ...group, jid })
  ) {
    return c.json({ error: 'Group not found' }, 404);
  }
  // Read optional agentId from request body
  let agentId: string | undefined;
  try {
    const body = await c.req.json().catch(() => ({}));
    if (body && typeof body.agentId === 'string' && body.agentId) {
      agentId = body.agentId;
    }
  } catch {
    /* no body or invalid JSON — treat as main session reset */
  }

  // Validate agentId belongs to this group
  if (agentId) {
    const agent = getAgent(agentId);
    if (!agent || agent.chat_jid !== jid) {
      return c.json({ error: 'Agent not found' }, 404);
    }
  }

  // 1. Stop running processes
  try {
    if (agentId) {
      // Agent-specific: only stop the agent's virtual JID process
      const virtualJid = `${jid}#agent:${agentId}`;
      await deps.queue.stopGroup(virtualJid, { force: true });
    } else {
      // Main session: stop ALL processes for this folder
      const siblingJids = getJidsByFolder(group.folder);
      await Promise.all(
        siblingJids.map((j) => deps.queue.stopGroup(j, { force: true })),
      );
    }
  } catch (err) {
    logger.error(
      { jid, agentId, err },
      'Failed to stop runners before resetting session',
    );
    return c.json({ error: 'Failed to stop runner, session not reset' }, 500);
  }

  // 2. Delete runtime session files so the next turn starts fresh.
  try {
    clearSessionJsonlFiles(group.folder, agentId);
  } catch (err) {
    logger.error(
      { jid, folder: group.folder, agentId, err },
      'Failed to clear session files during reset',
    );
    return c.json(
      { error: 'Failed to clear session files, session not reset' },
      500,
    );
  }

  // 3. Delete session from DB (and in-memory cache for main session).
  try {
    if (agentId) {
      deleteSession(group.folder, agentId);
    } else {
      deletePrimaryRuntimeSessions(group.folder);
      delete deps.getSessions()[group.folder];
    }
  } catch (err) {
    logger.error(
      { jid, folder: group.folder, agentId, err },
      'Failed to clear session state during reset',
    );
    return c.json(
      { error: 'Failed to clear session state, session not reset' },
      500,
    );
  }

  // 4. Insert system divider message into the correct JID (best-effort).
  const targetJid = agentId ? `${jid}#agent:${agentId}` : jid;
  const dividerMessageId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  try {
    ensureChatExists(targetJid);
    storeMessageDirect(
      dividerMessageId,
      targetJid,
      '__system__',
      'system',
      'context_reset',
      timestamp,
      true,
    );

    broadcastNewMessage(targetJid, {
      id: dividerMessageId,
      chat_jid: targetJid,
      sender: '__system__',
      sender_name: 'system',
      content: 'context_reset',
      timestamp,
      is_from_me: true,
    });
  } catch (err) {
    logger.warn(
      { jid, agentId, err },
      'Session reset succeeded but failed to append divider message',
    );
  }

  // 5. Advance lastAgentTimestamp so old messages before the reset are not
  //    re-sent to the next fresh agent session.
  if (agentId) {
    const virtualJid = `${jid}#agent:${agentId}`;
    deps.setLastAgentTimestamp(virtualJid, { timestamp, id: dividerMessageId });
  } else {
    // Main session: advance cursor for ALL sibling JIDs sharing this folder.
    const siblingJids = getJidsByFolder(group.folder);
    for (const siblingJid of siblingJids) {
      deps.setLastAgentTimestamp(siblingJid, {
        timestamp,
        id: dividerMessageId,
      });
    }
  }

  logger.info(
    { jid, folder: group.folder, agentId },
    'Session reset: cleared session files and stopped runners',
  );

  return c.json({ success: true, dividerMessageId });
});

// POST /api/groups/:jid/clear-history - 清除聊天历史
groupRoutes.post('/:jid/clear-history', authMiddleware, async (c) => {
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not initialized' }, 500);

  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  const authUser = c.get('user') as AuthUser;
  if (
    !canModifyGroup({ id: authUser.id, role: authUser.role }, { ...group, jid })
  ) {
    return c.json({ error: 'Group not found' }, 404);
  }
  // Collect all JIDs sharing the same folder (e.g., web:main + feishu groups)
  const siblingJids = getJidsByFolder(group.folder);

  // 1. Stop ALL active processes for this folder first to avoid writes during cleanup.
  try {
    await Promise.all(
      siblingJids.map((j) => deps.queue.stopGroup(j, { force: true })),
    );
  } catch (err) {
    logger.error(
      { jid, siblingJids, err },
      'Failed to stop runner processes before clearing history',
    );
    return c.json(
      { error: 'Failed to stop runner process, history not cleared' },
      500,
    );
  }

  // 2. Reset workspace: clear working directory, session files, and IPC artifacts.
  try {
    resetWorkspaceForGroup(group.folder);
  } catch (err) {
    logger.error(
      { jid, folder: group.folder, err },
      'Failed to reset workspace while clearing history',
    );
    return c.json(
      { error: 'Failed to reset workspace, history not cleared' },
      500,
    );
  }

  // 3. Clear session state and message history for ALL sibling JIDs.
  try {
    deleteAllSessionsForFolder(group.folder);
    delete deps.getSessions()[group.folder];
    for (const siblingJid of siblingJids) {
      deleteChatHistory(siblingJid);
      // Re-create the chats row so subsequent messages work properly
      ensureChatExists(siblingJid);
      deps.setLastAgentTimestamp(siblingJid, { timestamp: '', id: '' });
    }
  } catch (err) {
    logger.error(
      { jid, folder: group.folder, err },
      'Failed to clear history state',
    );
    return c.json({ error: 'Failed to clear history' }, 500);
  }

  logger.info(
    { jid, folder: group.folder, siblingJids },
    'Cleared workspace, context and chat history for group and all siblings',
  );
  return c.json({ success: true });
});

// GET /api/groups/:jid/messages - 获取消息历史
groupRoutes.get('/:jid/messages', authMiddleware, async (c) => {
  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) {
    return c.json({ error: 'Group not found' }, 404);
  }

  const authUser = c.get('user') as AuthUser;
  if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
    return c.json({ error: 'Group not found' }, 404);
  }
  const before = readHistoryCursorQuery(c, 'before');
  const after = readHistoryCursorQuery(c, 'after');
  const agentIdParam = c.req.query('agentId');
  const limitRaw = parseInt(c.req.query('limit') || '50', 10);
  const limit = Math.min(
    Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : 50,
    200,
  );

  // Agent conversation: query messages from the virtual chat_jid
  if (agentIdParam) {
    const agent = getAgent(agentIdParam);
    if (!agent || agent.chat_jid !== jid) {
      return c.json({ error: 'Agent not found' }, 404);
    }

    const virtualJid = `${jid}#agent:${agentIdParam}`;
    if (after) {
      const messages = getMessagesAfter(virtualJid, after, limit);
      return c.json({ messages });
    }
    const rows = getMessagesPage(virtualJid, before, limit + 1);
    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;
    return c.json({ messages, hasMore });
  }

  // is_home 群组合并查询：将同 folder 下所有 JID（web + feishu/telegram IM 通道）的消息合并展示
  // - admin: merge all siblings in the folder (shared admin home)
  // - member: merge only siblings with same owner to prevent cross-user leakage
  const queryJids = [jid];
  if (group.is_home) {
    const siblingJids = getJidsByFolder(group.folder);
    for (const siblingJid of siblingJids) {
      if (siblingJid === jid) continue;
      const siblingGroup = getRegisteredGroup(siblingJid);
      if (!siblingGroup) continue;
      // Merge siblings by ownership: same creator, or admin's own IM channels
      const ownerMatch =
        group.created_by && siblingGroup.created_by === group.created_by;
      const adminSelfMatch =
        authUser.role === 'admin' && siblingGroup.created_by === authUser.id;
      if (ownerMatch || adminSelfMatch) {
        queryJids.push(siblingJid);
      }
    }
  }

  if (queryJids.length === 1) {
    // 单 JID 走原路径
    if (after) {
      const messages = getMessagesAfter(jid, after, limit);
      return c.json({ messages });
    }
    const rows = getMessagesPage(jid, before, limit + 1);
    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;
    return c.json({ messages, hasMore });
  }

  // 多 JID 合并查询
  if (after) {
    const messages = getMessagesAfterMulti(queryJids, after, limit);
    return c.json({ messages });
  }
  const rows = getMessagesPageMulti(queryJids, before, limit + 1);
  const hasMore = rows.length > limit;
  const messages = hasMore ? rows.slice(0, limit) : rows;
  return c.json({ messages, hasMore });
});

// DELETE /api/groups/:jid/messages/:messageId - 删除单条消息
groupRoutes.delete('/:jid/messages/:messageId', authMiddleware, (c) => {
  const jid = c.req.param('jid');
  const messageId = c.req.param('messageId');
  const group = getRegisteredGroup(jid);
  if (!group) {
    return c.json({ error: 'Group not found' }, 404);
  }

  const authUser = c.get('user') as AuthUser;
  if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
    return c.json({ error: 'Group not found' }, 404);
  }

  // Ownership check: admin can delete any message, non-admin can only delete their own
  const msg = getMessage(jid, messageId);
  if (!msg) {
    return c.json({ error: 'Message not found' }, 404);
  }
  if (authUser.role !== 'admin') {
    // AI messages (is_from_me=1) cannot be deleted by non-admin
    // User messages can only be deleted by the sender
    if (msg.is_from_me === 1 || (msg.sender && msg.sender !== authUser.id)) {
      return c.json({ error: 'Permission denied' }, 403);
    }
  }

  const deleted = deleteMessage(jid, messageId);
  if (!deleted) {
    return c.json({ error: 'Message not found' }, 404);
  }

  return c.json({ success: true });
});

// --- Member Management Routes ---

// GET /api/groups/:jid/members - 列出成员
groupRoutes.get('/:jid/members', authMiddleware, (c) => {
  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const authUser = c.get('user') as AuthUser;
  if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
    return c.json({ error: 'Group not found' }, 404);
  }

  const members = getGroupMembers(group.folder);
  return c.json({ members });
});

// GET /api/groups/:jid/members/search?q=... - 搜索可添加的用户（owner/admin 权限）
groupRoutes.get('/:jid/members/search', authMiddleware, (c) => {
  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const authUser = c.get('user') as AuthUser;
  if (
    !canManageGroupMembers(
      { id: authUser.id, role: authUser.role },
      { ...group, jid },
    )
  ) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const q = c.req.query('q') || '';
  if (!q.trim()) return c.json({ users: [] });

  const result = listUsers({ query: q.trim(), status: 'active', pageSize: 10 });
  const existingIds = new Set(
    getGroupMembers(group.folder).map((m) => m.user_id),
  );
  const users = result.users
    .filter((u) => !existingIds.has(u.id))
    .map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
    }));

  return c.json({ users });
});

// POST /api/groups/:jid/members - 添加成员
groupRoutes.post('/:jid/members', authMiddleware, async (c) => {
  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const authUser = c.get('user') as AuthUser;
  if (!canManageGroupMembers({ id: authUser.id, role: authUser.role }, group)) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  if (group.is_home) {
    return c.json({ error: 'Cannot add members to home groups' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const validation = GroupMemberAddSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const { user_id: targetUserId } = validation.data;

  // Check target user exists and is active
  const targetUser = getUserById(targetUserId);
  if (!targetUser || targetUser.status !== 'active') {
    return c.json({ error: 'User not found or inactive' }, 404);
  }

  // Check if already a member
  const existingRole = getGroupMemberRole(group.folder, targetUserId);
  if (existingRole !== null) {
    return c.json({ error: 'User is already a member' }, 409);
  }

  addGroupMember(group.folder, targetUserId, 'member', authUser.id);
  invalidateAllowedUserCache(jid);
  logger.info(
    { jid, folder: group.folder, targetUserId, addedBy: authUser.id },
    'Group member added',
  );

  const members = getGroupMembers(group.folder);
  return c.json({ success: true, members });
});

// DELETE /api/groups/:jid/members/:userId - 移除成员
groupRoutes.delete('/:jid/members/:userId', authMiddleware, (c) => {
  const jid = c.req.param('jid');
  const targetUserId = c.req.param('userId');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const authUser = c.get('user') as AuthUser;

  // Self-removal: any member can leave
  const isSelfRemoval = targetUserId === authUser.id;
  if (!isSelfRemoval) {
    if (
      !canManageGroupMembers({ id: authUser.id, role: authUser.role }, group)
    ) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
  }

  // Check target is actually a member
  const targetRole = getGroupMemberRole(group.folder, targetUserId);
  if (targetRole === null) {
    return c.json({ error: 'User is not a member' }, 404);
  }

  // Owner cannot be removed
  if (targetRole === 'owner') {
    return c.json({ error: 'Cannot remove the owner' }, 400);
  }

  removeGroupMember(group.folder, targetUserId);
  invalidateAllowedUserCache(jid);
  logger.info(
    {
      jid,
      folder: group.folder,
      targetUserId,
      removedBy: authUser.id,
      isSelfRemoval,
    },
    'Group member removed',
  );

  const members = getGroupMembers(group.folder);
  return c.json({ success: true, members });
});

// --- MCP Configuration Routes ---

// GET /api/groups/:jid/mcp - 获取工作区 MCP 配置
groupRoutes.get('/:jid/mcp', authMiddleware, (c) => {
  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const authUser = c.get('user') as AuthUser;
  if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
    return c.json({ error: 'Group not found' }, 404);
  }

  return c.json({
    mcp_mode: group.mcp_mode ?? 'inherit',
    selected_mcps: group.selected_mcps ?? null,
  });
});

// PUT /api/groups/:jid/mcp - 更新工作区 MCP 配置
groupRoutes.put('/:jid/mcp', authMiddleware, async (c) => {
  const jid = c.req.param('jid');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const authUser = c.get('user') as AuthUser;
  if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
    return c.json({ error: 'Group not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const mcp_mode = body.mcp_mode;
  const selected_mcps = body.selected_mcps;

  // Validate mcp_mode
  if (
    mcp_mode !== undefined &&
    mcp_mode !== 'inherit' &&
    mcp_mode !== 'custom'
  ) {
    return c.json({ error: 'Invalid mcp_mode' }, 400);
  }

  // Validate selected_mcps
  if (selected_mcps !== undefined && selected_mcps !== null) {
    if (!Array.isArray(selected_mcps)) {
      return c.json({ error: 'selected_mcps must be an array' }, 400);
    }
    for (const mcp of selected_mcps) {
      if (typeof mcp !== 'string') {
        return c.json({ error: 'selected_mcps must contain strings' }, 400);
      }
    }
  }

  // Update the group
  const updatedGroup: RegisteredGroup = {
    ...group,
    mcp_mode: mcp_mode ?? group.mcp_mode ?? 'inherit',
    selected_mcps:
      selected_mcps !== undefined ? selected_mcps : group.selected_mcps,
  };

  setRegisteredGroup(jid, updatedGroup);

  return c.json({
    success: true,
    mcp_mode: updatedGroup.mcp_mode,
    selected_mcps: updatedGroup.selected_mcps,
  });
});

export default groupRoutes;
