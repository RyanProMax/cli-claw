export type WorkspaceAgentType = 'claude' | 'openai';
export type WorkspaceExecutionMode = 'container' | 'host';

export interface WorkspaceRuntimeSelection {
  agentType: WorkspaceAgentType;
  executionMode: WorkspaceExecutionMode;
}

export function normalizeWorkspaceRuntimeSelection(
  selection: WorkspaceRuntimeSelection,
): WorkspaceRuntimeSelection {
  return selection;
}
