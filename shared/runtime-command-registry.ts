export type KnownRuntimeAgentType = 'openai';
export type RuntimePluginAgentType = string & {};
export type RuntimeAgentType = KnownRuntimeAgentType | RuntimePluginAgentType;
export type RuntimeCommandEntrypoint = 'im' | 'web';
export type ReasoningEffortPreset = 'low' | 'medium' | 'high' | 'xhigh';
export type SpeedTierPreset = 'standard' | 'fast';
export interface RuntimePresetOption {
  value: string;
  label: string;
}

export type RuntimeCommandModule = 'agent' | 'workspace' | 'service';

const OPENAI_MODEL_PRESETS = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2'] as const;

const REASONING_EFFORT_PRESETS = ['low', 'medium', 'high', 'xhigh'] as const;

const SPEED_TIER_PRESETS = ['standard', 'fast'] as const;

export interface RuntimeCommandDefinition {
  name: string;
  aliases?: string[];
  usage: string;
  description: string;
  module: RuntimeCommandModule;
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
    description: '查看当前入口按模块分组的命令',
    module: 'agent',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'clear',
    usage: '/clear',
    description: '清除当前工作区或会话上下文',
    module: 'agent',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'list',
    aliases: ['ls'],
    usage: '/list',
    description: '查看当前实例的工作区与最近任务线程',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'status',
    usage: '/status',
    description: '查看当前工作区和运行状态摘要',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'self-status',
    usage: '/self-status',
    description: '查看 agent-fabric 服务版本、自检与重启需求',
    module: 'service',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'self-check',
    usage: '/self-check',
    description: '隔离启动候选服务做冷启动健康检查，不重启当前服务',
    module: 'service',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'self-restart',
    usage: '/self-restart',
    description: '创建自重启 intent 并交给独立 watchdog 执行',
    module: 'service',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'bind',
    usage: '/bind <workspace>',
    description: '设置当前 IM 入口的默认工作区',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'where',
    usage: '/where',
    description: '查看当前 IM 入口指向的工作区和任务线程',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'use',
    usage: '/use <工作区>',
    description: '切换当前 IM 入口的默认工作区',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'to',
    usage: '/to <工作区> <消息>',
    description: '单次把消息发送到指定工作区',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'threads',
    usage: '/threads',
    description: '查看当前工作区最近任务线程',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'back',
    usage: '/back',
    description: '回到当前工作区主线',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'unbind',
    usage: '/unbind',
    description: '解除当前绑定',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'new',
    usage: '/new <名称>',
    description: '创建新工作区并绑定过去',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'require_mention',
    usage: '/require_mention <true/false>',
    description: '控制群聊中是否必须 @机器人',
    module: 'workspace',
    availableEntrypoints: ['im'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'sw',
    aliases: ['spawn'],
    usage: '/sw <任务描述>',
    description: '创建并行任务',
    module: 'agent',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'workflow',
    usage: '/workflow [id] [任务]',
    description: '列出或触发当前工作区的工作流',
    module: 'agent',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: 'all',
  },
  {
    name: 'openai',
    usage: '/openai',
    description: '配置当前工作区 Codex/OpenAI 模型、推理强度和速度',
    module: 'agent',
    availableEntrypoints: ['im', 'web'],
    availabilityByRuntime: ['openai'],
  },
];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function supportsReasoningEffort(agentType: RuntimeAgentType): boolean {
  return agentType === 'openai';
}

export function supportsSpeedTier(agentType: RuntimeAgentType): boolean {
  return agentType === 'openai';
}

export function getModelPresets(agentType: RuntimeAgentType): string[] {
  return agentType === 'openai' ? [...OPENAI_MODEL_PRESETS] : [];
}

export function getDefaultModelPreset(agentType: RuntimeAgentType): string {
  return getModelPresets(agentType)[0] ?? OPENAI_MODEL_PRESETS[0];
}

function formatModelPresetLabel(preset: string): string {
  return preset
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

export function getSpeedTierPresets(): SpeedTierPreset[] {
  return [...SPEED_TIER_PRESETS];
}

export function getDefaultSpeedTierPreset(
  agentType: RuntimeAgentType,
): SpeedTierPreset | null {
  if (!supportsSpeedTier(agentType)) return null;
  return 'standard';
}

export function getSpeedTierOptions(): RuntimePresetOption[] {
  return [
    { value: 'standard', label: 'standard (1x)' },
    { value: 'fast', label: 'fast (2x)' },
  ];
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
  return (
    REASONING_EFFORT_PRESETS.find((preset) => preset === normalized) ?? null
  );
}

export function normalizeSpeedTierPreset(
  rawValue: string,
): SpeedTierPreset | null {
  const normalized = normalizeText(rawValue);
  return SPEED_TIER_PRESETS.find((preset) => preset === normalized) ?? null;
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

export function parseRuntimeCommand(text: string): ParsedRuntimeCommand | null {
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
  const moduleLabels: Array<[RuntimeCommandModule, string]> = [
    ['agent', 'Agent 命令'],
    ['workspace', '工作区命令'],
    ['service', '服务命令'],
  ];
  const sections: string[] = [];

  for (const [module, label] of moduleLabels) {
    const moduleCommands = commands.filter(
      (command) => command.module === module,
    );
    if (moduleCommands.length === 0) continue;
    sections.push(
      [
        `${label}：`,
        ...moduleCommands.map(
          (command) => `- ${command.usage}：${command.description}`,
        ),
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

export function formatUnknownRuntimeCommandReply(rawName: string): string {
  return `不支持的命令 /${rawName}，请使用 /help 查看当前可用命令`;
}
