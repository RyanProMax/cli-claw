import {
  getModelPresetOptions,
  getReasoningEffortOptions,
  getSpeedTierOptions,
  supportsReasoningEffort,
  supportsSpeedTier,
  type RuntimeAgentType,
  type RuntimePresetOption,
} from './runtimeCommandRegistry';

export type RuntimePickerCommand = 'codex' | 'claude';
export type RuntimePickerSelection = 'model' | 'effort' | 'speed';

export interface RuntimePickerSection {
  command: RuntimePickerSelection;
  label: string;
  options: RuntimePresetOption[];
}

function normalizeCommandText(value: string): string {
  return value.trim().toLowerCase();
}

export function detectRuntimePickerCommand(
  value: string,
): RuntimePickerCommand | null {
  const normalized = normalizeCommandText(value);
  if (normalized === '/codex') return 'codex';
  if (normalized === '/claude') return 'claude';
  return null;
}

export function getRuntimePickerSections(options: {
  command: RuntimePickerCommand;
  agentType: RuntimeAgentType;
  modelOptions?: RuntimePresetOption[];
}): RuntimePickerSection[] {
  if (options.command !== options.agentType) {
    return [];
  }

  const sections: RuntimePickerSection[] = [
    {
      command: 'model',
      label: '模型',
      options: options.modelOptions ?? getModelPresetOptions(options.agentType),
    },
  ];

  if (supportsReasoningEffort(options.agentType)) {
    sections.push({
      command: 'effort',
      label: '思考强度',
      options: getReasoningEffortOptions(),
    });
  }

  if (supportsSpeedTier(options.agentType)) {
    sections.push({
      command: 'speed',
      label: '速度',
      options: getSpeedTierOptions(),
    });
  }

  return sections;
}
