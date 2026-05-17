import type { GroupRuntimeAgentType } from '../types';

export type WorkspaceAgentType = GroupRuntimeAgentType;

export interface WorkspaceRuntimeSelection {
  agentType: WorkspaceAgentType;
}

export function normalizeWorkspaceRuntimeSelection(
  _selection: Partial<WorkspaceRuntimeSelection> | null | undefined,
): WorkspaceRuntimeSelection {
  return {
    agentType: 'openai',
  };
}
