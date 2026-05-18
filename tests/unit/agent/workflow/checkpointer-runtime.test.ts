import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';

describe('workflow checkpointer runtime compatibility', () => {
  test('runs a checkpointed graph under Bun without loading better-sqlite3', () => {
    const tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-bun-checkpoint-'),
    );
    const output = execFileSync(
      'bun',
      [
        '-e',
        [
          'const { runWorkflowGraph, getPersistentWorkflowCheckpointer } = await import("./src/agent/workflow/engine.ts");',
          'const now = new Date().toISOString();',
          'const workflow = { id: "bun-checkpoint", name: "Bun Checkpoint", description: "test", roles: [], start: "task", nodes: [{ id: "task", type: "local_task", taskId: "test.echo", outputArtifact: "echo" }], edges: [{ from: "task", to: "__end__" }], maxRetries: 0, sourcePath: "test" };',
          'const context = { id: "wfctx_bun_runtime_test", folder: "bun-runtime", workflow_id: "bun-checkpoint", thread_id: "wfctx_bun_runtime_test", runtime_agent_id: "workflow:wfctx_bun_runtime_test", active_run_id: "wfrun_bun_runtime_test", metadata: null, created_at: now, updated_at: now };',
          'const run = { id: "wfrun_bun_runtime_test", context_id: context.id, folder: "bun-runtime", workflow_id: "bun-checkpoint", thread_id: context.thread_id, trigger_chat_jid: "web:test", trigger_message_id: null, trigger_user_id: null, prompt: "hello", status: "running", result: null, error: null, metadata: null, started_at: now, completed_at: null, created_at: now, updated_at: now };',
          'await runWorkflowGraph({ workflow, roles: new Map(), group: { name: "Bun Runtime", folder: "bun-runtime", added_at: now }, context, run, prompt: "hello", localTasks: { "test.echo": async () => ({ status: "ok" }) }, recordStep: () => {}, updateRunStatus: (_id, update) => ({ ...run, ...update }), checkpointer: getPersistentWorkflowCheckpointer() });',
          "console.log('workflow-checkpointer-ok');",
        ].join('\n'),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: tempHome,
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    expect(output).toContain('workflow-checkpointer-ok');
    expect(
      fs.existsSync(
        path.join(tempHome, '.cli-claw', 'db', 'workflow-checkpoints.sqlite'),
      ),
    ).toBe(true);
  });
});
