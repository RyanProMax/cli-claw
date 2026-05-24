export type StockStrategySchedulerAction =
  | 'continue'
  | 'pause'
  | 'pause_discovery'
  | 'slow_down'
  | 'switch_workflow'
  | 'ask_human';

export interface StockStrategyPlannerDecision {
  action: StockStrategySchedulerAction;
  next_workflow: string | null;
  cadence: string | null;
  reason: string;
  evidence_signature: string;
  requires_human: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeAction(value: string): StockStrategySchedulerAction | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'continue' ||
    normalized === 'pause' ||
    normalized === 'pause_discovery' ||
    normalized === 'slow_down' ||
    normalized === 'switch_workflow' ||
    normalized === 'ask_human'
  ) {
    return normalized;
  }
  return null;
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonObjectLike(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidates = [fenced?.[1] ?? trimmed];
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of candidates) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeDecision(
  value: Record<string, unknown>,
): StockStrategyPlannerDecision | null {
  const action = normalizeAction(readString(value.action));
  if (!action) return null;

  return {
    action,
    next_workflow: readString(value.next_workflow) || null,
    cadence: readString(value.cadence) || null,
    reason: readString(value.reason),
    evidence_signature: readString(value.evidence_signature),
    requires_human: readBoolean(value.requires_human),
  };
}

export function parseStockStrategyPlannerDecision(
  result: string | null | undefined,
): StockStrategyPlannerDecision | null {
  if (!result) return null;
  const parsed = parseJsonObjectLike(result);
  if (!parsed) return null;

  const direct = normalizeDecision(parsed);
  if (direct) return direct;

  if (isRecord(parsed.scheduler_decision)) {
    return normalizeDecision(parsed.scheduler_decision);
  }
  if (isRecord(parsed.decision)) {
    return normalizeDecision(parsed.decision);
  }
  return null;
}

export function parseCadenceToIntervalMs(
  cadence: string | null | undefined,
): number | null {
  const value = cadence?.trim().toLowerCase();
  if (!value) return null;
  if (value === 'manual' || value === '手动') return null;

  const match = value.match(
    /^(\d+(?:\.\d+)?)\s*(ms|msec|s|sec|m|min|分钟|h|hr|hour|hours|小时|d|day|days|天)?$/i,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2] ?? 'ms';
  if (unit === 'ms' || unit === 'msec') return Math.round(amount);
  if (unit === 's' || unit === 'sec') return Math.round(amount * 1000);
  if (unit === 'm' || unit === 'min' || unit === '分钟') {
    return Math.round(amount * 60 * 1000);
  }
  if (
    unit === 'h' ||
    unit === 'hr' ||
    unit === 'hour' ||
    unit === 'hours' ||
    unit === '小时'
  ) {
    return Math.round(amount * 60 * 60 * 1000);
  }
  if (unit === 'd' || unit === 'day' || unit === 'days' || unit === '天') {
    return Math.round(amount * 24 * 60 * 60 * 1000);
  }
  return null;
}
