import type { AgentProcessOutput, StreamEvent } from './types.js';

export interface RuntimeIdentityState {
  agentType: 'openai';
  model?: string | null;
  reasoningEffort?: string | null;
  speedTier?: string | null;
  supportsReasoningEffort?: boolean | null;
}

type EmitOutput = (output: AgentProcessOutput) => void;
type AssistantMessagePhase = NonNullable<StreamEvent['assistantMessagePhase']>;

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function mergeRuntimeIdentityState(
  base?: RuntimeIdentityState | null,
  next?: RuntimeIdentityState | null,
): RuntimeIdentityState | null {
  if (!base) return next ?? null;
  if (!next) return base;
  return {
    agentType: 'openai',
    model: normalizeText(next.model) ?? base.model,
    reasoningEffort:
      normalizeText(next.reasoningEffort) ?? base.reasoningEffort,
    speedTier: normalizeText(next.speedTier) ?? base.speedTier,
    supportsReasoningEffort:
      typeof next.supportsReasoningEffort === 'boolean'
        ? next.supportsReasoningEffort
        : base.supportsReasoningEffort,
  };
}

function summarizeUnknown(value: unknown, maxLength = 240): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return serialized.length > maxLength
      ? `${serialized.slice(0, maxLength)}...`
      : serialized;
  } catch {
    return String(value);
  }
}

function getRawItem(event: unknown): Record<string, unknown> | null {
  const item = (event as { item?: { rawItem?: unknown } }).item;
  const rawItem = item?.rawItem;
  return rawItem && typeof rawItem === 'object'
    ? (rawItem as Record<string, unknown>)
    : null;
}

function getUsageNumber(
  usage: Record<string, unknown>,
  keys: string[],
): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

export function formatOpenAiRuntimeError(errorMessage: string): string {
  const normalized = errorMessage.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'OpenAI runtime failed. Please retry later.';
  if (
    /Codex CLI login|CLI_CLAW_CODEX_ACCESS_TOKEN|auth_required|login required|not logged in|unauthorized|401/i.test(
      normalized,
    )
  ) {
    return 'Codex CLI login is missing or expired. Run `codex login`, then retry.';
  }
  if (
    /context[_ ]window|maximum context|prompt is too long|token limit/i.test(
      normalized,
    )
  ) {
    return 'OpenAI context window is full. Clear this session or start a new session with a shorter prompt.';
  }
  if (/rate limit|429|quota|insufficient_quota/i.test(normalized)) {
    return 'OpenAI rate limit or quota was reached. Retry later or check account usage.';
  }
  if (
    /Items are not persisted when store is set to false|Item with id .* not found.*store is set to false/i.test(
      normalized,
    )
  ) {
    return 'OpenAI runtime request referenced non-persisted response state while store is false. Retry this turn; if it repeats, clear the OpenAI runtime session and retry.';
  }
  if (/Store must be set to false/i.test(normalized)) {
    return 'OpenAI runtime request was rejected by Codex backend because store must be false. Update and restart cli-claw, then retry.';
  }
  if (/model.*not.*found|invalid.*model|does not exist/i.test(normalized)) {
    return `OpenAI model/config is invalid: ${normalized}`;
  }
  if (
    /400 status code \(no body\)|"status"\s*:\s*400|status:\s*400/i.test(
      normalized,
    )
  ) {
    return 'OpenAI runtime request was rejected by Codex backend (400). Check the latest process log for the request id, update and restart cli-claw, then retry.';
  }
  return normalized;
}

export class OpenAiAgentStreamMapper {
  private readonly emit: EmitOutput;
  private readonly decorate: (event: StreamEvent) => StreamEvent;
  private finalText = '';
  private readonly activeTools = new Set<string>();
  private readonly outputItemPhases = new Map<string, AssistantMessagePhase>();
  private readonly outputIndexItems = new Map<string, string>();

  constructor(emit: EmitOutput, decorate: (event: StreamEvent) => StreamEvent) {
    this.emit = emit;
    this.decorate = decorate;
  }

  getFinalText(): string {
    return this.finalText;
  }

  process(event: unknown): void {
    const type = (event as { type?: string }).type;
    if (type === 'raw_model_stream_event') {
      this.processRawModelEvent((event as { data?: unknown }).data);
      return;
    }
    if (type !== 'run_item_stream_event') return;

    const name = (event as { name?: string }).name;
    const rawItem = getRawItem(event);
    if (name === 'tool_called') {
      const toolUseId = String(
        rawItem?.callId ?? rawItem?.call_id ?? rawItem?.id ?? '',
      );
      if (toolUseId) this.activeTools.add(toolUseId);
      this.emitStream({
        eventType: 'tool_use_start',
        toolUseId: toolUseId || undefined,
        toolName: String(rawItem?.name ?? rawItem?.type ?? 'tool'),
        toolInputSummary: summarizeUnknown(rawItem?.arguments),
        toolInput:
          typeof rawItem?.arguments === 'string'
            ? parseToolArguments(rawItem.arguments)
            : undefined,
      });
      return;
    }
    if (name === 'tool_output') {
      const toolUseId = String(
        rawItem?.callId ?? rawItem?.call_id ?? rawItem?.id ?? '',
      );
      if (toolUseId) this.activeTools.delete(toolUseId);
      this.emitStream({
        eventType: 'tool_use_end',
        toolUseId: toolUseId || undefined,
        toolName: String(rawItem?.name ?? 'tool'),
        text: summarizeUnknown(
          (event as { item?: { output?: unknown } }).item?.output,
        ),
      });
      return;
    }
    if (name === 'reasoning_item_created') {
      const summary = summarizeUnknown(rawItem?.summary ?? rawItem?.content);
      if (summary) {
        this.emitStream({ eventType: 'thinking_delta', text: summary });
      }
    }
  }

  emitUsageFromResult(
    result: unknown,
    durationMs: number,
    model: string,
  ): void {
    const rawResponses = (result as { rawResponses?: unknown[] }).rawResponses;
    if (!Array.isArray(rawResponses)) return;

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    for (const response of rawResponses) {
      const usage = (response as { usage?: unknown }).usage;
      if (!usage || typeof usage !== 'object') continue;
      const record = usage as Record<string, unknown>;
      inputTokens += getUsageNumber(record, ['inputTokens', 'input_tokens']);
      outputTokens += getUsageNumber(record, ['outputTokens', 'output_tokens']);
      cacheReadInputTokens += getUsageNumber(record, [
        'cachedInputTokens',
        'cache_read_input_tokens',
      ]);
    }
    if (!inputTokens && !outputTokens && !cacheReadInputTokens) return;

    this.emitStream({
      eventType: 'usage',
      usage: {
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens: 0,
        costUSD: 0,
        durationMs,
        numTurns: rawResponses.length,
        modelUsage: {
          [model]: { inputTokens, outputTokens, costUSD: 0 },
        },
      },
    });
  }

  cleanup(): void {
    for (const toolUseId of this.activeTools) {
      this.emitStream({ eventType: 'tool_use_end', toolUseId });
    }
    this.activeTools.clear();
  }

  private processRawModelEvent(data: unknown): void {
    const record =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const type = String(record.type ?? '');
    if (
      type === 'response.output_item.added' ||
      type === 'response.output_item.done'
    ) {
      this.trackOutputItem(record);
      return;
    }

    const delta =
      typeof record.delta === 'string'
        ? record.delta
        : typeof record.text === 'string'
          ? record.text
          : '';
    if (!delta) return;

    if (/reasoning|summary/i.test(type)) {
      this.emitStream({ eventType: 'thinking_delta', text: delta });
      return;
    }
    if (/output_text|text\.delta|message\.delta/i.test(type)) {
      this.finalText += delta;
      const itemId =
        typeof record.item_id === 'string'
          ? record.item_id
          : this.lookupOutputIndexItem(record.output_index);
      const phase = itemId ? this.outputItemPhases.get(itemId) : undefined;
      this.emitStream({
        eventType: 'text_delta',
        text: delta,
        ...(itemId ? { messageUuid: itemId } : {}),
        ...(phase ? { assistantMessagePhase: phase } : {}),
      });
    }
  }

  private trackOutputItem(record: Record<string, unknown>): void {
    const item =
      record.item && typeof record.item === 'object'
        ? (record.item as Record<string, unknown>)
        : null;
    if (!item) return;
    const id = typeof item.id === 'string' ? item.id : null;
    if (!id) return;

    const outputIndexKey = this.normalizeOutputIndex(record.output_index);
    if (outputIndexKey) {
      this.outputIndexItems.set(outputIndexKey, id);
    }

    if (item.type !== 'message' || item.role !== 'assistant') return;
    const phase =
      item.phase === 'commentary' || item.phase === 'final_answer'
        ? item.phase
        : undefined;
    if (phase) {
      this.outputItemPhases.set(id, phase);
    }
  }

  private lookupOutputIndexItem(value: unknown): string | undefined {
    const key = this.normalizeOutputIndex(value);
    return key ? this.outputIndexItems.get(key) : undefined;
  }

  private normalizeOutputIndex(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
    if (typeof value === 'string' && value.trim()) return value.trim();
    return undefined;
  }

  private emitStream(streamEvent: StreamEvent): void {
    this.emit({
      status: 'stream',
      result: null,
      streamEvent: this.decorate(streamEvent),
    });
  }
}

function parseToolArguments(
  value: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
