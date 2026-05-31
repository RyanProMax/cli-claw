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
  background?: boolean;
  onBackgroundResult?: (message: string) => Promise<void> | void;
  triggerMessageId?: string | null;
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

function formatWorkflowStarted(options: {
  workflow: WorkflowDiscovery['workflows'][number];
  runId: string;
  prompt: string;
}): string {
  return [
    `🚀 已启动工作流 ${options.workflow.name} (${options.workflow.id})`,
    `Run: ${options.runId}`,
    ...(options.prompt ? [`任务：${options.prompt}`] : []),
    '完成、失败或超时后我会继续回到这里通知你。',
  ].join('\n');
}

function formatScoreComponent(
  label: string,
  value: string,
  denominator: number,
): string {
  const normalized = value.toUpperCase() === 'NA' ? 'N/A' : value;
  return /N\/?A/i.test(normalized)
    ? `${label}N/A`
    : `${label}${normalized}/${denominator}`;
}

function normalizeHkipoFinalReport(result: string): string {
  return result
    .replaceAll('Chief Securities IPO', '致富证券 IPO')
    .replace(/致富证券(?! IPO)/g, '致富证券 IPO')
    .replace(/孖展\s*多源未取到/g, '融资/孖展倍数暂无多源核验')
    .replace(/孖展[：:]\s*多源未取到/g, '融资/孖展倍数暂无多源核验')
    .replace(
      /[｜|]\s*(?:卡[：:]\s*)?热(\d+|N\/?A|NA)\s+结构(\d+|N\/?A|NA)\s+回测(\d+|N\/?A|NA)\s+基本面(\d+|N\/?A|NA)\s+估值(\d+|N\/?A|NA)\s+证据(\d+|N\/?A|NA)/gi,
      (
        _match,
        heat: string,
        structure: string,
        backtest: string,
        fundamental: string,
        valuation: string,
        evidence: string,
      ) =>
        [
          '',
          '🧮 评分：',
          formatScoreComponent('热度', heat, 20),
          '｜',
          formatScoreComponent('结构', structure, 20),
          '｜',
          formatScoreComponent('回测', backtest, 20),
          '｜',
          formatScoreComponent('基本面', fundamental, 20),
          '｜',
          formatScoreComponent('估值', valuation, 10),
          '｜',
          formatScoreComponent('证据', evidence, 10),
        ].join(''),
    );
}

function normalizeWorkflowResultForDelivery(
  workflowId: string,
  result: string,
): string {
  if (workflowId === 'hkipo') return normalizeHkipoFinalReport(result);
  return result;
}

function formatWorkflowSuccess(options: {
  workflow: WorkflowDiscovery['workflows'][number];
  result: string;
}): string {
  const normalizedResult = normalizeWorkflowResultForDelivery(
    options.workflow.id,
    options.result,
  );
  return [
    `✅ 工作流 ${options.workflow.name} (${options.workflow.id}) 完成：`,
    normalizedResult || '无输出',
  ].join('\n');
}

function formatWorkflowFailure(options: {
  workflow: WorkflowDiscovery['workflows'][number];
  message: string;
}): string {
  return `❌ 工作流 ${options.workflow.name} (${options.workflow.id}) 失败：${options.message}`;
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
    workspaceJid: options.chatJid.startsWith('web:') ? options.chatJid : null,
    metadata: { workspaceRoot },
  });
  const run = createWorkflowRun({
    contextId: context.id,
    folder: options.group.folder,
    workflowId: workflow.id,
    triggerChatJid: options.chatJid,
    triggerMessageId: options.triggerMessageId ?? null,
    triggerUserId: options.triggerUserId ?? null,
    prompt,
    metadata: {
      source: 'slash-command',
      initialInput: options.initialInput ?? {},
    },
  });

  const runAndFormatResult = async (): Promise<string> => {
    const graphRunner = options.runGraph ?? runWorkflowGraph;
    try {
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
      return formatWorkflowSuccess({
        workflow,
        result: result.result ?? '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatWorkflowFailure({ workflow, message });
    }
  };

  if (options.background) {
    const startedMessage = formatWorkflowStarted({
      workflow,
      runId: run.id,
      prompt,
    });
    void (async () => {
      const message = await runAndFormatResult();
      if (!options.onBackgroundResult) return;
      try {
        await options.onBackgroundResult(message);
      } catch {
        // Delivery failures are logged by the caller's transport when available.
      }
    })();
    return startedMessage;
  }

  return runAndFormatResult();
}
