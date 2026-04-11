export type RuntimeAgentType = 'claude' | 'codex';
export type RuntimeCommandEntrypoint = 'im' | 'web';
export type ReasoningEffortPreset = 'low' | 'medium' | 'high' | 'xhigh';
export interface RuntimePresetOption {
  value: string;
  label: string;
}

const CLAUDE_MODEL_PRESETS = [
  'opus[1m]',
  'opus',
  'sonnet[1m]',
  'sonnet',
  'haiku',
] as const;

const CODEX_MODEL_PRESETS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2',
] as const;

const REASONING_EFFORT_PRESETS = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export interface RuntimeCommandDefinition {
  name: string;
  aliases?: string[];
  usage: string;
  description: string;
  availableEntrypoints: RuntimeCommandEntrypoint[];
  availabilityByRuntime?: RuntimeAgentType[] | 'all';
}

export interface ParsedRuntimeCommand {
  rawName: string;
  name: string;
  argsText: string;
  args: string[];
}

export interface ParsedSlashCommandCandidate {
  rawName: string;
  argsText: string;
  args: string[];
}

export const RUNTIME_COMMANDS: RuntimeCommandDefinition[] = [
  {
    name: 'help',
    usage: '/help',
    description: '查看当前入口可用命令',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'clear',
    usage: '/clear',
    description: '清除当前工作区或会话上下文',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'list',
    aliases: ['ls'],
    usage: '/list',
    description: '查看当前用户可访问的工作区与对话',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'status',
    usage: '/status',
    description: '查看当前工作区和运行状态摘要',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'usage',
    usage: '/usage',
    description: '查看 Codex 和 Claude 的 5h / 7d 用量余额',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'recall',
    aliases: ['rc'],
    usage: '/recall',
    description: '回顾当前工作区最近消息',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'where',
    usage: '/where',
    description: '查看当前聊天绑定位置',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'bind',
    usage: '/bind <workspace>',
    description: '绑定到指定工作区或会话',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'unbind',
    usage: '/unbind',
    description: '解除当前绑定',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'new',
    usage: '/new <名称>',
    description: '创建新工作区并绑定过去',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'require_mention',
    usage: '/require_mention true|false',
    description: '控制群聊中是否必须 @机器人',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'sw',
    aliases: ['spawn'],
    usage: '/sw <任务描述>',
    description: '创建并行任务',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'model',
    usage: '/model',
    description: '切换当前工作区模型预设',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'effort',
    usage: '/effort',
    description: '切换当前工作区思考强度',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: ['codex'],
  },
];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function supportsReasoningEffort(
  agentType: RuntimeAgentType,
): boolean {
  return agentType === 'codex';
}

export function getModelPresets(agentType: RuntimeAgentType): string[] {
  return agentType === 'codex'
    ? [...CODEX_MODEL_PRESETS]
    : [...CLAUDE_MODEL_PRESETS];
}

export function getDefaultModelPreset(agentType: RuntimeAgentType): string {
  return getModelPresets(agentType)[0];
}

function formatModelPresetLabel(preset: string): string {
  return preset
    .split('-')
    .map((part) => {
      const normalized = part.toLowerCase();
      if (normalized === 'gpt') return 'GPT';
      if (normalized === 'codex') return 'Codex';
      if (normalized === 'mini') return 'Mini';
      if (normalized.startsWith('opus')) return `Opus${part.slice(4)}`;
      if (normalized.startsWith('sonnet')) return `Sonnet${part.slice(6)}`;
      if (normalized.startsWith('haiku')) return `Haiku${part.slice(5)}`;
      return part;
    })
    .join('-');
}

export function getModelPresetOptions(
  agentType: RuntimeAgentType,
): RuntimePresetOption[] {
  return getModelPresets(agentType).map((value) => ({
    value,
    label: formatModelPresetLabel(value),
  }));
}

export function getReasoningEffortPresets(): ReasoningEffortPreset[] {
  return [...REASONING_EFFORT_PRESETS];
}

export function getDefaultReasoningEffortPreset(
  agentType: RuntimeAgentType,
): ReasoningEffortPreset | null {
  if (!supportsReasoningEffort(agentType)) return null;
  return 'medium';
}

export function getReasoningEffortOptions(): RuntimePresetOption[] {
  return getReasoningEffortPresets().map((value) => ({ value, label: value }));
}

export function normalizeModelPreset(
  agentType: RuntimeAgentType,
  rawValue: string,
): string | null {
  const normalized = normalizeText(rawValue);
  const matched = getModelPresets(agentType).find(
    (preset) => preset.toLowerCase() === normalized,
  );
  return matched ?? null;
}

export function normalizeReasoningEffortPreset(
  rawValue: string,
): ReasoningEffortPreset | null {
  const normalized = normalizeText(rawValue);
  return REASONING_EFFORT_PRESETS.find((preset) => preset === normalized) ?? null;
}

function isCommandAvailableForAgent(
  command: RuntimeCommandDefinition,
  agentType: RuntimeAgentType,
): boolean {
  if (
    command.availabilityByRuntime === 'all' ||
    !command.availabilityByRuntime
  ) {
    return true;
  }
  return command.availabilityByRuntime.includes(agentType);
}

export function findRuntimeCommand(
  rawName: string,
): RuntimeCommandDefinition | null {
  const normalized = normalizeText(rawName);
  if (!normalized) return null;
  return (
    RUNTIME_COMMANDS.find((command) => {
      if (command.name === normalized) return true;
      return command.aliases?.some((alias) => alias === normalized);
    }) ?? null
  );
}

export function parseSlashCommandCandidate(
  text: string,
  options: { allowBare?: boolean } = {},
): ParsedSlashCommandCandidate | null {
  const trimmed = text.trim();
  const allowBare = options.allowBare === true;
  if (!trimmed.startsWith('/')) {
    if (!allowBare) return null;
  }

  const body = trimmed.startsWith('/') ? trimmed.slice(1).trim() : trimmed;
  if (!body) return null;

  const [rawName = '', ...args] = body.split(/\s+/);
  if (!/^[a-z_][a-z0-9_-]*$/i.test(rawName)) return null;

  return {
    rawName,
    argsText: body.slice(rawName.length).trim(),
    args,
  };
}

export function parseRuntimeCommand(
  text: string,
): ParsedRuntimeCommand | null {
  const slashCandidate = parseSlashCommandCandidate(text);
  const trimmed = text.trim();
  const body = slashCandidate
    ? trimmed.slice(1).trim()
    : trimmed.startsWith('/')
      ? trimmed.slice(1).trim()
      : trimmed;
  if (!body) return null;

  const [rawName = '', ...args] = body.split(/\s+/);
  const command = findRuntimeCommand(rawName);
  if (!command) return null;

  return {
    rawName,
    name: command.name,
    argsText: body.slice(rawName.length).trim(),
    args,
  };
}

export function isCommandAvailable(options: {
  commandName: string;
  entrypoint: RuntimeCommandEntrypoint;
  agentType: RuntimeAgentType;
}): boolean {
  const command = findRuntimeCommand(options.commandName);
  if (!command) return false;
  return (
    command.availableEntrypoints.includes(options.entrypoint) &&
    isCommandAvailableForAgent(command, options.agentType)
  );
}

export function getAvailableCommands(options: {
  entrypoint: RuntimeCommandEntrypoint;
  agentType: RuntimeAgentType;
}): RuntimeCommandDefinition[] {
  return RUNTIME_COMMANDS.filter(
    (command) =>
      command.availableEntrypoints.includes(options.entrypoint) &&
      isCommandAvailableForAgent(command, options.agentType),
  );
}

export function formatCommandHelp(options: {
  entrypoint: RuntimeCommandEntrypoint;
  agentType: RuntimeAgentType;
}): string {
  const commands = getAvailableCommands(options);
  const lines = ['可用命令：'];
  for (const command of commands) {
    lines.push(`- ${command.usage}：${command.description}`);
  }
  return lines.join('\n');
}

export function formatUnknownRuntimeCommandReply(rawName: string): string {
  return `不支持的命令 /${rawName}，请使用 /help 查看当前可用命令`;
}
