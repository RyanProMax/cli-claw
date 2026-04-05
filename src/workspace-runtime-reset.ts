import fs from 'node:fs';
import path from 'node:path';

import { DATA_DIR } from './config.js';
import { deleteSession, getJidsByFolder, listAgentsByJid } from './db.js';
import type { RegisteredGroup } from './types.js';

export function clearSessionJsonlFiles(folder: string, agentId?: string): void {
  const claudeDir = agentId
    ? path.join(DATA_DIR, 'sessions', folder, 'agents', agentId, '.claude')
    : path.join(DATA_DIR, 'sessions', folder, '.claude');
  if (!fs.existsSync(claudeDir)) return;

  const keep = new Set(['settings.json']);
  const entries = fs.readdirSync(claudeDir);
  for (const entry of entries) {
    if (keep.has(entry)) continue;
    const fullPath = path.join(claudeDir, entry);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

export async function resetWorkspaceRuntimeState(
  deps: {
    queue: { stopGroup: (jid: string, opts: { force: boolean }) => Promise<unknown> };
    getSessions: () => Record<string, string>;
  },
  jid: string,
  group: RegisteredGroup,
): Promise<void> {
  const siblingJids = getJidsByFolder(group.folder);
  const agents = jid.startsWith('web:') ? listAgentsByJid(jid) : [];
  const stopTargets = new Set<string>(siblingJids);

  for (const agent of agents) {
    stopTargets.add(`${jid}#agent:${agent.id}`);
  }

  await Promise.all(
    [...stopTargets].map((targetJid) =>
      deps.queue.stopGroup(targetJid, { force: true }),
    ),
  );

  clearSessionJsonlFiles(group.folder);
  deleteSession(group.folder);
  delete deps.getSessions()[group.folder];

  for (const agent of agents) {
    clearSessionJsonlFiles(group.folder, agent.id);
    deleteSession(group.folder, agent.id);
  }
}
