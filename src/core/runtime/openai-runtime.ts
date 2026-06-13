import fs from 'node:fs';
import path from 'node:path';

import { DATA_DIR } from '../config.js';
import { resolveCodexCliRuntimeEnv } from './codex-cli-auth.js';
import { getOpenAiCodexUsageSnapshot } from './openai-codex-usage.js';
import {
  getModelPresetOptions,
  normalizeReasoningEffortPreset,
  normalizeSpeedTierPreset,
  type RuntimePresetOption,
} from './command-registry.js';
import type {
  AgentRuntime,
  RuntimeDefaults,
  RuntimeLaunchContext,
  RuntimePreparation,
} from './agent-runtime.js';
import type { RuntimeModelOptionsDiscoveryOptions } from './model-options.js';

function normalizeRuntimeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeSpeedTierDefault(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'priority') return 'fast';
  return normalizeSpeedTierPreset(normalized);
}

function formatModelLabel(value: string): string {
  return value
    .split('-')
    .map((part) => {
      const normalized = part.toLowerCase();
      if (normalized === 'gpt') return 'GPT';
      if (normalized === 'openai') return 'OpenAI';
      if (normalized === 'mini') return 'Mini';
      return part;
    })
    .join('-');
}

function includeCurrentModelOption(
  options: RuntimePresetOption[],
  currentModel: string | null | undefined,
): RuntimePresetOption[] {
  const current = normalizeRuntimeText(currentModel);
  if (!current) return options;
  if (
    options.some(
      (option) => option.value.toLowerCase() === current.toLowerCase(),
    )
  ) {
    return options;
  }
  return [
    { value: current, label: `${formatModelLabel(current)} (current)` },
    ...options,
  ];
}

function runtimeSessionDir(context: RuntimeLaunchContext): string {
  return context.agentId
    ? path.join(
        DATA_DIR,
        'sessions',
        context.group.folder,
        'agents',
        context.agentId,
        '.openai',
      )
    : path.join(DATA_DIR, 'sessions', context.group.folder, '.openai');
}

async function prepareOpenAiRuntime(
  context: RuntimeLaunchContext,
  runtimeSessionPath: string,
): Promise<RuntimePreparation> {
  const hostSessionDir = runtimeSessionDir(context);
  fs.mkdirSync(hostSessionDir, { recursive: true });
  const env = await resolveCodexCliRuntimeEnv();
  env.OPENAI_AGENTS_DISABLE_TRACING ??= '1';
  env.AGENT_FABRIC_RUNTIME_SESSION_DIR = runtimeSessionPath;
  return {
    env,
    hostSessionDir,
    runtimeSessionDir: runtimeSessionPath,
  };
}

export function getOpenAiRuntimeDefaults(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeDefaults {
  const configuredSpeedTier =
    normalizeRuntimeText(env.OPENAI_SERVICE_TIER) ??
    normalizeRuntimeText(env.SERVICE_TIER);
  return {
    model: normalizeRuntimeText(env.OPENAI_MODEL) ?? 'gpt-5.4',
    reasoningEffort:
      normalizeRuntimeText(env.OPENAI_REASONING_EFFORT) ??
      normalizeRuntimeText(env.REASONING_EFFORT) ??
      'medium',
    speedTier: configuredSpeedTier
      ? (normalizeSpeedTierDefault(configuredSpeedTier) ?? 'standard')
      : 'standard',
  };
}

export const openaiRuntime: AgentRuntime = {
  id: 'openai',
  label: 'OpenAI',
  capabilities: {
    supportsReasoningEffort: true,
    supportsSpeedTier: true,
  },
  defaults: getOpenAiRuntimeDefaults,
  modelCatalog(options: RuntimeModelOptionsDiscoveryOptions = {}) {
    return includeCurrentModelOption(
      getModelPresetOptions('openai'),
      options.currentModel,
    );
  },
  normalizeModel(
    rawValue: string,
    options: RuntimeModelOptionsDiscoveryOptions = {},
  ) {
    const normalized = rawValue.trim().toLowerCase();
    if (!normalized) return null;
    return (
      this.modelCatalog(options).find(
        (option) => option.value.toLowerCase() === normalized,
      )?.value ?? null
    );
  },
  normalizeReasoningEffort(rawValue: string) {
    return normalizeReasoningEffortPreset(rawValue);
  },
  normalizeSpeedTier(rawValue: string) {
    return normalizeSpeedTierPreset(rawValue);
  },
  prepareRuntime(context: RuntimeLaunchContext) {
    return prepareOpenAiRuntime(context, runtimeSessionDir(context));
  },
  usage() {
    return getOpenAiCodexUsageSnapshot();
  },
};
