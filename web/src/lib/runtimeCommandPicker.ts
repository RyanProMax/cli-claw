import {
  getModelPresetOptions,
  getReasoningEffortOptions,
  getSpeedTierOptions,
  supportsReasoningEffort,
  supportsSpeedTier,
  type RuntimeAgentType,
  type RuntimePresetOption,
} from './runtimeCommandRegistry';

export type RuntimePickerCommand = 'model' | 'effort' | 'speed';

function normalizeCommandText(value: string): string {
  return value.trim().toLowerCase();
}

export function detectRuntimePickerCommand(
  value: string,
): RuntimePickerCommand | null {
  const normalized = normalizeCommandText(value);
  if (normalized === '/model') return 'model';
  if (normalized === '/effort') return 'effort';
  if (normalized === '/speed') return 'speed';
  return null;
}

export function getRuntimePickerOptions(options: {
  command: RuntimePickerCommand;
  agentType: RuntimeAgentType;
  modelOptions?: RuntimePresetOption[];
}): RuntimePresetOption[] {
  if (options.command === 'model') {
    return options.modelOptions ?? getModelPresetOptions(options.agentType);
  }
  if (!supportsReasoningEffort(options.agentType)) {
    return [];
  }
  if (options.command === 'effort') {
    return getReasoningEffortOptions();
  }
  if (!supportsSpeedTier(options.agentType)) {
    return [];
  }
  return getSpeedTierOptions();
}
