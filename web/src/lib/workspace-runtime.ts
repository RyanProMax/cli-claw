export type WorkspaceAgentType = 'claude' | 'codex';
export type WorkspaceExecutionMode = 'container' | 'host';

export interface WorkspaceRuntimeSelection {
  agentType: WorkspaceAgentType;
  executionMode: WorkspaceExecutionMode;
}

export function normalizeWorkspaceRuntimeSelection(
  selection: WorkspaceRuntimeSelection,
): WorkspaceRuntimeSelection {
  if (selection.agentType === 'codex') {
    return {
      agentType: 'codex',
      executionMode: 'host',
    };
  }

  return selection;
}
