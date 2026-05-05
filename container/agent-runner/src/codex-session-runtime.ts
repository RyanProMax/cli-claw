export interface RequestedCodexRuntime {
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
}

export interface CodexTurnAccumulator {
  text: string;
  lastMessageUuid?: string;
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
