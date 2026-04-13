import {
  getDefaultModelPreset,
  getDefaultReasoningEffortPreset,
  supportsReasoningEffort,
} from './runtime-command-registry.js';
import type {
  AgentType,
  ExecutionMode,
  RegisteredGroup,
  RuntimeIdentity,
} from './types.js';
import { resolveEffectiveHostWorkspaceCwd } from './host-workspace-cwd.js';

function normalizeRuntimeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

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

export function buildEffectiveGroupFromHomeSibling(
  group: RegisteredGroup,
  homeGroup: RegisteredGroup,
): RegisteredGroup {
  return {
    ...group,
    agentType: homeGroup.agentType ?? group.agentType,
    executionMode: homeGroup.executionMode ?? group.executionMode,
    model: homeGroup.model ?? group.model,
    reasoningEffort: homeGroup.reasoningEffort ?? group.reasoningEffort,
    customCwd: resolveEffectiveHostWorkspaceCwd(group, homeGroup),
    created_by: group.created_by || homeGroup.created_by,
    is_home: true,
  };
}

export function resolveEffectiveRuntimeIdentity(
  group: RegisteredGroup,
  options: {
    claudeProviderModel?: string | null;
    codexCliModel?: string | null;
    codexCliReasoningEffort?: string | null;
  } = {},
): RuntimeIdentity {
  const agentType = normalizeAgentType(group.agentType);
  const supportsEffort = supportsReasoningEffort(agentType);
  const model =
    normalizeRuntimeText(group.model) ??
    (agentType === 'claude'
      ? normalizeRuntimeText(options.claudeProviderModel)
      : agentType === 'codex'
        ? normalizeRuntimeText(options.codexCliModel)
        : null) ??
    getDefaultModelPreset(agentType);

  return {
    agentType,
    model,
    reasoningEffort: supportsEffort
      ? (normalizeRuntimeText(group.reasoningEffort) ??
        (agentType === 'codex'
          ? normalizeRuntimeText(options.codexCliReasoningEffort)
          : null) ??
        getDefaultReasoningEffortPreset(agentType))
      : null,
    supportsReasoningEffort: supportsEffort,
  };
}
