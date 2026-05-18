import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import type {
  AgentProcessInput,
  AgentProcessOutput,
} from '../runner/container-runner.js';
import { runAgentProcess } from '../runner/container-runner.js';
import { STORE_DIR } from '../../core/config.js';
import type {
  RegisteredGroup,
  WorkflowContext,
  WorkflowRun,
} from '../../domain/types.js';
import {
  recordWorkflowRunStep as persistWorkflowRunStep,
  updateWorkflowRunStatus as persistWorkflowRunStatus,
} from './context.js';
import type {
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowRoleDefinition,
} from './config.js';
import { WORKFLOW_END } from './config.js';
import { createWorkflowSqliteSaver } from './sqlite-checkpointer.js';

export interface WorkflowNodeResult {
  nodeId: string;
  roleId?: string;
  taskId?: string;
  result: string | null;
}

export interface WorkflowGraphState {
  prompt: string;
  input: Record<string, unknown>;
  result: string | null;
  stepResults: Record<string, WorkflowNodeResult>;
  artifacts: Record<string, unknown>;
}

export type WorkflowStepRecorder = typeof persistWorkflowRunStep;
export type WorkflowRunStatusUpdater = typeof persistWorkflowRunStatus;

export type WorkflowNodeRunner = (
  input: AgentProcessInput,
) => Promise<AgentProcessOutput>;

export interface WorkflowLocalTaskInput {
  taskId: string;
  nodeId: string;
  workflow: WorkflowDefinition;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  prompt: string;
  input: Record<string, unknown>;
  artifacts: Record<string, unknown>;
  stepResults: Record<string, WorkflowNodeResult>;
  executionCwd?: string;
}

export type WorkflowLocalTask = (
  input: WorkflowLocalTaskInput,
) => Promise<unknown>;

export type WorkflowLocalTaskRegistry = Record<string, WorkflowLocalTask>;

export interface WorkflowGraphRunOptions {
  workflow: WorkflowDefinition;
  roles: Map<string, WorkflowRoleDefinition>;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  prompt: string;
  initialInput?: Record<string, unknown>;
  localTasks?: WorkflowLocalTaskRegistry;
  runner?: WorkflowNodeRunner;
  recordStep?: WorkflowStepRecorder;
  updateRunStatus?: WorkflowRunStatusUpdater;
  checkpointer?: BaseCheckpointSaver | false;
  onProcess?: (proc: ChildProcess, identifier: string) => void;
  onOutput?: (output: AgentProcessOutput) => Promise<void>;
  executionCwd?: string;
}

const WorkflowState = Annotation.Root({
  prompt: Annotation<string>(),
  input: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  result: Annotation<string | null>(),
  stepResults: Annotation<Record<string, WorkflowNodeResult>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  artifacts: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

let persistentWorkflowCheckpointer: BaseCheckpointSaver | null = null;
let persistentWorkflowCheckpointPath: string | null = null;

export function getWorkflowCheckpointSqlitePath(): string {
  return path.join(STORE_DIR, 'workflow-checkpoints.sqlite');
}

export function createWorkflowCheckpointer(
  options: {
    sqlitePath?: string | null;
  } = {},
): BaseCheckpointSaver {
  if (options.sqlitePath) {
    if (options.sqlitePath !== ':memory:') {
      fs.mkdirSync(path.dirname(options.sqlitePath), { recursive: true });
    }
    return createWorkflowSqliteSaver(options.sqlitePath);
  }
  return new MemorySaver();
}

export function getPersistentWorkflowCheckpointer(): BaseCheckpointSaver {
  const sqlitePath = getWorkflowCheckpointSqlitePath();
  if (
    !persistentWorkflowCheckpointer ||
    persistentWorkflowCheckpointPath !== sqlitePath
  ) {
    persistentWorkflowCheckpointer = createWorkflowCheckpointer({ sqlitePath });
    persistentWorkflowCheckpointPath = sqlitePath;
  }
  return persistentWorkflowCheckpointer;
}

export function buildWorkflowInvokeConfig(context: WorkflowContext): {
  configurable: { thread_id: string };
} {
  return {
    configurable: {
      thread_id: context.thread_id,
    },
  };
}

export function buildWorkflowAgentPrompt(input: {
  workflow: WorkflowDefinition;
  node: WorkflowNodeDefinition;
  role: WorkflowRoleDefinition;
  userPrompt: string;
  stepResults: Record<string, WorkflowNodeResult>;
  artifacts?: Record<string, unknown>;
  initialInput?: Record<string, unknown>;
}): string {
  const upstreamResults = Object.values(input.stepResults);
  const artifacts = input.artifacts ?? {};
  const initialInput = input.initialInput ?? {};
  return [
    `[Workflow] ${input.workflow.name} (${input.workflow.id})`,
    `[Node] ${input.node.id}`,
    `[Role] ${input.role.name} (${input.role.id})`,
    input.role.description
      ? `[Role Description]\n${input.role.description}`
      : null,
    `[Role Instructions]\n${input.role.instructions}`,
    input.node.prompt ? `[Node Task]\n${input.node.prompt}` : null,
    upstreamResults.length > 0
      ? `[Previous Step Results]\n${JSON.stringify(upstreamResults, null, 2)}`
      : null,
    Object.keys(artifacts).length > 0
      ? `[Structured Artifacts]\n${JSON.stringify(artifacts, null, 2)}`
      : null,
    Object.keys(initialInput).length > 0
      ? `[Workflow Input]\n${JSON.stringify(initialInput, null, 2)}`
      : null,
    `[User Request]\n${input.userPrompt}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

export function buildWorkflowAgentInput(input: {
  workflow: WorkflowDefinition;
  node: WorkflowNodeDefinition;
  role: WorkflowRoleDefinition;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  userPrompt: string;
  stepResults?: Record<string, WorkflowNodeResult>;
  artifacts?: Record<string, unknown>;
  initialInput?: Record<string, unknown>;
}): AgentProcessInput {
  return {
    prompt: buildWorkflowAgentPrompt({
      workflow: input.workflow,
      node: input.node,
      role: input.role,
      userPrompt: input.userPrompt,
      stepResults: input.stepResults ?? {},
      artifacts: input.artifacts ?? {},
      initialInput: input.initialInput ?? {},
    }),
    groupFolder: input.group.folder,
    chatJid: input.run.trigger_chat_jid,
    agentType: 'openai',
    agentId: input.context.runtime_agent_id,
    agentName: input.role.name,
    singleTurn: true,
    workflow: {
      id: input.workflow.id,
      name: input.workflow.name,
      contextId: input.context.id,
      runId: input.run.id,
      threadId: input.context.thread_id,
      nodeId: input.node.id,
      nodeType: input.node.type,
    },
    role: {
      id: input.role.id,
      name: input.role.name,
      description: input.role.description,
      instructions: input.role.instructions,
      skillIds: input.role.skillIds,
      permissionMode: input.role.permissionMode,
      allowedTools: input.role.allowedTools,
    },
    allowedTools: input.role.allowedTools,
  };
}

function createNoopNode(node: WorkflowNodeDefinition) {
  return async (
    state: typeof WorkflowState.State,
  ): Promise<Partial<WorkflowGraphState>> => ({
    stepResults: {
      [node.id]: {
        nodeId: node.id,
        result: state.result,
      },
    },
  });
}

function createRoleTaskNode(options: {
  workflow: WorkflowDefinition;
  node: WorkflowNodeDefinition;
  role: WorkflowRoleDefinition;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  runner: WorkflowNodeRunner;
  recordStep: WorkflowStepRecorder;
}) {
  return async (
    state: typeof WorkflowState.State,
  ): Promise<Partial<WorkflowGraphState>> => {
    options.recordStep({
      runId: options.run.id,
      nodeId: options.node.id,
      roleId: options.role.id,
      status: 'running',
      attempt: 1,
      input: { prompt: state.prompt },
    });

    const output = await options.runner(
      buildWorkflowAgentInput({
        workflow: options.workflow,
        node: options.node,
        role: options.role,
        group: options.group,
        context: options.context,
        run: options.run,
        userPrompt: state.prompt,
        stepResults: state.stepResults,
        artifacts: state.artifacts,
        initialInput: state.input,
      }),
    );

    if (output.status !== 'success') {
      const error = output.error || output.result || 'Workflow node failed';
      options.recordStep({
        runId: options.run.id,
        nodeId: options.node.id,
        roleId: options.role.id,
        status: 'error',
        attempt: 1,
        input: { prompt: state.prompt },
        error,
      });
      throw new Error(error);
    }

    const result = output.result ?? null;
    const artifactKey = options.node.outputArtifact;
    const roleArtifact = artifactKey
      ? {
          nodeId: options.node.id,
          roleId: options.role.id,
          result,
        }
      : null;
    options.recordStep({
      runId: options.run.id,
      nodeId: options.node.id,
      roleId: options.role.id,
      status: 'success',
      attempt: 1,
      input: { prompt: state.prompt },
      output: roleArtifact
        ? { result, artifactKey, artifact: roleArtifact }
        : { result },
    });

    const nextState: Partial<WorkflowGraphState> = {
      result,
      stepResults: {
        [options.node.id]: {
          nodeId: options.node.id,
          roleId: options.role.id,
          result,
        },
      },
    };
    if (artifactKey && roleArtifact) {
      nextState.artifacts = { [artifactKey]: roleArtifact };
    }
    return nextState;
  };
}

function createLocalTaskNode(options: {
  workflow: WorkflowDefinition;
  node: WorkflowNodeDefinition;
  group: RegisteredGroup;
  context: WorkflowContext;
  run: WorkflowRun;
  localTasks: WorkflowLocalTaskRegistry;
  recordStep: WorkflowStepRecorder;
  executionCwd?: string;
}) {
  return async (
    state: typeof WorkflowState.State,
  ): Promise<Partial<WorkflowGraphState>> => {
    const taskId = options.node.taskId;
    const task = taskId ? options.localTasks[taskId] : undefined;
    if (!taskId || !task) {
      throw new Error(
        `workflow ${options.workflow.id} node ${options.node.id} has no registered local task`,
      );
    }

    options.recordStep({
      runId: options.run.id,
      nodeId: options.node.id,
      status: 'running',
      attempt: 1,
      input: {
        taskId,
        input: state.input,
        artifacts: state.artifacts,
      },
    });

    try {
      const artifact = await task({
        taskId,
        nodeId: options.node.id,
        workflow: options.workflow,
        group: options.group,
        context: options.context,
        run: options.run,
        prompt: state.prompt,
        input: state.input,
        artifacts: state.artifacts,
        stepResults: state.stepResults,
        executionCwd: options.executionCwd,
      });
      const artifactKey = options.node.outputArtifact ?? options.node.id;
      options.recordStep({
        runId: options.run.id,
        nodeId: options.node.id,
        status: 'success',
        attempt: 1,
        input: {
          taskId,
          input: state.input,
        },
        output: {
          taskId,
          artifactKey,
          artifact,
        },
      });

      return {
        artifacts: {
          [artifactKey]: artifact,
        },
        stepResults: {
          [options.node.id]: {
            nodeId: options.node.id,
            taskId,
            result:
              typeof artifact === 'string'
                ? artifact
                : JSON.stringify(artifact, null, 2),
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.recordStep({
        runId: options.run.id,
        nodeId: options.node.id,
        status: 'error',
        attempt: 1,
        input: {
          taskId,
          input: state.input,
        },
        error: message,
      });
      throw error;
    }
  };
}

export function compileWorkflowGraph(
  options: Omit<WorkflowGraphRunOptions, 'prompt'>,
) {
  const runner =
    options.runner ??
    ((input: AgentProcessInput) =>
      runAgentProcess(
        options.group,
        input,
        options.onProcess ?? (() => {}),
        options.onOutput,
        options.executionCwd
          ? { executionCwd: options.executionCwd }
          : undefined,
      ));
  const recordStep = options.recordStep ?? persistWorkflowRunStep;
  const localTasks = options.localTasks ?? {};
  const graph = new StateGraph(WorkflowState) as any;
  const maxAttempts = Math.max(1, (options.workflow.maxRetries ?? 0) + 1);

  for (const node of options.workflow.nodes) {
    if (node.type === 'role_task') {
      const roleId = node.roleId;
      const role = roleId ? options.roles.get(roleId) : undefined;
      if (!role) {
        throw new Error(
          `workflow ${options.workflow.id} node ${node.id} has no resolved role`,
        );
      }
      graph.addNode(
        node.id,
        createRoleTaskNode({
          workflow: options.workflow,
          node,
          role,
          group: options.group,
          context: options.context,
          run: options.run,
          runner,
          recordStep,
        }),
        {
          retryPolicy: {
            maxAttempts,
            initialInterval: 100,
            jitter: false,
          },
        },
      );
    } else if (node.type === 'local_task') {
      graph.addNode(
        node.id,
        createLocalTaskNode({
          workflow: options.workflow,
          node,
          group: options.group,
          context: options.context,
          run: options.run,
          localTasks,
          recordStep,
          executionCwd: options.executionCwd,
        }),
        {
          retryPolicy: {
            maxAttempts,
            initialInterval: 100,
            jitter: false,
          },
        },
      );
    } else {
      graph.addNode(node.id, createNoopNode(node));
    }
  }

  graph.addEdge(START, options.workflow.start);
  for (const edge of options.workflow.edges) {
    graph.addEdge(edge.from, edge.to === WORKFLOW_END ? END : edge.to);
  }

  return graph.compile({
    checkpointer:
      options.checkpointer === false
        ? false
        : (options.checkpointer ?? createWorkflowCheckpointer()),
    name: options.workflow.id,
    description: options.workflow.description || options.workflow.name,
  });
}

export async function runWorkflowGraph(
  options: WorkflowGraphRunOptions,
): Promise<WorkflowGraphState> {
  const updateRunStatus = options.updateRunStatus ?? persistWorkflowRunStatus;
  const graph = compileWorkflowGraph(options);
  updateRunStatus(options.run.id, { status: 'running' });
  try {
    const result = (await graph.invoke(
      {
        prompt: options.prompt,
        input: options.initialInput ?? {},
        result: null,
        stepResults: {},
        artifacts: {},
      },
      buildWorkflowInvokeConfig(options.context),
    )) as WorkflowGraphState;
    updateRunStatus(options.run.id, {
      status: 'success',
      result: result.result,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRunStatus(options.run.id, { status: 'error', error: message });
    throw error;
  }
}
