import crypto from 'crypto';

import {
  getWorkflowContext,
  getWorkflowContextById,
  insertWorkflowRun,
  listWorkflowRuns as listStoredWorkflowRuns,
  listWorkflowRunSteps as listStoredWorkflowRunSteps,
  updateWorkflowRunStatus as updateStoredWorkflowRunStatus,
  upsertWorkflowContext,
  upsertWorkflowRunStep,
} from '../../storage/db.js';
import type {
  WorkflowContext,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunStep,
  WorkflowRunStepStatus,
} from '../../domain/types.js';

export function buildWorkflowContextId(
  folder: string,
  workflowId: string,
): string {
  const normalizedFolder = folder.trim();
  const normalizedWorkflowId = workflowId.trim();
  if (!normalizedFolder || !normalizedWorkflowId) {
    throw new Error('workflow context requires folder and workflowId');
  }
  const hash = crypto
    .createHash('sha256')
    .update(`${normalizedFolder}\0${normalizedWorkflowId}`)
    .digest('hex')
    .slice(0, 32);
  return `wfctx_${hash}`;
}

export function buildWorkflowRuntimeAgentId(contextId: string): string {
  if (!contextId.trim()) {
    throw new Error('workflow runtime agent id requires contextId');
  }
  return `workflow:${contextId}`;
}

export function getOrCreateWorkflowContext(input: {
  folder: string;
  workflowId: string;
  metadata?: Record<string, unknown> | null;
}): WorkflowContext {
  const existing = getWorkflowContext(input.folder, input.workflowId);
  if (existing && !input.metadata) return existing;

  const id =
    existing?.id ?? buildWorkflowContextId(input.folder, input.workflowId);
  return upsertWorkflowContext({
    id,
    folder: input.folder,
    workflowId: input.workflowId,
    threadId: id,
    runtimeAgentId: buildWorkflowRuntimeAgentId(id),
    activeRunId: existing?.active_run_id ?? null,
    metadata: input.metadata ?? existing?.metadata ?? null,
  });
}

export function createWorkflowRun(input: {
  contextId: string;
  folder: string;
  workflowId: string;
  triggerChatJid: string;
  triggerMessageId?: string | null;
  triggerUserId?: string | null;
  prompt: string;
  metadata?: Record<string, unknown> | null;
}): WorkflowRun {
  const context = getWorkflowContextById(input.contextId);
  if (!context) {
    throw new Error(`workflow context ${input.contextId} not found`);
  }
  if (
    input.folder !== context.folder ||
    input.workflowId !== context.workflow_id
  ) {
    throw new Error(
      `workflow run folder/workflowId must match workflow context ${context.folder}/${context.workflow_id}`,
    );
  }
  return insertWorkflowRun({
    id: `wfrun_${crypto.randomUUID()}`,
    contextId: context.id,
    folder: context.folder,
    workflowId: context.workflow_id,
    threadId: context.thread_id,
    triggerChatJid: input.triggerChatJid,
    triggerMessageId: input.triggerMessageId ?? null,
    triggerUserId: input.triggerUserId ?? null,
    prompt: input.prompt,
    status: 'queued',
    metadata: input.metadata ?? null,
  });
}

export function updateWorkflowRunStatus(
  runId: string,
  input: {
    status: WorkflowRunStatus;
    result?: string | null;
    error?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  },
): WorkflowRun {
  const run = updateStoredWorkflowRunStatus(runId, input);
  if (!run) {
    throw new Error(`workflow run ${runId} not found`);
  }
  return run;
}

export function recordWorkflowRunStep(input: {
  runId: string;
  nodeId: string;
  roleId?: string | null;
  status: WorkflowRunStepStatus;
  attempt?: number;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}): WorkflowRunStep {
  return upsertWorkflowRunStep({
    id: `wfstep_${crypto.randomUUID()}`,
    runId: input.runId,
    nodeId: input.nodeId,
    roleId: input.roleId ?? null,
    status: input.status,
    attempt: input.attempt ?? 1,
    input: input.input ?? null,
    output: input.output ?? null,
    error: input.error ?? null,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
  });
}

export function listWorkflowRuns(filter: {
  folder?: string;
  workflowId?: string;
  limit?: number;
}): WorkflowRun[] {
  return listStoredWorkflowRuns(filter);
}

export function listWorkflowRunSteps(runId: string): WorkflowRunStep[] {
  return listStoredWorkflowRunSteps(runId);
}
