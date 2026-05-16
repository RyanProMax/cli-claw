import {
  formatCommandHelp,
  getReasoningEffortPresets,
  getSpeedTierOptions,
  getSpeedTierPresets,
  normalizeReasoningEffortPreset,
  normalizeSpeedTierPreset,
  parseRuntimeCommand,
  supportsReasoningEffort,
  supportsSpeedTier,
  type RuntimeCommandEntrypoint,
} from '../../runtime-command-registry.js';
import {
  getAvailableRuntimeModelCatalog,
  getAvailableRuntimeModelPresets,
  normalizeAvailableRuntimeModelPreset,
} from './model-options.js';
import {
  getClaudeProviderConfig,
  getOpenAiRuntimeDefaults,
} from '../../runtime-config.js';
import {
  buildEffectiveGroupFromHomeSibling,
  resolveEffectiveRuntimeIdentity,
} from './group-runtime.js';
import { logger } from '../../logger.js';
import { resetWorkspaceRuntimeState } from '../../agent/runner/workspace-reset.js';
import type {
  AgentType,
  RegisteredGroup,
  RuntimeIdentity,
} from '../../types.js';

export interface RuntimeCommandAgentLike {
  id: string;
  chat_jid: string;
  name?: string;
}

export interface RuntimeCommandDeps {
  getGroup: (jid: string) => RegisteredGroup | undefined;
  setGroup: (jid: string, group: RegisteredGroup) => void;
  getSiblingJids: (folder: string) => string[];
  getAgent: (agentId: string) => RuntimeCommandAgentLike | undefined;
  queue: {
    stopGroup: (jid: string, opts: { force: boolean }) => Promise<unknown>;
  };
  getSessions: () => Record<string, string>;
}

export interface ResolvedRuntimeWorkspaceTarget {
  sourceChatJid: string;
  sourceGroup: RegisteredGroup;
  workspaceJid: string;
  workspaceGroup: RegisteredGroup;
  runtimeOwnerJid: string;
  runtimeOwnerGroup: RegisteredGroup;
  effectiveGroup: RegisteredGroup;
  effectiveRuntimeIdentity: RuntimeIdentity;
}

export interface RuntimeCommandResponse {
  handled: boolean;
  reply: string | null;
}

export interface RuntimeWorkspaceSelectionOptions {
  chatJid: string;
  selection: 'model' | 'effort' | 'speed';
  value: string;
  deps: RuntimeCommandDeps;
}

function stripVirtualChatJid(chatJid: string): string {
  const agentIdx = chatJid.indexOf('#agent:');
  if (agentIdx >= 0) return chatJid.slice(0, agentIdx);
  return chatJid;
}

function normalizeAgentType(value: string | null | undefined): AgentType {
  return value === 'claude' ? 'claude' : 'openai';
}

function resolveLegacyMainJid(
  targetMainJid: string,
  deps: Pick<RuntimeCommandDeps, 'getGroup' | 'getSiblingJids'>,
): string {
  if (deps.getGroup(targetMainJid)) return targetMainJid;
  if (!targetMainJid.startsWith('web:')) return targetMainJid;

  const folder = targetMainJid.slice(4);
  for (const jid of deps.getSiblingJids(folder)) {
    if (jid.startsWith('web:') && deps.getGroup(jid)) return jid;
  }
  return targetMainJid;
}

function findHomeWorkspaceJid(
  group: RegisteredGroup,
  deps: Pick<RuntimeCommandDeps, 'getGroup' | 'getSiblingJids'>,
): string | null {
  const siblingJids = deps.getSiblingJids(group.folder);
  let fallbackHomeJid: string | null = null;

  for (const jid of siblingJids) {
    const sibling = deps.getGroup(jid);
    if (!sibling?.is_home) continue;
    if (jid.startsWith('web:')) return jid;
    fallbackHomeJid = fallbackHomeJid ?? jid;
  }

  return fallbackHomeJid;
}

function resolveWorkspaceJid(
  sourceChatJid: string,
  sourceGroup: RegisteredGroup,
  deps: Pick<RuntimeCommandDeps, 'getAgent' | 'getGroup' | 'getSiblingJids'>,
): string {
  if (sourceGroup.target_agent_id) {
    const agent = deps.getAgent(sourceGroup.target_agent_id);
    if (agent?.chat_jid) return agent.chat_jid;
  }

  if (sourceGroup.target_main_jid) {
    return resolveLegacyMainJid(sourceGroup.target_main_jid, deps);
  }

  if (sourceChatJid.startsWith('web:')) {
    return sourceChatJid;
  }

  return findHomeWorkspaceJid(sourceGroup, deps) ?? sourceChatJid;
}

function resolveEffectiveRuntimeGroup(
  workspaceGroup: RegisteredGroup,
  deps: Pick<RuntimeCommandDeps, 'getGroup' | 'getSiblingJids'>,
): RegisteredGroup {
  if (workspaceGroup.is_home) return workspaceGroup;

  const homeJid = findHomeWorkspaceJid(workspaceGroup, deps);
  if (!homeJid) return workspaceGroup;

  const homeGroup = deps.getGroup(homeJid);
  if (!homeGroup) return workspaceGroup;

  return buildEffectiveGroupFromHomeSibling(workspaceGroup, homeGroup);
}

export function resolveRuntimeWorkspaceTarget(
  chatJid: string,
  deps: Pick<RuntimeCommandDeps, 'getAgent' | 'getGroup' | 'getSiblingJids'>,
): ResolvedRuntimeWorkspaceTarget | null {
  const sourceChatJid = stripVirtualChatJid(chatJid);
  const sourceGroup = deps.getGroup(sourceChatJid);
  if (!sourceGroup) return null;

  const workspaceJid = resolveWorkspaceJid(sourceChatJid, sourceGroup, deps);
  const workspaceGroup = deps.getGroup(workspaceJid) ?? sourceGroup;
  const homeRuntimeJid = workspaceGroup.is_home
    ? null
    : findHomeWorkspaceJid(workspaceGroup, deps);
  const runtimeOwnerJid =
    homeRuntimeJid && homeRuntimeJid.trim() ? homeRuntimeJid : workspaceJid;
  const runtimeOwnerGroup = deps.getGroup(runtimeOwnerJid) ?? workspaceGroup;
  const effectiveGroup = resolveEffectiveRuntimeGroup(workspaceGroup, deps);
  const openAiRuntimeDefaults = getOpenAiRuntimeDefaults();
  const effectiveRuntimeIdentity = resolveEffectiveRuntimeIdentity(
    effectiveGroup,
    {
      claudeProviderModel: getClaudeProviderConfig().anthropicModel,
      openAiModel: openAiRuntimeDefaults.model,
      openAiReasoningEffort: openAiRuntimeDefaults.reasoningEffort,
      openAiSpeedTier: openAiRuntimeDefaults.speedTier,
    },
  );

  return {
    sourceChatJid,
    sourceGroup,
    workspaceJid,
    workspaceGroup,
    runtimeOwnerJid,
    runtimeOwnerGroup,
    effectiveGroup,
    effectiveRuntimeIdentity,
  };
}

function buildHelpReply(
  entrypoint: RuntimeCommandEntrypoint,
  target: ResolvedRuntimeWorkspaceTarget,
): string {
  return formatCommandHelp({
    entrypoint,
    agentType: normalizeAgentType(target.effectiveGroup.agentType),
  });
}

function formatSpeedTierLabel(value: string | null | undefined): string {
  return value === 'fast' ? 'fast (2x)' : 'standard (1x)';
}

function buildAgentConfigReply(
  agentType: AgentType,
  target: ResolvedRuntimeWorkspaceTarget,
): string {
  const modelCatalog = getAvailableRuntimeModelCatalog(agentType, {
    currentModel: target.effectiveRuntimeIdentity.model,
  });
  const lines = [
    `${agentType === 'openai' ? 'OpenAI' : 'Claude'} 配置：`,
    `当前模型：${target.effectiveRuntimeIdentity.model}`,
    `可用模型：${modelCatalog.options.map((option) => option.value).join(', ')}`,
  ];

  if (agentType === 'openai') {
    const currentEffort =
      target.effectiveRuntimeIdentity.reasoningEffort?.trim() || 'medium';
    lines.push(`当前思考强度：${currentEffort}`);
    lines.push(`可用思考强度：${getReasoningEffortPresets().join(', ')}`);
    lines.push(
      `当前速度：${formatSpeedTierLabel(
        target.effectiveRuntimeIdentity.speedTier,
      )}`,
    );
    lines.push(
      `可用速度：${getSpeedTierOptions()
        .map((option) => option.label)
        .join(', ')}`,
    );
  }

  return lines.join('\n');
}

export function buildRuntimeStatusReply(
  target: ResolvedRuntimeWorkspaceTarget,
): string {
  const runtimeIdentity = target.effectiveRuntimeIdentity;
  const agentType = normalizeAgentType(runtimeIdentity.agentType);
  const currentEffort = runtimeIdentity.reasoningEffort?.trim() || null;
  const currentSpeedTier =
    agentType === 'openai'
      ? runtimeIdentity.speedTier === 'fast'
        ? 'fast (2x)'
        : 'standard (1x)'
      : null;
  const lines = [
    '🤖 Agent',
    '━━━━━━━━━━',
    `🤖 当前 Agent: ${agentType}`,
    `🧠 当前模型: ${runtimeIdentity.model}`,
  ];

  if (currentEffort) {
    lines.push(`⚙️ 当前推理强度: ${currentEffort}`);
  }
  if (currentSpeedTier) {
    lines.push(`🚀 当前速度: ${currentSpeedTier}`);
  }

  return lines.join('\n');
}

async function updateWorkspaceRuntime(
  target: ResolvedRuntimeWorkspaceTarget,
  deps: RuntimeCommandDeps,
  patch: Partial<
    Pick<RegisteredGroup, 'model' | 'reasoningEffort' | 'speedTier'>
  >,
): Promise<void> {
  logger.info(
    {
      sourceChatJid: target.sourceChatJid,
      runtimeOwnerJid: target.runtimeOwnerJid,
      previousModel: target.runtimeOwnerGroup.model ?? null,
      previousReasoningEffort: target.runtimeOwnerGroup.reasoningEffort ?? null,
      previousSpeedTier: target.runtimeOwnerGroup.speedTier ?? null,
      nextModel: patch.model ?? target.runtimeOwnerGroup.model ?? null,
      nextReasoningEffort:
        patch.reasoningEffort ??
        target.runtimeOwnerGroup.reasoningEffort ??
        null,
      nextSpeedTier:
        patch.speedTier ?? target.runtimeOwnerGroup.speedTier ?? null,
    },
    'Persisting workspace runtime update',
  );
  const updated: RegisteredGroup = {
    ...target.runtimeOwnerGroup,
    ...patch,
  };

  deps.setGroup(target.runtimeOwnerJid, updated);
  await resetWorkspaceRuntimeState(
    {
      queue: deps.queue,
      getSessions: deps.getSessions,
    },
    target.runtimeOwnerJid,
    updated,
  );
  logger.info(
    {
      runtimeOwnerJid: target.runtimeOwnerJid,
      persistedModel: updated.model ?? null,
      persistedReasoningEffort: updated.reasoningEffort ?? null,
      persistedSpeedTier: updated.speedTier ?? null,
    },
    'Persisted workspace runtime update',
  );
}

async function handleModelCommand(
  target: ResolvedRuntimeWorkspaceTarget,
  deps: RuntimeCommandDeps,
  rawPreset: string,
): Promise<string> {
  const agentType = normalizeAgentType(target.effectiveGroup.agentType);
  const modelOptions = {
    currentModel: target.effectiveRuntimeIdentity.model,
  };
  const preset = normalizeAvailableRuntimeModelPreset(
    agentType,
    rawPreset,
    modelOptions,
  );
  if (!preset) {
    return `不支持的 ${agentType} 模型。可用值：${getAvailableRuntimeModelPresets(
      agentType,
      modelOptions,
    ).join(', ')}`;
  }

  if ((target.runtimeOwnerGroup.model ?? null) === preset) {
    return `当前工作区模型已经是 ${preset}`;
  }

  await updateWorkspaceRuntime(target, deps, { model: preset });
  return `已将当前工作区模型切换为 ${preset}`;
}

async function handleEffortCommand(
  target: ResolvedRuntimeWorkspaceTarget,
  deps: RuntimeCommandDeps,
  rawPreset: string,
): Promise<string> {
  const agentType = normalizeAgentType(target.effectiveGroup.agentType);
  if (!supportsReasoningEffort(agentType)) {
    return `${agentType} 不支持该配置项，请使用 /${agentType} 查看可用配置`;
  }

  const preset = normalizeReasoningEffortPreset(rawPreset);
  if (!preset) {
    return `不支持的思考强度预设。可用值：${getReasoningEffortPresets().join(
      ', ',
    )}`;
  }

  if ((target.runtimeOwnerGroup.reasoningEffort ?? null) === preset) {
    return `当前工作区思考强度已经是 ${preset}`;
  }

  await updateWorkspaceRuntime(target, deps, { reasoningEffort: preset });
  return `已将当前工作区思考强度切换为 ${preset}`;
}

async function handleSpeedCommand(
  target: ResolvedRuntimeWorkspaceTarget,
  deps: RuntimeCommandDeps,
  rawPreset: string,
): Promise<string> {
  const agentType = normalizeAgentType(target.effectiveGroup.agentType);
  if (!supportsSpeedTier(agentType)) {
    return `${agentType} 不支持该配置项，请使用 /${agentType} 查看可用配置`;
  }

  const preset = normalizeSpeedTierPreset(rawPreset);
  if (!preset) {
    return `不支持的速度预设。可用值：${getSpeedTierPresets().join(', ')}`;
  }

  const currentPreset = target.effectiveRuntimeIdentity.speedTier ?? 'standard';
  if (currentPreset === preset) {
    return `当前工作区速度已经是 ${preset}`;
  }

  await updateWorkspaceRuntime(target, deps, { speedTier: preset });
  return `已将当前工作区速度切换为 ${preset}`;
}

export async function applyRuntimeWorkspaceSelection(
  options: RuntimeWorkspaceSelectionOptions,
): Promise<RuntimeCommandResponse> {
  const target = resolveRuntimeWorkspaceTarget(options.chatJid, options.deps);
  if (!target) {
    return { handled: true, reply: '未找到当前工作区' };
  }

  const reply =
    options.selection === 'model'
      ? await handleModelCommand(target, options.deps, options.value)
      : options.selection === 'effort'
        ? await handleEffortCommand(target, options.deps, options.value)
        : await handleSpeedCommand(target, options.deps, options.value);

  return {
    handled: true,
    reply,
  };
}

export async function executeRuntimeWorkspaceCommand(options: {
  entrypoint: RuntimeCommandEntrypoint;
  chatJid: string;
  commandText: string;
  deps: RuntimeCommandDeps;
}): Promise<RuntimeCommandResponse> {
  const parsed = parseRuntimeCommand(options.commandText);
  if (!parsed) {
    return { handled: false, reply: null };
  }

  const target = resolveRuntimeWorkspaceTarget(options.chatJid, options.deps);
  if (!target) {
    return { handled: true, reply: '未找到当前工作区' };
  }

  const agentType = normalizeAgentType(target.effectiveGroup.agentType);

  switch (parsed.name) {
    case 'help':
      return {
        handled: true,
        reply: buildHelpReply(options.entrypoint, target),
      };
    case 'openai':
    case 'claude':
      if (parsed.argsText) {
        const label = parsed.name === 'openai' ? 'OpenAI' : 'Claude';
        return {
          handled: true,
          reply: `请直接输入 /${parsed.name} 打开 ${label} 配置选择器`,
        };
      }
      if (parsed.name !== agentType) {
        return {
          handled: true,
          reply: `当前工作区是 ${agentType}，请使用 /${agentType} 配置该 Agent`,
        };
      }
      return {
        handled: true,
        reply: buildAgentConfigReply(agentType, target),
      };
    default:
      return { handled: false, reply: null };
  }
}
