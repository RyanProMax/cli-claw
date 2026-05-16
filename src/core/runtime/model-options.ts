import {
  getModelPresetOptions,
  type RuntimeAgentType,
  type RuntimePresetOption,
} from './command-registry.js';

export type RuntimeModelOptionsSource = 'preset';

export interface RuntimeModelOptionsResult {
  options: RuntimePresetOption[];
  source: RuntimeModelOptionsSource;
}

export interface RuntimeModelOptionsDiscoveryOptions {
  currentModel?: string | null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function formatModelLabel(value: string): string {
  return value
    .split('-')
    .map((part) => {
      const normalized = part.toLowerCase();
      if (normalized === 'gpt') return 'GPT';
      if (normalized === 'openai') return 'OpenAI';
      if (normalized === 'mini') return 'Mini';
      if (normalized.startsWith('opus')) return `Opus${part.slice(4)}`;
      if (normalized.startsWith('sonnet')) return `Sonnet${part.slice(6)}`;
      if (normalized.startsWith('haiku')) return `Haiku${part.slice(5)}`;
      return part;
    })
    .join('-');
}

function includeCurrentModelOption(
  options: RuntimePresetOption[],
  currentModel: string | null | undefined,
): RuntimePresetOption[] {
  const current = normalizeText(currentModel);
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

export function getAvailableRuntimeModelCatalog(
  agentType: RuntimeAgentType,
  options: RuntimeModelOptionsDiscoveryOptions = {},
): RuntimeModelOptionsResult {
  const presetOptions = getModelPresetOptions(agentType);
  return {
    options:
      agentType === 'openai'
        ? includeCurrentModelOption(presetOptions, options.currentModel)
        : presetOptions,
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
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return null;

  return (
    getAvailableRuntimeModelPresets(agentType, options).find(
      (value) => value.toLowerCase() === normalized,
    ) ?? null
  );
}
