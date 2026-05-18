import fs from 'fs';
import path from 'path';

import { APP_ROOT } from '../../core/app-root.js';
import { GROUPS_DIR } from '../../core/config.js';
import type { RegisteredGroup } from '../../domain/types.js';
import { createWorkflowRun, getOrCreateWorkflowContext } from './context.js';
import {
  discoverWorkflowConfigs,
  type WorkflowRoleDefinition,
} from './config.js';
import {
  getPersistentWorkflowCheckpointer,
  runWorkflowGraph,
  type WorkflowLocalTaskRegistry,
} from './engine.js';
import {
  createDefaultWorkflowLocalTasks,
  getDefaultWorkflowLocalTaskIds,
} from './local-tasks.js';
import { DEFAULT_WORKFLOW_KNOWN_TOOLS } from './tools.js';

type WorkflowDiscovery = ReturnType<typeof discoverWorkflowConfigs>;

export interface WorkflowCommandOptions {
  group: RegisteredGroup;
  chatJid: string;
  argsText: string;
  triggerUserId?: string | null;
  workspaceRoot?: string;
  knownTools?: string[];
  knownLocalTasks?: string[];
  initialInput?: Record<string, unknown>;
  localTasks?: WorkflowLocalTaskRegistry;
  runGraph?: typeof runWorkflowGraph;
}

function splitWorkflowArgs(argsText: string): {
  workflowId: string | null;
  prompt: string;
} {
  const trimmed = argsText.trim();
  if (!trimmed) return { workflowId: null, prompt: '' };
  const [workflowId = '', ...rest] = trimmed.split(/\s+/);
  return {
    workflowId,
    prompt: rest.join(' ').trim(),
  };
}

function resolveWorkflowWorkspaceRoot(
  group: RegisteredGroup,
  explicitRoot?: string,
): string {
  const candidate =
    explicitRoot || group.customCwd || path.join(GROUPS_DIR, group.folder);
  return fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
}

function formatWorkflowErrors(errors: string[]): string {
  return ['工作流配置存在错误：', ...errors.map((error) => `- ${error}`)].join(
    '\n',
  );
}

function formatWorkflowList(
  workflows: ReturnType<typeof discoverWorkflowConfigs>['workflows'],
): string {
  if (workflows.length === 0) {
    return '当前工作区没有可用工作流，请在 .agents/workflows/ 下添加配置';
  }
  return [
    '可用工作流：',
    ...workflows.map((workflow) => `- ${workflow.id}：${workflow.name}`),
    '',
    '用法：/workflow <id> <任务>',
  ].join('\n');
}

function discoverWorkflowConfigsWithBuiltins(options: {
  workspaceRoot: string;
  knownTools: string[];
  knownLocalTasks: string[];
}): WorkflowDiscovery {
  const roots = Array.from(new Set([APP_ROOT, options.workspaceRoot]));
  const workflowById = new Map<
    string,
    WorkflowDiscovery['workflows'][number]
  >();
  const roles = new Map<string, WorkflowRoleDefinition>();
  const errors: string[] = [];

  for (const root of roots) {
    const discovered = discoverWorkflowConfigs({
      workspaceRoot: root,
      knownTools: options.knownTools,
      knownLocalTasks: options.knownLocalTasks,
    });
    errors.push(...discovered.errors);
    for (const [roleId, role] of discovered.roles.entries()) {
      roles.set(roleId, role);
    }
    for (const workflow of discovered.workflows) {
      workflowById.set(workflow.id, workflow);
    }
  }

  return {
    workflows: [...workflowById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    roles,
    errors: Array.from(new Set(errors)),
  };
}

export async function executeWorkflowCommand(
  options: WorkflowCommandOptions,
): Promise<string> {
  const workspaceRoot = resolveWorkflowWorkspaceRoot(
    options.group,
    options.workspaceRoot,
  );
  const knownTools = options.knownTools ?? [...DEFAULT_WORKFLOW_KNOWN_TOOLS];
  const knownLocalTasks =
    options.knownLocalTasks ?? getDefaultWorkflowLocalTaskIds();
  const { workflowId, prompt } = splitWorkflowArgs(options.argsText);

  if (!workflowId) {
    const discovered = discoverWorkflowConfigsWithBuiltins({
      workspaceRoot,
      knownTools,
      knownLocalTasks,
    });
    if (discovered.errors.length > 0) {
      return formatWorkflowErrors(discovered.errors);
    }
    return formatWorkflowList(discovered.workflows);
  }

  if (!prompt) {
    return `用法：/workflow ${workflowId} <任务>`;
  }

  const discovered = discoverWorkflowConfigsWithBuiltins({
    workspaceRoot,
    knownTools,
    knownLocalTasks,
  });
  const workflow =
    discovered.workflows.find((candidate) => candidate.id === workflowId) ??
    null;
  if (!workflow) {
    return formatWorkflowErrors([
      ...discovered.errors,
      `workflow ${workflowId} not found`,
    ]);
  }
  if (discovered.errors.length > 0) {
    return formatWorkflowErrors(discovered.errors);
  }

  const context = getOrCreateWorkflowContext({
    folder: options.group.folder,
    workflowId: workflow.id,
    metadata: { workspaceRoot },
  });
  const run = createWorkflowRun({
    contextId: context.id,
    folder: options.group.folder,
    workflowId: workflow.id,
    triggerChatJid: options.chatJid,
    triggerUserId: options.triggerUserId ?? null,
    prompt,
    metadata: {
      source: 'slash-command',
      initialInput: options.initialInput ?? {},
    },
  });

  try {
    const graphRunner = options.runGraph ?? runWorkflowGraph;
    const result = await graphRunner({
      workflow,
      roles: discovered.roles,
      group: options.group,
      context,
      run,
      prompt,
      initialInput: options.initialInput,
      localTasks:
        options.localTasks ??
        createDefaultWorkflowLocalTasks({ workspaceRoot }),
      executionCwd: workspaceRoot,
      checkpointer: getPersistentWorkflowCheckpointer(),
    });
    return [
      `✅ 工作流 ${workflow.name} (${workflow.id}) 完成：`,
      result.result || '无输出',
    ].join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `❌ 工作流 ${workflow.name} (${workflow.id}) 失败：${message}`;
  }
}
