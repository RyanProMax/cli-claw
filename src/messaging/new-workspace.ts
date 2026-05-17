import crypto from 'crypto';

import { LAUNCH_CWD } from '../core/app-root.js';
import { materializeWorkspaceDefaultCwd } from '../core/workspace/workspace-cwd.js';
import type { MountAllowlist, RegisteredGroup } from '../domain/types.js';

export interface CreateImNewWorkspaceGroupOptions {
  name: string;
  userId: string;
  launchCwd?: string;
  allowlist?: MountAllowlist | null;
}

export interface CreatedImNewWorkspaceGroup {
  jid: string;
  folder: string;
  group: RegisteredGroup;
}

export type CreateImNewWorkspaceGroupResult =
  | CreatedImNewWorkspaceGroup
  | { error: string };

export function createImNewWorkspaceGroup(
  options: CreateImNewWorkspaceGroupOptions,
): CreateImNewWorkspaceGroupResult {
  const jid = `web:${crypto.randomUUID()}`;
  const folder = `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  const group: RegisteredGroup = {
    name: options.name,
    folder,
    added_at: now,
    created_by: options.userId,
  };

  const materialized = materializeWorkspaceDefaultCwd(group, {
    launchCwd: options.launchCwd ?? LAUNCH_CWD,
    allowlist: options.allowlist,
    fieldLabel: 'CLI launch cwd',
  });

  if ('error' in materialized) return { error: materialized.error };

  return {
    jid,
    folder,
    group: materialized.group,
  };
}
