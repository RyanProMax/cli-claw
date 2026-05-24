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
  current_cadence?: string | null;
  next_cadence?: string | null;
  reason: string;
  evidence_signature: string;
  requires_human: boolean;
  strategy_usability?: StockStrategyUsabilityGate;
}

export type StockStrategyUsabilityStatus = 'passed' | 'failed' | 'unknown';

export interface StockStrategyUsabilityGate {
  status: StockStrategyUsabilityStatus;
  standard_version: string;
  passed_checks: string[];
  failed_checks: string[];
  missing_checks: string[];
  summary: string;
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
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

function normalizeUsabilityStatus(
  value: string,
): StockStrategyUsabilityStatus | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'passed' ||
    normalized === 'failed' ||
    normalized === 'unknown'
  ) {
    return normalized;
  }
  return null;
}

function normalizeUsabilityGate(
  value: unknown,
): StockStrategyUsabilityGate | undefined {
  if (isRecord(value)) {
    const status = normalizeUsabilityStatus(readString(value.status));
    if (!status) return undefined;
    return {
      status,
      standard_version:
        readString(value.standard_version) || 'stock_strategy_usability_v1',
      passed_checks: readStringArray(value.passed_checks),
      failed_checks: readStringArray(value.failed_checks),
      missing_checks: readStringArray(value.missing_checks),
      summary: readString(value.summary),
    };
  }
  if (value === true) {
    return {
      status: 'passed',
      standard_version: 'stock_strategy_usability_v1',
      passed_checks: [],
      failed_checks: [],
      missing_checks: [],
      summary: '',
    };
  }
  if (value === false) {
    return {
      status: 'failed',
      standard_version: 'stock_strategy_usability_v1',
      passed_checks: [],
      failed_checks: [],
      missing_checks: [],
      summary: '',
    };
  }
  return undefined;
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
  const strategyUsability =
    normalizeUsabilityGate(value.strategy_usability) ??
    normalizeUsabilityGate(value.usability_gate) ??
    normalizeUsabilityGate(value.strategy_usable);

  const decision: StockStrategyPlannerDecision = {
    action,
    next_workflow: readString(value.next_workflow) || null,
    cadence: readString(value.cadence) || null,
    reason: readString(value.reason),
    evidence_signature: readString(value.evidence_signature),
    requires_human: readBoolean(value.requires_human),
  };
  const currentCadence =
    readString(value.current_cadence) || readString(value.orchestrator_cadence);
  const nextCadence =
    readString(value.next_cadence) || readString(value.workflow_cadence);
  if (currentCadence) decision.current_cadence = currentCadence;
  if (nextCadence) decision.next_cadence = nextCadence;
  if (strategyUsability) decision.strategy_usability = strategyUsability;
  return decision;
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
