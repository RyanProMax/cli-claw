import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

async function loadStorage() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fabric-threads-'));
  vi.stubEnv('HOME', home);
  vi.resetModules();
  const db = await import('../../../src/storage/db.ts');
  const threads = await import('../../../src/storage/threads.ts');
  db.initDatabase();
  return { home, db, threads };
}

describe('thread storage', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    cleanup = null;
  });

  afterEach(() => {
    cleanup?.();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('upserts a main thread and lists active threads for a workspace', async () => {
    const { home, db, threads } = await loadStorage();
    cleanup = () => {
      db.closeDatabase();
      fs.rmSync(home, { recursive: true, force: true });
    };

    const created = threads.upsertThread({
      id: 'thread-main-hkipo',
      workspaceJid: 'web:hkipo',
      kind: 'main',
      title: '主线',
      runtimeAgentId: null,
      status: 'active',
      lastActiveAt: '2026-05-24T13:00:00.000Z',
    });

    expect(created).toMatchObject({
      id: 'thread-main-hkipo',
      workspace_jid: 'web:hkipo',
      kind: 'main',
      title: '主线',
      runtime_agent_id: null,
      status: 'active',
    });

    expect(threads.getMainThread('web:hkipo')).toMatchObject({
      id: 'thread-main-hkipo',
      title: '主线',
    });
    expect(threads.listThreadsForWorkspace('web:hkipo')).toHaveLength(1);
  });

  test('stores IM entry route separately from registered_groups binding fields', async () => {
    const { home, db, threads } = await loadStorage();
    cleanup = () => {
      db.closeDatabase();
      fs.rmSync(home, { recursive: true, force: true });
    };

    threads.upsertImEntryRoute({
      imJid: 'feishu:private-1',
      defaultWorkspaceJid: 'web:hkipo',
      activeWorkspaceJid: 'web:stock',
      activeThreadId: 'thread-watch',
      activeUntil: '2026-05-24T14:00:00.000Z',
      pinned: true,
    });

    expect(threads.getImEntryRoute('feishu:private-1')).toMatchObject({
      im_jid: 'feishu:private-1',
      default_workspace_jid: 'web:hkipo',
      active_workspace_jid: 'web:stock',
      active_thread_id: 'thread-watch',
      active_until: '2026-05-24T14:00:00.000Z',
      pinned: true,
    });
  });
});
