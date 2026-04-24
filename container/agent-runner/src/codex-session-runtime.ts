export interface RequestedCodexRuntime {
  model?: string | null;
  reasoningEffort?: string | null;
}

export interface CodexTurnAccumulator {
  text: string;
  lastMessageUuid?: string;
}

const CODEX_RUNTIME_DIAGNOSTIC_PREFIXES = [
  /^Model metadata for (?:`[^`]+`|\S+) not found\. Defaulting to fallback metadata; this can degrade performance and cause issues\.\s*/u,
];

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
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

  if (model) {
    overrides.push(`model=${toTomlBasicString(model)}`);
  }

  if (reasoningEffort) {
    overrides.push(
      `model_reasoning_effort=${toTomlBasicString(reasoningEffort)}`,
    );
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
