import {
  getModelPresetOptions,
  getReasoningEffortOptions,
  supportsReasoningEffort,
  type RuntimeAgentType,
  type RuntimePresetOption,
} from './runtimeCommandRegistry';

export type RuntimePickerCommand = 'model' | 'effort';

function normalizeCommandText(value: string): string {
  return value.trim().toLowerCase();
}

export function detectRuntimePickerCommand(
  value: string,
): RuntimePickerCommand | null {
  const normalized = normalizeCommandText(value);
  if (normalized === '/model') return 'model';
  if (normalized === '/effort') return 'effort';
  return null;
}

export function getRuntimePickerOptions(options: {
  command: RuntimePickerCommand;
  agentType: RuntimeAgentType;
}): RuntimePresetOption[] {
  if (options.command === 'model') {
    return getModelPresetOptions(options.agentType);
  }
  if (!supportsReasoningEffort(options.agentType)) {
    return [];
  }
  return getReasoningEffortOptions();
}
