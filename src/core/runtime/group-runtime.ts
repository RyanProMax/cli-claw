import {
  supportsReasoningEffort,
  supportsSpeedTier,
} from './command-registry.js';
import { getAgentRuntime, normalizeRuntimeId } from './runtime-registry.js';
import type {
  AgentType,
  RegisteredGroup,
  RuntimeIdentity,
} from '../../domain/types.js';
import { resolveEffectiveWorkspaceCwd } from '../workspace/workspace-cwd.js';

function normalizeRuntimeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRuntimeSpeedTier(
  agentType: AgentType,
  value: string | null | undefined,
): string | null {
  if (!supportsSpeedTier(agentType)) return null;
  const normalized = normalizeRuntimeText(value);
  return normalized
    ? getAgentRuntime(agentType).normalizeSpeedTier(normalized)
    : null;
}

export function normalizeAgentType(raw: string | null | undefined): AgentType {
  return normalizeRuntimeId(raw);
}

export function buildEffectiveGroupFromHomeSibling(
  group: RegisteredGroup,
  homeGroup: RegisteredGroup,
): RegisteredGroup {
  return {
    ...group,
    agentType: homeGroup.agentType ?? group.agentType,
    model: homeGroup.model ?? group.model,
    reasoningEffort: homeGroup.reasoningEffort ?? group.reasoningEffort,
    speedTier: homeGroup.speedTier ?? group.speedTier,
    customCwd: resolveEffectiveWorkspaceCwd(group, homeGroup),
    created_by: group.created_by || homeGroup.created_by,
    is_home: true,
  };
}

export function resolveEffectiveRuntimeIdentity(
  group: RegisteredGroup,
  options: {
    openAiModel?: string | null;
    openAiReasoningEffort?: string | null;
    openAiSpeedTier?: string | null;
  } = {},
): RuntimeIdentity {
  const agentType = normalizeAgentType(group.agentType);
  const runtime = getAgentRuntime(agentType);
  const defaults = runtime.defaults();
  const supportsEffort = runtime.capabilities.supportsReasoningEffort;
  const supportsSpeed = runtime.capabilities.supportsSpeedTier;
  const model =
    normalizeRuntimeText(group.model) ??
    normalizeRuntimeText(options.openAiModel) ??
    defaults.model;

  return {
    agentType,
    model,
    reasoningEffort: supportsEffort
      ? (normalizeRuntimeText(group.reasoningEffort) ??
        normalizeRuntimeText(options.openAiReasoningEffort) ??
        defaults.reasoningEffort)
      : null,
    speedTier: supportsSpeed
      ? (normalizeRuntimeSpeedTier(agentType, group.speedTier) ??
        normalizeRuntimeSpeedTier(agentType, options.openAiSpeedTier) ??
        defaults.speedTier)
      : null,
    supportsReasoningEffort: supportsEffort,
  };
}
