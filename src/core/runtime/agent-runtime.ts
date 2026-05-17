import type { RegisteredGroup } from '../../domain/types.js';
import type { RuntimeModelOptionsDiscoveryOptions } from './model-options.js';
import type { RuntimePresetOption } from './command-registry.js';
import type { UsageProviderResult } from './usage-command.js';

export type RuntimeId = 'openai';

export interface RuntimeCapabilities {
  supportsReasoningEffort: boolean;
  supportsSpeedTier: boolean;
}

export interface RuntimeDefaults {
  model: string;
  reasoningEffort: string | null;
  speedTier: string | null;
}

export interface RuntimeLaunchContext {
  group: Pick<RegisteredGroup, 'folder'>;
  agentId?: string | null;
}

export interface RuntimePreparation {
  env: Record<string, string>;
  hostSessionDir: string;
  runtimeSessionDir: string;
}

export interface AgentRuntime {
  id: RuntimeId;
  label: string;
  capabilities: RuntimeCapabilities;
  defaults(env?: NodeJS.ProcessEnv): RuntimeDefaults;
  modelCatalog(
    options?: RuntimeModelOptionsDiscoveryOptions,
  ): RuntimePresetOption[];
  normalizeModel(
    rawValue: string,
    options?: RuntimeModelOptionsDiscoveryOptions,
  ): string | null;
  normalizeReasoningEffort(rawValue: string): string | null;
  normalizeSpeedTier(rawValue: string): string | null;
  prepareRuntime(context: RuntimeLaunchContext): Promise<RuntimePreparation>;
  usage(): Promise<UsageProviderResult>;
}
