import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-workflow-ctx-'));
  tempHomes.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function loadWorkflowModules() {
  const home = createTempHome();
  vi.stubEnv('HOME', home);
  const db = await import('../../../../src/storage/db.ts');
  const context = await import('../../../../src/agent/workflow/context.ts');
  db.initDatabase();
  return { context, db };
}

describe('workflow context persistence', () => {
  test('generates stable context ids by workspace folder and workflow id', async () => {
    const { context, db } = await loadWorkflowModules();

    const first = context.buildWorkflowContextId('/workspace/a', 'research');
    const again = context.buildWorkflowContextId('/workspace/a', 'research');
    const otherFolder = context.buildWorkflowContextId(
      '/workspace/b',
      'research',
    );

    expect(first).toBe(again);
    expect(first).toMatch(/^wfctx_[a-f0-9]{32}$/);
    expect(otherFolder).not.toBe(first);

    db.closeDatabase();
  });

  test('creates workflow context without touching the user session slot', async () => {
    const { context, db } = await loadWorkflowModules();

    db.setSession('workspace-a', 'primary-user-session');

    const workflowContext = context.getOrCreateWorkflowContext({
      folder: 'workspace-a',
      workflowId: 'investment-research',
      metadata: { trigger: 'unit-test' },
    });
    const loadedAgain = context.getOrCreateWorkflowContext({
      folder: 'workspace-a',
      workflowId: 'investment-research',
    });

    expect(loadedAgain.id).toBe(workflowContext.id);
    expect(workflowContext.thread_id).toBe(workflowContext.id);
    expect(workflowContext.runtime_agent_id).toBe(
      `workflow:${workflowContext.id}`,
    );
    expect(workflowContext.metadata).toEqual({ trigger: 'unit-test' });
    expect(db.getSession('workspace-a')).toBe('primary-user-session');
    expect(db.getSession('workspace-a', workflowContext.runtime_agent_id)).toBe(
      undefined,
    );

    db.closeDatabase();
  });

  test('audits workflow runs and steps independently of chat history', async () => {
    const { context, db } = await loadWorkflowModules();
    const workflowContext = context.getOrCreateWorkflowContext({
      folder: 'workspace-a',
      workflowId: 'qa-review',
    });

    const run = context.createWorkflowRun({
      contextId: workflowContext.id,
      folder: 'workspace-a',
      workflowId: 'qa-review',
      triggerChatJid: 'web:workspace-a',
      triggerMessageId: 'msg-1',
      triggerUserId: 'user-1',
      prompt: 'review this change',
      metadata: { source: 'slash-command' },
    });
    context.updateWorkflowRunStatus(run.id, {
      status: 'running',
      startedAt: '2026-05-17T10:00:00.000Z',
    });
    context.recordWorkflowRunStep({
      runId: run.id,
      nodeId: 'review',
      roleId: 'qa',
      status: 'success',
      attempt: 1,
      input: { prompt: 'review this change' },
      output: { summary: 'looks good' },
      startedAt: '2026-05-17T10:00:01.000Z',
      completedAt: '2026-05-17T10:00:02.000Z',
    });
    context.updateWorkflowRunStatus(run.id, {
      status: 'success',
      result: 'looks good',
      completedAt: '2026-05-17T10:00:03.000Z',
    });

    const runs = context.listWorkflowRuns({ folder: 'workspace-a', limit: 5 });
    const steps = context.listWorkflowRunSteps(run.id);
    const refreshedContext = db.getWorkflowContextById(workflowContext.id);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: run.id,
      context_id: workflowContext.id,
      workflow_id: 'qa-review',
      folder: 'workspace-a',
      thread_id: workflowContext.thread_id,
      trigger_chat_jid: 'web:workspace-a',
      trigger_message_id: 'msg-1',
      trigger_user_id: 'user-1',
      prompt: 'review this change',
      status: 'success',
      result: 'looks good',
      metadata: { source: 'slash-command' },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      run_id: run.id,
      node_id: 'review',
      role_id: 'qa',
      status: 'success',
      attempt: 1,
      input: { prompt: 'review this change' },
      output: { summary: 'looks good' },
    });
    expect(refreshedContext?.active_run_id).toBeNull();
    expect(db.getMessagesPage('web:workspace-a', undefined, 10)).toEqual([]);

    db.closeDatabase();
  });

  test('rejects workflow runs whose folder or workflow id does not match the context', async () => {
    const { context, db } = await loadWorkflowModules();
    const workflowContext = context.getOrCreateWorkflowContext({
      folder: 'workspace-a',
      workflowId: 'research',
    });

    expect(() =>
      context.createWorkflowRun({
        contextId: workflowContext.id,
        folder: 'workspace-b',
        workflowId: 'research',
        triggerChatJid: 'web:workspace-b',
        prompt: 'do not cross streams',
      }),
    ).toThrow(
      'workflow run folder/workflowId must match workflow context workspace-a/research',
    );
    expect(() =>
      context.createWorkflowRun({
        contextId: workflowContext.id,
        folder: 'workspace-a',
        workflowId: 'qa-review',
        triggerChatJid: 'web:workspace-a',
        prompt: 'do not cross streams',
      }),
    ).toThrow(
      'workflow run folder/workflowId must match workflow context workspace-a/research',
    );
    expect(context.listWorkflowRuns({ limit: 5 })).toEqual([]);

    db.closeDatabase();
  });
});
