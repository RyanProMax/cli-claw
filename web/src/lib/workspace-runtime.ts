export type WorkspaceAgentType = 'openai' | (string & {});
export type WorkspaceExecutionMode = 'container' | 'host';

export interface WorkspaceRuntimeSelection {
  agentType: WorkspaceAgentType;
  executionMode: WorkspaceExecutionMode;
}

export function normalizeWorkspaceRuntimeSelection(
  selection: WorkspaceRuntimeSelection,
): WorkspaceRuntimeSelection {
  return {
    ...selection,
    agentType: 'openai',
  };
}
