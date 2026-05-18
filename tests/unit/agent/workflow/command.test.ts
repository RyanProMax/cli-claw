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

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 500,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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

    expect(reply).toContain('✅ 工作流 投研工作流 (research) 完成');
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

  test('passes structured initial input into workflow runs', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-input-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();
    const runGraph = vi.fn().mockResolvedValue({
      prompt: '分析港股 IPO',
      result: 'IPO 报告完成',
      stepResults: {},
      artifacts: {},
    });

    const reply = await command.executeWorkflowCommand({
      group: {
        name: 'Workspace A',
        folder: 'workspace-a',
        added_at: '2026-05-17T10:00:00.000Z',
      },
      chatJid: 'web:workspace-a',
      argsText: 'research 分析港股 IPO',
      workspaceRoot,
      runGraph,
      initialInput: {
        command: 'hkipo',
        includeClosed: true,
      },
    } as any);

    expect(reply).toContain('IPO 报告完成');
    expect(runGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        initialInput: {
          command: 'hkipo',
          includeClosed: true,
        },
      }),
    );

    db.closeDatabase();
  });

  test('background workflow returns a started acknowledgement before graph completion', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-background-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();
    const gate = deferred<void>();
    const backgroundResults: string[] = [];
    const runGraph = vi.fn(async () => {
      await gate.promise;
      return {
        prompt: '分析英伟达',
        result: '投研结论完成',
        stepResults: {},
      };
    });

    const execution = command.executeWorkflowCommand({
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
      background: true,
      onBackgroundResult: async (message: string) => {
        backgroundResults.push(message);
      },
    } as any);

    const firstResult = await Promise.race([
      execution,
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 25),
      ),
    ]);
    gate.resolve();

    expect(firstResult).not.toBe('timeout');
    expect(firstResult).toContain('🚀 已启动工作流 投研工作流 (research)');
    expect(backgroundResults).toEqual([]);

    await waitForCondition(() => backgroundResults.length === 1);
    expect(backgroundResults[0]).toContain(
      '✅ 工作流 投研工作流 (research) 完成',
    );
    expect(backgroundResults[0]).toContain('投研结论完成');

    db.closeDatabase();
  });

  test('background workflow reports failures and timeouts to the trigger session', async () => {
    const workspaceRoot = tempDir('cli-claw-workflow-command-background-fail-');
    writeWorkflowFixture(workspaceRoot);
    const { command, db } = await loadWorkflowCommand();
    const backgroundResults: string[] = [];
    const runGraph = vi.fn(async () => {
      throw new Error('Agent Process timed out after 1800000ms');
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
      background: true,
      onBackgroundResult: async (message: string) => {
        backgroundResults.push(message);
      },
    } as any);

    expect(reply).toContain('🚀 已启动工作流 投研工作流 (research)');
    await waitForCondition(() => backgroundResults.length === 1);
    expect(backgroundResults[0]).toContain(
      '❌ 工作流 投研工作流 (research) 失败',
    );
    expect(backgroundResults[0]).toContain(
      'Agent Process timed out after 1800000ms',
    );

    db.closeDatabase();
  });
});
