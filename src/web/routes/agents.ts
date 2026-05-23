import { Hono } from 'hono';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Variables } from '../context.js';
import { authMiddleware } from '../middleware/auth.js';
import { getWebDeps } from '../context.js';
import {
  createAgent,
  deleteAgent,
  deleteSession,
  getAgent,
  listAgentsByJid,
  updateAgentInfo,
  updateAgentStatus,
} from '../../storage/agents.js';
import {
  deleteMessagesForChatJid,
  ensureChatExists,
  updateChatName,
} from '../../storage/messages.js';
import {
  getGroupsByTargetAgent,
  getRegisteredGroup,
} from '../../storage/workspaces.js';
import { DATA_DIR } from '../../core/config.js';
import type { SubAgent } from '../../domain/types.js';
import { ensureAgentDirectories } from '../../core/utils.js';
import { logger } from '../../core/logger.js';

const router = new Hono<{ Variables: Variables }>();

router.get('/:jid/agents', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const agents = listAgentsByJid(jid).map((agent) => {
    const base = {
      id: agent.id,
      name: agent.name,
      prompt: agent.prompt,
      status: agent.status,
      kind: agent.kind,
      created_at: agent.created_at,
      completed_at: agent.completed_at,
      result_summary: agent.result_summary,
    };
    if (agent.kind !== 'conversation') return base;
    return {
      ...base,
      linked_im_groups: getGroupsByTargetAgent(agent.id).map(
        ({ jid, group }) => ({
          jid,
          name: group.name,
        }),
      ),
    };
  });
  return c.json({ agents });
});

router.post('/:jid/agents', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 40) {
    return c.json({ error: 'Name is required (max 40 chars)' }, 400);
  }
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';

  const agentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const agent: SubAgent = {
    id: agentId,
    group_folder: group.folder,
    chat_jid: jid,
    name,
    prompt: description,
    status: 'idle',
    kind: 'conversation',
    created_by: null,
    created_at: now,
    completed_at: null,
    result_summary: null,
    last_im_jid: null,
    spawned_from_jid: null,
  };

  createAgent(agent);
  ensureAgentDirectories(group.folder, agentId);
  ensureChatExists(`${jid}#agent:${agentId}`);

  const { broadcastAgentStatus } = await import('../app.js');
  broadcastAgentStatus(jid, agentId, 'idle', name, description);

  logger.info({ agentId, jid, name }, 'Conversation agent created');
  return c.json({
    agent: {
      id: agent.id,
      name: agent.name,
      prompt: agent.prompt,
      status: agent.status,
      kind: agent.kind,
      created_at: agent.created_at,
    },
  });
});

router.patch('/:jid/agents/:agentId', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const agentId = c.req.param('agentId');
  const agent = getAgent(agentId);
  if (!agent || agent.chat_jid !== jid) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 40) {
    return c.json({ error: 'Name is required (max 40 chars)' }, 400);
  }

  updateAgentInfo(agentId, name, agent.prompt);
  updateChatName(`${jid}#agent:${agentId}`, name);

  const { broadcastAgentStatus } = await import('../app.js');
  broadcastAgentStatus(jid, agentId, agent.status, name, agent.prompt);
  return c.json({ success: true });
});

router.delete('/:jid/agents/:agentId', authMiddleware, async (c) => {
  const jid = decodeURIComponent(c.req.param('jid'));
  const agentId = c.req.param('agentId');
  const group = getRegisteredGroup(jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  const agent = getAgent(agentId);
  if (!agent || agent.chat_jid !== jid) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const linkedImGroups = getGroupsByTargetAgent(agentId);
  if (agent.kind === 'conversation' && linkedImGroups.length > 0) {
    return c.json(
      {
        error:
          'Agent has active IM bindings. Unbind all IM groups before deleting.',
        linked_im_groups: linkedImGroups.map(({ jid, group }) => ({
          jid,
          name: group.name,
        })),
      },
      409,
    );
  }

  if (agent.status === 'running' || agent.status === 'idle') {
    updateAgentStatus(agentId, 'error', '用户手动停止');
    void getWebDeps()?.queue.stopGroup(`${jid}#agent:${agentId}`);
  }

  fs.rmSync(path.join(DATA_DIR, 'ipc', group.folder, 'agents', agentId), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(DATA_DIR, 'sessions', group.folder, 'agents', agentId), {
    recursive: true,
    force: true,
  });
  deleteMessagesForChatJid(`${jid}#agent:${agentId}`);
  deleteSession(group.folder, agentId);
  deleteAgent(agentId);

  const { broadcastAgentStatus } = await import('../app.js');
  broadcastAgentStatus(
    jid,
    agentId,
    'error',
    agent.name,
    agent.prompt,
    '__removed__',
  );
  return c.json({ success: true });
});

export default router;
