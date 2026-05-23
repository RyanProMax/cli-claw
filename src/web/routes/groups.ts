import { Hono } from 'hono';
import crypto from 'node:crypto';
import type { Variables } from '../context.js';
import { authMiddleware } from '../middleware/auth.js';
import { GroupCreateSchema, GroupPatchSchema } from '../../core/schemas.js';
import type {
  AgentType,
  MessageHistoryCursor,
  RegisteredGroup,
} from '../../domain/types.js';
import {
  getAvailableRuntimeModelOptions,
  getAvailableRuntimeModelPresets,
  normalizeAvailableRuntimeModelPreset,
} from '../../core/runtime/model-options.js';
import {
  normalizeReasoningEffortPreset,
  normalizeSpeedTierPreset,
} from '../../core/runtime/command-registry.js';
import { getOpenAiRuntimeDefaults } from '../../core/runtime/config.js';
import {
  deleteMessage,
  ensureChatExists,
  getAllChats,
  getMessage,
  getMessagesAfter,
  getMessagesAfterMulti,
  getMessagesPage,
  getMessagesPageMulti,
  storeMessageDirect,
  updateChatName,
} from '../../storage/messages.js';
import {
  deleteGroupData,
  getAllRegisteredGroups,
  getGroupsByTargetAgent,
  getJidsByFolder,
  getRegisteredGroup,
  setRegisteredGroup,
} from '../../storage/workspaces.js';
import {
  deletePrimaryRuntimeSessions,
  getAgent,
  listAgentsByJid,
} from '../../storage/agents.js';
import { MAX_GROUP_NAME_LEN, getWebDeps } from '../context.js';
import { removeFlowArtifacts } from '../../core/workspace/file-manager.js';
import { clearSessionJsonlFiles } from '../../agent/runner/workspace-reset.js';
import { broadcastNewMessage, invalidateAllowedUserCache } from '../app.js';
import { logger } from '../../core/logger.js';

const groupRoutes = new Hono<{ Variables: Variables }>();
const DEFAULT_MAIN_JID = 'web:main';

class UnsupportedRuntimeModelError extends Error {
  constructor(
    readonly agentType: AgentType,
    readonly presets: string[],
  ) {
    super(`Unsupported ${agentType} model`);
  }
}

function normalizeAgentType(_raw: unknown): AgentType {
  return 'openai';
}

function resolveRuntimePreset(
  agentType: AgentType,
  model: unknown,
  reasoningEffort: unknown,
  speedTier: unknown,
): Pick<RegisteredGroup, 'model' | 'reasoningEffort' | 'speedTier'> {
  const defaults = getOpenAiRuntimeDefaults();
  let modelValue: string | undefined;
  if (typeof model === 'string' && model.trim()) {
    const currentModel = defaults.model ?? null;
    const normalized = normalizeAvailableRuntimeModelPreset(
      agentType,
      model.trim(),
      { currentModel },
    );
    if (!normalized) {
      throw new UnsupportedRuntimeModelError(
        agentType,
        getAvailableRuntimeModelPresets(agentType, { currentModel }),
      );
    }
    modelValue = normalized;
  }
  const effortValue =
    typeof reasoningEffort === 'string' && reasoningEffort.trim()
      ? normalizeReasoningEffortPreset(reasoningEffort.trim())
      : undefined;
  const speedValue =
    typeof speedTier === 'string' && speedTier.trim()
      ? normalizeSpeedTierPreset(speedTier.trim())
      : undefined;
  return {
    model: modelValue ?? undefined,
    reasoningEffort: effortValue ?? undefined,
    speedTier: speedValue ?? undefined,
  };
}

function workspaceFolderFromName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${cleaned || 'workspace'}-${crypto.randomUUID().slice(0, 8)}`;
}

function ensureMainGroup(): void {
  if (getRegisteredGroup(DEFAULT_MAIN_JID)) return;
  const now = new Date().toISOString();
  setRegisteredGroup(DEFAULT_MAIN_JID, {
    name: 'Main',
    folder: 'main',
    added_at: now,
    agentType: 'openai',
    is_home: true,
  });
  ensureChatExists(DEFAULT_MAIN_JID);
}

function groupKind(jid: string): 'home' | 'main' | 'feishu' | 'wechat' | 'web' {
  if (jid === DEFAULT_MAIN_JID) return 'home';
  if (jid.startsWith('feishu:')) return 'feishu';
  if (jid.startsWith('wechat:')) return 'wechat';
  return 'web';
}

function isWorkspaceListEntry(jid: string): boolean {
  return jid.startsWith('web:');
}

function buildGroupsPayload(): Record<string, any> {
  ensureMainGroup();
  const groups = getAllRegisteredGroups();
  const chats = new Map(getAllChats().map((chat) => [chat.jid, chat]));
  const result: Record<string, any> = {};

  for (const [jid, group] of Object.entries(groups)) {
    if (!isWorkspaceListEntry(jid)) continue;
    const isDefaultHome = jid === DEFAULT_MAIN_JID;
    const chat = chats.get(jid);
    result[jid] = {
      name: group.name,
      folder: group.folder,
      added_at: group.added_at,
      agent_type: group.agentType ?? 'openai',
      kind: groupKind(jid),
      is_home: isDefaultHome || undefined,
      is_my_home: isDefaultHome || undefined,
      editable: true,
      deletable: !isDefaultHome,
      lastMessage: null,
      lastMessageTime: chat?.last_message_time || group.added_at,
      model: group.model ?? null,
      reasoning_effort: group.reasoningEffort ?? null,
      speed_tier: group.speedTier ?? null,
      custom_cwd: group.customCwd,
      activation_mode: group.activation_mode ?? 'auto',
    };
  }

  return result;
}

function siblingJidsForTimeline(jid: string, group: RegisteredGroup): string[] {
  if (!group.is_home) return [jid];
  const siblings = getJidsByFolder(group.folder).filter(
    (candidate) =>
      candidate === jid ||
      candidate.startsWith('feishu:') ||
      candidate.startsWith('wechat:'),
  );
  return siblings.length > 0 ? siblings : [jid];
}

function parseCursor(
  raw: string | undefined,
): MessageHistoryCursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as MessageHistoryCursor;
    if (parsed && typeof parsed.timestamp === 'string') return parsed;
  } catch {
    // legacy timestamp cursor
  }
  return { timestamp: raw };
}

function availableImGroupsForTarget(targetJid: string): any[] {
  const groups = getAllRegisteredGroups();
  const target = getRegisteredGroup(targetJid);
  return Object.entries(groups)
    .filter(([jid]) => jid.startsWith('feishu:') || jid.startsWith('wechat:'))
    .filter(([, group]) => !target || group.folder === target.folder || true)
    .map(([jid, group]) => {
      let boundTargetName: string | null = null;
      let boundWorkspaceName: string | null = null;
      if (group.target_agent_id) {
        const agent = getAgent(group.target_agent_id);
        boundTargetName = agent?.name ?? group.target_agent_id;
        const owner = agent ? getRegisteredGroup(agent.chat_jid) : undefined;
        boundWorkspaceName = owner?.name ?? null;
      } else if (group.target_main_jid) {
        const bound = getRegisteredGroup(group.target_main_jid);
        boundTargetName = bound?.name ?? group.target_main_jid;
        boundWorkspaceName = bound?.name ?? null;
      }
      return {
        jid,
        name: group.name,
        bound_agent_id: group.target_agent_id ?? null,
        bound_main_jid: group.target_main_jid ?? null,
        bound_target_name: boundTargetName,
        bound_workspace_name: boundWorkspaceName,
        reply_policy: group.reply_policy ?? 'source_only',
        channel_type: jid.startsWith('feishu:') ? 'feishu' : 'wechat',
        activation_mode: group.activation_mode ?? 'auto',
      };
    });
}

groupRoutes.get('/', authMiddleware, (c) => {
  return c.json({ groups: buildGroupsPayload() });
});

groupRoutes.get('/:jid/runtime-model-options', authMiddleware, (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  const defaults = getOpenAiRuntimeDefaults();
  const currentModel = group.model ?? defaults.model ?? null;
  return c.json({
    current_model: currentModel,
    options: getAvailableRuntimeModelOptions(group.agentType ?? 'openai', {
      currentModel,
    }),
  });
});

groupRoutes.post('/', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = GroupCreateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const name = validation.data.name.trim().slice(0, MAX_GROUP_NAME_LEN);
  const folder = workspaceFolderFromName(name);
  const jid = `web:${folder}`;
  let runtime: Pick<RegisteredGroup, 'model' | 'reasoningEffort' | 'speedTier'>;
  try {
    runtime = resolveRuntimePreset(
      normalizeAgentType(validation.data.agent_type),
      validation.data.model,
      validation.data.reasoning_effort,
      validation.data.speed_tier,
    );
  } catch (err) {
    if (err instanceof UnsupportedRuntimeModelError) {
      return c.json({ error: err.message, presets: err.presets }, 400);
    }
    throw err;
  }
  const group: RegisteredGroup = {
    name,
    folder,
    added_at: new Date().toISOString(),
    agentType: 'openai',
    customCwd: validation.data.custom_cwd,
    ...runtime,
  };

  setRegisteredGroup(jid, group);
  ensureChatExists(jid);
  updateChatName(jid, name);
  const deps = getWebDeps();
  if (deps) deps.getRegisteredGroups()[jid] = group;
  return c.json({ success: true, jid, folder, group });
});

groupRoutes.patch('/:jid', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const existing = getRegisteredGroup(jid);
  if (!existing) return c.json({ error: 'Group not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const validation = GroupPatchSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const updated: RegisteredGroup = { ...existing };
  if (validation.data.name !== undefined) {
    updated.name = validation.data.name.trim().slice(0, MAX_GROUP_NAME_LEN);
    updateChatName(jid, updated.name);
  }
  if (validation.data.activation_mode !== undefined) {
    updated.activation_mode = validation.data.activation_mode;
  }
  if (
    validation.data.agent_type !== undefined ||
    validation.data.model !== undefined ||
    validation.data.reasoning_effort !== undefined ||
    validation.data.speed_tier !== undefined
  ) {
    let runtime: Pick<
      RegisteredGroup,
      'model' | 'reasoningEffort' | 'speedTier'
    >;
    try {
      runtime = resolveRuntimePreset(
        normalizeAgentType(validation.data.agent_type ?? updated.agentType),
        validation.data.model ?? updated.model,
        validation.data.reasoning_effort ?? updated.reasoningEffort,
        validation.data.speed_tier ?? updated.speedTier,
      );
    } catch (err) {
      if (err instanceof UnsupportedRuntimeModelError) {
        return c.json({ error: err.message, presets: err.presets }, 400);
      }
      throw err;
    }
    updated.agentType = 'openai';
    if (validation.data.model !== undefined)
      updated.model = runtime.model ?? null;
    if (validation.data.reasoning_effort !== undefined) {
      updated.reasoningEffort = runtime.reasoningEffort ?? null;
    }
    if (validation.data.speed_tier !== undefined) {
      updated.speedTier = runtime.speedTier ?? null;
    }
    deletePrimaryRuntimeSessions(updated.folder);
  }

  setRegisteredGroup(jid, updated);
  const deps = getWebDeps();
  if (deps) deps.getRegisteredGroups()[jid] = updated;
  invalidateAllowedUserCache(jid);
  return c.json({ success: true, group: updated });
});

groupRoutes.delete('/:jid', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  if (jid === DEFAULT_MAIN_JID)
    return c.json({ error: 'Home workspace cannot be deleted' }, 400);

  const deps = getWebDeps();
  if (deps) {
    await deps.queue.stopGroup(jid).catch((err) => {
      logger.warn({ err, jid }, 'Failed to stop runner before deleting group');
    });
  }
  deleteGroupData(jid, group.folder);
  removeFlowArtifacts(group.folder);
  if (deps) {
    delete deps.getRegisteredGroups()[jid];
    delete deps.getSessions()[group.folder];
  }
  return c.json({ success: true });
});

groupRoutes.post('/:jid/stop', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not ready' }, 503);
  await deps.queue.stopGroup(jid);
  return c.json({ success: true });
});

groupRoutes.post('/:jid/interrupt', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const interrupted = getWebDeps()?.queue.interruptQuery(jid) ?? false;
  if (interrupted) {
    const messageId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    storeMessageDirect(
      messageId,
      jid,
      '__system__',
      'System',
      'query_interrupted',
      timestamp,
      true,
    );
    broadcastNewMessage(jid, {
      id: messageId,
      chat_jid: jid,
      sender: '__system__',
      sender_name: 'System',
      content: 'query_interrupted',
      timestamp,
      is_from_me: true,
    });
  }
  return c.json({ success: true, interrupted });
});

groupRoutes.post('/:jid/reset-session', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  const deps = getWebDeps();
  if (deps) {
    await Promise.all(
      getJidsByFolder(group.folder).map((candidate) =>
        deps.queue.stopGroup(candidate, { force: true }).catch(() => undefined),
      ),
    );
  }
  deletePrimaryRuntimeSessions(group.folder);
  clearSessionJsonlFiles(group.folder);
  return c.json({ success: true });
});

groupRoutes.post('/:jid/clear-history', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  const deps = getWebDeps();
  if (deps) {
    await Promise.all(
      getJidsByFolder(group.folder).map((candidate) =>
        deps.queue.stopGroup(candidate, { force: true }).catch(() => undefined),
      ),
    );
  }
  for (const candidate of getJidsByFolder(group.folder)) {
    deleteGroupData(candidate, group.folder);
  }
  setRegisteredGroup(jid, group);
  ensureChatExists(jid);
  return c.json({ success: true });
});

groupRoutes.get('/:jid/messages', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const limitRaw = parseInt(c.req.query('limit') || '50', 10);
  const limit = Math.min(
    Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : 50,
    200,
  );
  const agentId = c.req.query('agentId');
  const chatJid = agentId ? `${jid}#agent:${agentId}` : jid;
  const before = parseCursor(c.req.query('before'));
  const after = parseCursor(c.req.query('after'));
  const jids = agentId ? [chatJid] : siblingJidsForTimeline(jid, group);

  const messages = after
    ? jids.length > 1
      ? getMessagesAfterMulti(jids, after, limit)
      : getMessagesAfter(jids[0], after, limit)
    : jids.length > 1
      ? getMessagesPageMulti(jids, before, limit + 1)
      : getMessagesPage(jids[0], before, limit + 1);
  const hasMore = !after && messages.length > limit;
  return c.json({
    messages: hasMore ? messages.slice(0, limit) : messages,
    hasMore,
  });
});

groupRoutes.delete('/:jid/messages/:messageId', authMiddleware, (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const messageId = decodeURIComponent(c.req.param('messageId'));
  const message = getMessage(jid, messageId);
  if (!message) return c.json({ error: 'Message not found' }, 404);
  const deleted = deleteMessage(jid, messageId);
  return c.json({ success: deleted });
});

groupRoutes.get('/:jid/im-groups', authMiddleware, (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  return c.json({ imGroups: availableImGroupsForTarget(jid) });
});

groupRoutes.put('/:jid/im-binding', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const target = getRegisteredGroup(jid);
  if (!target) return c.json({ error: 'Group not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const imJid = typeof body.im_jid === 'string' ? body.im_jid : '';
  const imGroup = getRegisteredGroup(imJid);
  if (!imGroup) return c.json({ error: 'IM group not found' }, 404);
  setRegisteredGroup(imJid, {
    ...imGroup,
    target_main_jid: jid,
    target_agent_id: undefined,
    activation_mode: body.activation_mode ?? imGroup.activation_mode ?? 'auto',
  });
  invalidateAllowedUserCache(imJid);
  return c.json({ success: true });
});

groupRoutes.delete('/:jid/im-binding/:imJid', authMiddleware, (c) => {
  const imJid = decodeURIComponent(c.req.param('imJid'));
  const imGroup = getRegisteredGroup(imJid);
  if (!imGroup) return c.json({ error: 'IM group not found' }, 404);
  setRegisteredGroup(imJid, {
    ...imGroup,
    target_main_jid: undefined,
    target_agent_id: undefined,
  });
  invalidateAllowedUserCache(imJid);
  return c.json({ success: true });
});

groupRoutes.put(
  '/:jid/agents/:agentId/im-binding',
  authMiddleware,
  async (c) => {
    const agentId = c.req.param('agentId');
    const agent = getAgent(agentId);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const imJid = typeof body.im_jid === 'string' ? body.im_jid : '';
    const imGroup = getRegisteredGroup(imJid);
    if (!imGroup) return c.json({ error: 'IM group not found' }, 404);
    setRegisteredGroup(imJid, {
      ...imGroup,
      target_agent_id: agentId,
      target_main_jid: undefined,
    });
    invalidateAllowedUserCache(imJid);
    return c.json({ success: true });
  },
);

groupRoutes.delete(
  '/:jid/agents/:agentId/im-binding/:imJid',
  authMiddleware,
  (c) => {
    const imJid = decodeURIComponent(c.req.param('imJid'));
    const imGroup = getRegisteredGroup(imJid);
    if (!imGroup) return c.json({ error: 'IM group not found' }, 404);
    setRegisteredGroup(imJid, {
      ...imGroup,
      target_agent_id: undefined,
      target_main_jid: undefined,
    });
    invalidateAllowedUserCache(imJid);
    return c.json({ success: true });
  },
);

export default groupRoutes;
