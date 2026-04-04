import type { AgentType, ExecutionMode } from './types.js';

export function normalizeAgentType(raw: string | null | undefined): AgentType {
  if (raw === 'codex') return 'codex';
  return 'claude';
}

export function enforceAgentExecutionMode(
  agentType: AgentType,
  executionMode: ExecutionMode,
): string | null {
  if (agentType === 'codex' && executionMode !== 'host') {
    return 'Codex only supports host execution mode';
  }
  return null;
}

export function validateGroupRuntimeUpdate(options: {
  isHome: boolean;
  currentExecutionMode: ExecutionMode;
  nextAgentType: AgentType;
  nextExecutionMode: ExecutionMode;
}): string | null {
  if (
    options.isHome &&
    options.nextExecutionMode !== options.currentExecutionMode
  ) {
    return 'Cannot change execution mode of home containers';
  }

  return enforceAgentExecutionMode(
    options.nextAgentType,
    options.nextExecutionMode,
  );
}

export function hasRuntimeBoundaryChange(options: {
  currentAgentType: AgentType;
  currentExecutionMode: ExecutionMode;
  nextAgentType: AgentType;
  nextExecutionMode: ExecutionMode;
}): boolean {
  return (
    options.currentAgentType !== options.nextAgentType ||
    options.currentExecutionMode !== options.nextExecutionMode
  );
}
