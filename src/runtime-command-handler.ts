import {
  formatCommandHelp,
  getDefaultModelPreset,
  getDefaultReasoningEffortPreset,
  getModelPresets,
  getReasoningEffortPresets,
  normalizeModelPreset,
  normalizeReasoningEffortPreset,
  parseRuntimeCommand,
  supportsReasoningEffort,
  type RuntimeCommandEntrypoint,
} from './runtime-command-registry.js';
import { getClaudeProviderConfig } from './runtime-config.js';
import { buildEffectiveGroupFromHomeSibling } from './group-runtime.js';
import { resetWorkspaceRuntimeState } from './workspace-runtime-reset.js';
import type { AgentType, RegisteredGroup } from './types.js';

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
  effectiveGroup: RegisteredGroup;
}

export interface RuntimeCommandResponse {
  handled: boolean;
  reply: string | null;
}

export interface RuntimeWorkspaceSelectionOptions {
  chatJid: string;
  selection: 'model' | 'effort';
  value: string;
  deps: RuntimeCommandDeps;
}

function stripVirtualChatJid(chatJid: string): string {
  const agentIdx = chatJid.indexOf('#agent:');
  if (agentIdx >= 0) return chatJid.slice(0, agentIdx);
  return chatJid;
}

function normalizeAgentType(value: string | null | undefined): AgentType {
  return value === 'codex' ? 'codex' : 'claude';
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
  const effectiveGroup = resolveEffectiveRuntimeGroup(workspaceGroup, deps);

  return {
    sourceChatJid,
    sourceGroup,
    workspaceJid,
    workspaceGroup,
    effectiveGroup,
  };
}

function formatRuntimeScopeLabel(
  target: ResolvedRuntimeWorkspaceTarget,
): string {
  return target.workspaceGroup.name || target.effectiveGroup.folder;
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

function resolveCurrentModelPreset(
  agentType: AgentType,
  target: ResolvedRuntimeWorkspaceTarget,
): string {
  const explicitModel = target.effectiveGroup.model?.trim();
  if (explicitModel) return explicitModel;

  if (agentType === 'claude') {
    const providerModel = getClaudeProviderConfig().anthropicModel?.trim();
    if (providerModel) return providerModel;
  }

  return getDefaultModelPreset(agentType);
}

function resolveCurrentReasoningEffort(
  agentType: AgentType,
  target: ResolvedRuntimeWorkspaceTarget,
): string | null {
  const explicitEffort = target.effectiveGroup.reasoningEffort?.trim();
  if (explicitEffort) return explicitEffort;
  return getDefaultReasoningEffortPreset(agentType);
}

export function buildRuntimeStatusReply(
  target: ResolvedRuntimeWorkspaceTarget,
): string {
  const agentType = normalizeAgentType(target.effectiveGroup.agentType);
  const currentEffort = resolveCurrentReasoningEffort(agentType, target);
  const lines = [
    `当前工作区: ${formatRuntimeScopeLabel(target)}`,
    `当前 runtime: ${agentType}`,
    `当前模型: ${resolveCurrentModelPreset(agentType, target)}`,
  ];

  if (currentEffort) {
    lines.push(`当前思考强度: ${currentEffort}`);
  }

  lines.push(`模型预设: ${getModelPresets(agentType).join(', ')}`);
  if (supportsReasoningEffort(agentType)) {
    lines.push(`思考强度预设: ${getReasoningEffortPresets().join(', ')}`);
  }

  return lines.join('\n');
}

async function updateWorkspaceRuntime(
  target: ResolvedRuntimeWorkspaceTarget,
  deps: RuntimeCommandDeps,
  patch: Partial<Pick<RegisteredGroup, 'model' | 'reasoningEffort'>>,
): Promise<void> {
  const updated: RegisteredGroup = {
    ...target.workspaceGroup,
    ...patch,
  };

  deps.setGroup(target.workspaceJid, updated);
  await resetWorkspaceRuntimeState(
    {
      queue: deps.queue,
      getSessions: deps.getSessions,
    },
    target.workspaceJid,
    updated,
  );
}

async function handleModelCommand(
  target: ResolvedRuntimeWorkspaceTarget,
  deps: RuntimeCommandDeps,
  rawPreset: string,
): Promise<string> {
  const agentType = normalizeAgentType(target.effectiveGroup.agentType);
  const preset = normalizeModelPreset(agentType, rawPreset);
  if (!preset) {
    return `不支持的 ${agentType} 模型预设。可用值：${getModelPresets(
      agentType,
    ).join(', ')}`;
  }

  if ((target.workspaceGroup.model ?? null) === preset) {
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
    return `${agentType} 不支持 /effort，可继续使用 /model 切换模型`;
  }

  const preset = normalizeReasoningEffortPreset(rawPreset);
  if (!preset) {
    return `不支持的思考强度预设。可用值：${getReasoningEffortPresets().join(
      ', ',
    )}`;
  }

  if ((target.workspaceGroup.reasoningEffort ?? null) === preset) {
    return `当前工作区思考强度已经是 ${preset}`;
  }

  await updateWorkspaceRuntime(target, deps, { reasoningEffort: preset });
  return `已将当前工作区思考强度切换为 ${preset}`;
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
      : await handleEffortCommand(target, options.deps, options.value);

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
    case 'model':
      if (parsed.argsText) {
        return {
          handled: true,
          reply: '请直接输入 /model 打开模型选择器',
        };
      }
      return {
        handled: true,
        reply: `可用模型：${getModelPresets(agentType).join(', ')}`,
      };
    case 'effort':
      if (!supportsReasoningEffort(agentType)) {
        return {
          handled: true,
          reply: `${agentType} 不支持 /effort，可继续使用 /model 切换模型`,
        };
      }
      return {
        handled: true,
        reply: parsed.argsText
          ? '请直接输入 /effort 打开思考强度选择器'
          : `可用思考强度：${getReasoningEffortPresets().join(', ')}`,
      };
    default:
      return { handled: false, reply: null };
  }
}
