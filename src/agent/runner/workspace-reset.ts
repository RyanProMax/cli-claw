import fs from 'node:fs';
import path from 'node:path';

import { DATA_DIR } from '../../core/config.js';
import {
  deletePrimaryRuntimeSessions,
  deleteSession,
  listAgentsByJid,
} from '../../storage/agents.js';
import { getJidsByFolder } from '../../storage/workspaces.js';
import type { RegisteredGroup } from '../../domain/types.js';

export function clearSessionJsonlFiles(folder: string, agentId?: string): void {
  const artifactDir = agentId
    ? path.join(DATA_DIR, 'sessions', folder, 'agents', agentId, '.openai')
    : path.join(DATA_DIR, 'sessions', folder, '.openai');
  if (!fs.existsSync(artifactDir)) return;

  const keep = new Set(['settings.json']);
  const entries = fs.readdirSync(artifactDir);
  for (const entry of entries) {
    if (keep.has(entry)) continue;
    const fullPath = path.join(artifactDir, entry);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

export async function resetWorkspaceAgentSessionState(
  deps: {
    queue: {
      stopGroup: (jid: string, opts: { force: boolean }) => Promise<unknown>;
    };
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
  deletePrimaryRuntimeSessions(group.folder);
  delete deps.getSessions()[group.folder];

  for (const agent of agents) {
    clearSessionJsonlFiles(group.folder, agent.id);
    deleteSession(group.folder, agent.id);
  }
}
