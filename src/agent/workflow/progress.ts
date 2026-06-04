import type { WorkflowDefinition, WorkflowRoleDefinition } from './config.js';
import type { WorkflowRun, WorkflowRunStep } from '../../domain/types.js';

export interface WorkflowProgressSnapshot {
  workflow: WorkflowDefinition;
  roles: ReadonlyMap<string, WorkflowRoleDefinition>;
  run: WorkflowRun;
  prompt: string;
}

export interface WorkflowProgressReporter {
  onRunCreated?(snapshot: WorkflowProgressSnapshot): Promise<void> | void;
  onRunStatus?(run: WorkflowRun): Promise<void> | void;
  onStep?(step: WorkflowRunStep): Promise<void> | void;
  waitForIdle?(): Promise<void>;
}
