import {
  type RuntimeAgentType,
  type RuntimePresetOption,
} from './command-registry.js';
import { getAgentRuntime } from './runtime-registry.js';

export type RuntimeModelOptionsSource = 'preset';

export interface RuntimeModelOptionsResult {
  options: RuntimePresetOption[];
  source: RuntimeModelOptionsSource;
}

export interface RuntimeModelOptionsDiscoveryOptions {
  currentModel?: string | null;
}

export function getAvailableRuntimeModelCatalog(
  agentType: RuntimeAgentType,
  options: RuntimeModelOptionsDiscoveryOptions = {},
): RuntimeModelOptionsResult {
  const runtime = getAgentRuntime(agentType);
  return {
    options: runtime.modelCatalog(options),
    source: 'preset',
  };
}

export function getAvailableRuntimeModelOptions(
  agentType: RuntimeAgentType,
  options: RuntimeModelOptionsDiscoveryOptions = {},
): RuntimePresetOption[] {
  return getAvailableRuntimeModelCatalog(agentType, options).options;
}

export function getAvailableRuntimeModelPresets(
  agentType: RuntimeAgentType,
  options: RuntimeModelOptionsDiscoveryOptions = {},
): string[] {
  return getAvailableRuntimeModelOptions(agentType, options).map(
    (option) => option.value,
  );
}

export function normalizeAvailableRuntimeModelPreset(
  agentType: RuntimeAgentType,
  rawValue: string,
  options: RuntimeModelOptionsDiscoveryOptions = {},
): string | null {
  return getAgentRuntime(agentType).normalizeModel(rawValue, options);
}
