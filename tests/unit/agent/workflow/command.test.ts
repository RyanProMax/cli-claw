import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeWorkflowFixture(workspaceRoot: string): void {
  writeFile(
    path.join(workspaceRoot, '.agents', 'agent-roles', 'analyst.md'),
    [
      '---',
      'id: analyst',
      'name: 投研分析师',
      'allowedTools: send_message',
      'permissionMode: readonly',
      '---',
      '',
      '只输出可溯源的投研结论。',
    ].join('\n'),
  );
  writeFile(
    path.join(workspaceRoot, '.agents', 'workflows', 'research.json'),
    JSON.stringify(
      {
        id: 'research',
        name: '投研工作流',
        roles: ['analyst'],
        start: 'research',
        nodes: [{ id: 'research', type: 'role_task', roleId: 'analyst' }],
        edges: [{ from: 'research', to: '__end__' }],
      },
      null,
      2,
    ),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function loadWorkflowCommand() {
  const home = tempDir('cli-claw-workflow-command-home-');
  vi.stubEnv('HOME', home);
  const db = await import('../../../../src/storage/db.ts');
  const command = await import('../../../../src/agent/workflow/command.ts');
  db.initDatabase();
  return { command, db };
}

describe('workflow command execution', () => {
  test('lists workflows from the current workspace', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-workspace-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();

    await expect(
      command.executeWorkflowCommand({
        group: {
          name: 'Workspace A',
          folder: 'workspace-a',
          added_at: '2026-05-17T10:00:00.000Z',
        },
        chatJid: 'web:workspace-a',
        argsText: '',
        workspaceRoot,
      }),
    ).resolves.toContain('- research：投研工作流');

    db.closeDatabase();
  });

  test('creates an isolated workflow run and invokes the graph runner', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-run-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: '分析英伟达',
      result: '投研结论完成',
      stepResults: {},
    });

    const reply = await command.executeWorkflowCommand({
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
      },
      chatJid: 'web:workspace-a',
      argsText: 'research 分析英伟达',
      triggerUserId: 'user-1',
      workspaceRoot,
      runGraph,
    });

    expect(reply).toContain('工作流 投研工作流 (research) 完成');
    expect(reply).toContain('投研结论完成');
    expect(runGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '分析英伟达',
        workflow: expect.objectContaining({ id: 'research' }),
        context: expect.objectContaining({
          folder: 'workspace-a',
          workflow_id: 'research',
        }),
        run: expect.objectContaining({
          folder: 'workspace-a',
          workflow_id: 'research',
          trigger_chat_jid: 'web:workspace-a',
          trigger_user_id: 'user-1',
        }),
        checkpointer: expect.any(Object),
      }),
    );

    db.closeDatabase();
  });
});
