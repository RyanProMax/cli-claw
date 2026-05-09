import fs from 'node:fs';
import path from 'node:path';

export interface RequestedCodexRuntime {
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
}

export interface RuntimeIdentityState {
  agentType: 'claude' | 'codex';
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
  supportsReasoningEffort?: boolean | null;
}

export interface CodexTurnAccumulator {
  text: string;
  lastMessageUuid?: string;
}

export type CodexAssistantMessagePhase = 'commentary' | 'final_answer';

export interface CodexTranscriptCheckpoint {
  sessionId: string;
  transcriptPath?: string;
  offset: number;
  startedAtIso: string;
  sessionsDir?: string;
}

export interface CodexTranscriptPhaseMessage {
  phase: CodexAssistantMessagePhase;
  text: string;
  timestamp?: string;
}

export interface CodexTranscriptTurnResolution {
  transcriptPath?: string;
  messages: CodexTranscriptPhaseMessage[];
  commentaryText: string;
  finalAnswerText: string;
}

export interface CodexRuntimeErrorFormatOptions {
  isCodexRuntime?: boolean;
}

export interface CodexSessionUpdateEmissionState {
  livePromptActive: boolean;
}

const CODEX_RUNTIME_DIAGNOSTIC_PREFIXES = [
  /^Model metadata for (?:`[^`]+`|\S+) not found\. Defaulting to fallback metadata; this can degrade performance and cause issues\.\s*/u,
  /^Falling back from WebSockets to HTTPS transport\. stream disconnected before completion:\s*(?:tls handshake eof|The model (?:`[^`]+`|\S+) does not exist or you do not have access to it\.)\s*/u,
];

const CODEX_CONTEXT_WINDOW_ERROR_MESSAGE =
  'Codex 上下文窗口已满，当前会话历史太长，无法继续。请发送 /clear 清除当前会话上下文后重试，或在新会话里重新描述需求。';

const CODEX_REMOTE_COMPACT_PARAMETER_ERROR_MESSAGE =
  'Codex 上下文压缩失败：当前 Codex 运行时向远端 compact 接口发送了不兼容参数 safety_identifier。任务已中断；请升级或重启 Codex runtime 后重试，必要时发送 /clear 清除当前会话上下文。';

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRuntimeErrorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeModelId(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const [base] = normalized.split('/', 1);
  return base || normalized;
}

function normalizeReasoningEffort(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function normalizeServiceTier(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === 'standard') return null;
  return lowered;
}

export function mergeRuntimeIdentityState(
  base?: RuntimeIdentityState | null,
  next?: RuntimeIdentityState | null,
): RuntimeIdentityState | null {
  if (!base) return next ?? null;
  if (!next) return base;

  const agentType = next.agentType ?? base.agentType;
  const sameAgentType = agentType === base.agentType;
  return {
    agentType,
    model: normalizeText(next.model) ?? (sameAgentType ? base.model : null),
    reasoningEffort:
      normalizeText(next.reasoningEffort) ??
      (sameAgentType ? base.reasoningEffort : null),
    speedTier:
      normalizeText(next.speedTier) ?? (sameAgentType ? base.speedTier : null),
    supportsReasoningEffort:
      typeof next.supportsReasoningEffort === 'boolean'
        ? next.supportsReasoningEffort
        : sameAgentType
          ? base.supportsReasoningEffort
          : null,
  };
}

function toTomlBasicString(value: string): string {
  return JSON.stringify(value);
}

export function buildCodexAcpConfigOverrides(
  requestedRuntime: RequestedCodexRuntime,
): string[] {
  const overrides: string[] = [];
  const model = normalizeModelId(requestedRuntime.model);
  const reasoningEffort = normalizeReasoningEffort(
    requestedRuntime.reasoningEffort,
  );
  const serviceTier = normalizeServiceTier(requestedRuntime.speedTier);

  if (model) {
    overrides.push(`model=${toTomlBasicString(model)}`);
  }

  if (reasoningEffort) {
    overrides.push(
      `model_reasoning_effort=${toTomlBasicString(reasoningEffort)}`,
    );
  }

  if (serviceTier) {
    overrides.push(`service_tier=${toTomlBasicString(serviceTier)}`);
  }

  return overrides;
}

export function buildCodexAcpLaunchArgs(options: {
  acpCommand: string;
  requestedRuntime: RequestedCodexRuntime;
}): string[] {
  const args =
    options.acpCommand === 'npx' ? ['-y', '@zed-industries/codex-acp'] : [];

  for (const override of buildCodexAcpConfigOverrides(
    options.requestedRuntime,
  )) {
    args.push('-c', override);
  }

  return args;
}

export function shouldEmitCodexSessionUpdate(
  state: CodexSessionUpdateEmissionState,
): boolean {
  return state.livePromptActive;
}

export function stripCodexRuntimeDiagnosticPrefix(text: string): string {
  let next = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of CODEX_RUNTIME_DIAGNOSTIC_PREFIXES) {
      const stripped = next.replace(pattern, '');
      if (stripped !== next) {
        next = stripped;
        changed = true;
      }
    }
  }
  return next;
}

export function isCodexContextWindowError(errorMessage: string): boolean {
  const normalized = normalizeRuntimeErrorText(errorMessage);
  if (!normalized) return false;
  return (
    /context[_ ]window[_ ]exceeded/i.test(normalized) ||
    /ran out of room in (?:the )?model'?s context window/i.test(normalized) ||
    /start a new thread or clear earlier history/i.test(normalized) ||
    /maximum context length/i.test(normalized) ||
    /prompt is too long/i.test(normalized)
  );
}

export function isCodexRemoteCompactParameterError(
  errorMessage: string,
): boolean {
  const normalized = normalizeRuntimeErrorText(errorMessage);
  if (!normalized) return false;
  return (
    /remote compact task/i.test(normalized) &&
    /unknown[_ ]parameter/i.test(normalized) &&
    /safety_identifier/i.test(normalized)
  );
}

export function formatCodexRuntimeError(
  errorMessage: string,
  options: CodexRuntimeErrorFormatOptions = {},
): string {
  const normalized = normalizeRuntimeErrorText(errorMessage);
  if (!normalized) return 'Codex CLI 运行失败，请稍后重试。';

  const isCodexRuntime =
    options.isCodexRuntime === true ||
    /https:\/\/chatgpt\.com\/codex\/settings\/usage/i.test(normalized) ||
    /UsageLimitExceeded/i.test(normalized) ||
    /codex/i.test(normalized);
  if (!isCodexRuntime) return normalized;

  if (isCodexContextWindowError(normalized)) {
    return CODEX_CONTEXT_WINDOW_ERROR_MESSAGE;
  }

  if (isCodexRemoteCompactParameterError(normalized)) {
    return CODEX_REMOTE_COMPACT_PARAMETER_ERROR_MESSAGE;
  }

  if (
    /auth_required|login required|please login|not logged in/i.test(normalized)
  ) {
    return 'Codex CLI 未登录。请先在服务器上执行：codex login';
  }

  if (
    /UsageLimitExceeded/i.test(normalized) ||
    /purchase more credits/i.test(normalized) ||
    /https:\/\/chatgpt\.com\/codex\/settings\/usage/i.test(normalized)
  ) {
    const usageUrl =
      normalized.match(
        /https:\/\/chatgpt\.com\/codex\/settings\/usage/i,
      )?.[0] || 'https://chatgpt.com/codex/settings/usage';
    const retryAt = normalized.match(/try again at ([^.]+)\.?/i)?.[1]?.trim();
    return retryAt
      ? `Codex CLI 用量已用尽。请前往 ${usageUrl} 购买额度，或在 ${retryAt} 后重试。`
      : `Codex CLI 用量已用尽。请前往 ${usageUrl} 购买额度，或稍后重试。`;
  }

  return normalized;
}

export function appendCodexTurnChunk(
  currentText: string,
  chunk: { text?: string | null; messageUuid?: string | null },
  previousMessageUuid?: string,
): CodexTurnAccumulator {
  const deltaText = typeof chunk.text === 'string' ? chunk.text : '';
  if (!deltaText) {
    return {
      text: currentText,
      lastMessageUuid: previousMessageUuid,
    };
  }

  const nextMessageUuid = chunk.messageUuid || previousMessageUuid;
  const needsBoundary =
    !!currentText &&
    !!previousMessageUuid &&
    !!chunk.messageUuid &&
    previousMessageUuid !== chunk.messageUuid;
  const separator = !needsBoundary
    ? ''
    : /\n\s*\n$/.test(currentText)
      ? ''
      : currentText.endsWith('\n')
        ? '\n'
        : '\n\n';

  return {
    text: currentText + separator + deltaText,
    lastMessageUuid: nextMessageUuid || undefined,
  };
}

export function appendCodexFinalTurnChunk(
  currentText: string,
  chunk: {
    text?: string | null;
    messageUuid?: string | null;
    assistantMessagePhase?: CodexAssistantMessagePhase | null;
  },
  previousMessageUuid?: string,
): CodexTurnAccumulator {
  const deltaText = typeof chunk.text === 'string' ? chunk.text : '';
  if (chunk.assistantMessagePhase === 'commentary') {
    return {
      text: currentText,
      lastMessageUuid: previousMessageUuid,
    };
  }
  if (!deltaText) {
    return {
      text: currentText,
      lastMessageUuid: previousMessageUuid,
    };
  }

  if (
    currentText &&
    previousMessageUuid &&
    chunk.messageUuid &&
    previousMessageUuid !== chunk.messageUuid
  ) {
    return {
      text: deltaText,
      lastMessageUuid: chunk.messageUuid,
    };
  }

  const nextMessageUuid = chunk.messageUuid || previousMessageUuid;
  return {
    text: currentText + deltaText,
    lastMessageUuid: nextMessageUuid || undefined,
  };
}

export function normalizeCodexAssistantMessagePhase(
  value: unknown,
): CodexAssistantMessagePhase | undefined {
  if (value === 'commentary' || value === 'final_answer') return value;
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNestedPhase(
  record: Record<string, unknown> | undefined,
  keys: string[],
): CodexAssistantMessagePhase | undefined {
  let current: unknown = record;
  for (const key of keys) {
    const currentRecord = readRecord(current);
    if (!currentRecord) return undefined;
    current = currentRecord[key];
  }
  return normalizeCodexAssistantMessagePhase(current);
}

export function extractCodexAssistantMessagePhase(
  update: unknown,
): CodexAssistantMessagePhase | undefined {
  const record = readRecord(update);
  if (!record) return undefined;
  const candidates: Array<string[]> = [
    ['phase'],
    ['_meta', 'phase'],
    ['metadata', 'phase'],
    ['content', 'phase'],
    ['content', '_meta', 'phase'],
    ['content', 'metadata', 'phase'],
  ];
  for (const keys of candidates) {
    const phase = readNestedPhase(record, keys);
    if (phase) return phase;
  }
  return undefined;
}

function defaultCodexSessionsDir(): string | undefined {
  const homeDir = process.env.HOME;
  if (!homeDir) return undefined;
  return path.join(homeDir, '.codex', 'sessions');
}

export function findCodexTranscriptPath(
  sessionId: string | null | undefined,
  sessionsDir = defaultCodexSessionsDir(),
): string | undefined {
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId || !sessionsDir) return undefined;
  if (!fs.existsSync(sessionsDir)) return undefined;

  const visit = (dir: string, depth: number): string | undefined => {
    if (depth > 6) return undefined;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }

    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const name of files) {
      if (name.includes(normalizedSessionId) && name.endsWith('.jsonl')) {
        return path.join(dir, name);
      }
    }

    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const name of dirs) {
      const found = visit(path.join(dir, name), depth + 1);
      if (found) return found;
    }
    return undefined;
  };

  return visit(sessionsDir, 0);
}

export function createCodexTranscriptCheckpoint(
  sessionId: string,
  options: { now?: Date; sessionsDir?: string } = {},
): CodexTranscriptCheckpoint {
  const transcriptPath = findCodexTranscriptPath(
    sessionId,
    options.sessionsDir,
  );
  let offset = 0;
  if (transcriptPath) {
    try {
      offset = fs.statSync(transcriptPath).size;
    } catch {
      offset = 0;
    }
  }
  return {
    sessionId,
    transcriptPath,
    offset,
    startedAtIso: (options.now ?? new Date()).toISOString(),
    sessionsDir: options.sessionsDir,
  };
}

export function extractCodexTranscriptPhaseMessagesFromJsonl(
  jsonlText: string,
  options: { startedAtIso?: string } = {},
): CodexTranscriptPhaseMessage[] {
  const messages: CodexTranscriptPhaseMessage[] = [];
  const startedAtMs = options.startedAtIso
    ? Date.parse(options.startedAtIso)
    : Number.NaN;

  for (const line of jsonlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const item = readRecord(record);
    const payload = readRecord(item?.payload);
    if (item?.type !== 'event_msg' || payload?.type !== 'agent_message') {
      continue;
    }

    const timestamp =
      typeof item.timestamp === 'string' ? item.timestamp : undefined;
    if (timestamp && Number.isFinite(startedAtMs)) {
      const timestampMs = Date.parse(timestamp);
      if (Number.isFinite(timestampMs) && timestampMs < startedAtMs) continue;
    }

    const phase = normalizeCodexAssistantMessagePhase(payload.phase);
    const text = typeof payload.message === 'string' ? payload.message : '';
    if (!phase || !text.trim()) continue;
    messages.push({ phase, text, timestamp });
  }

  return messages;
}

function joinTranscriptPhaseText(
  messages: CodexTranscriptPhaseMessage[],
  phase: CodexAssistantMessagePhase,
): string {
  return messages
    .filter((message) => message.phase === phase)
    .map((message) => message.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function buildCodexTranscriptTurnResolution(
  messages: CodexTranscriptPhaseMessage[],
  transcriptPath?: string,
): CodexTranscriptTurnResolution {
  return {
    transcriptPath,
    messages,
    commentaryText: joinTranscriptPhaseText(messages, 'commentary'),
    finalAnswerText: joinTranscriptPhaseText(messages, 'final_answer'),
  };
}

export function resolveCodexTranscriptTurn(
  checkpoint: CodexTranscriptCheckpoint | null | undefined,
): CodexTranscriptTurnResolution | null {
  if (!checkpoint) return null;
  const transcriptPath =
    checkpoint.transcriptPath ||
    findCodexTranscriptPath(checkpoint.sessionId, checkpoint.sessionsDir);
  if (!transcriptPath) return null;

  let content = '';
  try {
    const full = fs.readFileSync(transcriptPath);
    const offset =
      checkpoint.offset > 0 && checkpoint.offset < full.byteLength
        ? checkpoint.offset
        : 0;
    content = full.subarray(offset).toString('utf8');
  } catch {
    return null;
  }

  const messages = extractCodexTranscriptPhaseMessagesFromJsonl(content, {
    startedAtIso: checkpoint.offset > 0 ? undefined : checkpoint.startedAtIso,
  });
  if (messages.length === 0) return null;
  return buildCodexTranscriptTurnResolution(messages, transcriptPath);
}
