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
  current_next_run_at?: string | null;
  next_run_at?: string | null;
  next_workflows?: StockStrategyWorkflowAssignment[];
  reason: string;
  evidence_signature: string;
  requires_human: boolean;
  strategy_usability?: StockStrategyUsabilityGate;
  quality_gate?: StockStrategyQualityGate;
  work_budget?: StockStrategyWorkBudget;
}

export type StockStrategyPlannerDecisionParseErrorCode =
  | 'invalid_json'
  | 'missing_action'
  | 'invalid_action';

export interface StockStrategyPlannerDecisionParseError {
  code: StockStrategyPlannerDecisionParseErrorCode;
  message: string;
  action?: string;
}

export type StockStrategyPlannerDecisionParseResult =
  | { ok: true; decision: StockStrategyPlannerDecision }
  | { ok: false; error: StockStrategyPlannerDecisionParseError };

export type StockStrategyUsabilityStatus = 'passed' | 'failed' | 'unknown';

export interface StockStrategyUsabilityGate {
  status: StockStrategyUsabilityStatus;
  standard_version: string;
  passed_checks: string[];
  failed_checks: string[];
  missing_checks: string[];
  summary: string;
}

export type StockStrategyQualityGateStatus = 'passed' | 'failed' | 'unknown';

export interface StockStrategyQualityGate {
  status: StockStrategyQualityGateStatus;
  standard_version: string;
  stage: string;
  score: number | null;
  passed_checks: string[];
  failed_checks: string[];
  missing_checks: string[];
  defects: string[];
  summary: string;
}

export interface StockStrategyWorkflowAssignment {
  workflow_id: string;
  cadence?: string | null;
  next_run_at?: string | null;
  priority?: string | null;
  reason?: string | null;
  prompt?: string | null;
  quality_gate?: string | StockStrategyQualityGate | null;
}

export interface StockStrategyWorkBudget {
  max_runtime_minutes?: number | null;
  max_retries?: number | null;
  max_cost_usd?: number | null;
  priority?: string | null;
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

function readNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeQualityGateStatus(
  value: string,
): StockStrategyQualityGateStatus | null {
  return normalizeUsabilityStatus(value);
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

function normalizeQualityGate(
  value: unknown,
): StockStrategyQualityGate | undefined {
  if (isRecord(value)) {
    const status = normalizeQualityGateStatus(readString(value.status));
    if (!status) return undefined;
    return {
      status,
      standard_version:
        readString(value.standard_version) || 'stock_strategy_quality_gate_v1',
      stage: readString(value.stage),
      score: readNumber(value.score),
      passed_checks: readStringArray(value.passed_checks),
      failed_checks: readStringArray(value.failed_checks),
      missing_checks: readStringArray(value.missing_checks),
      defects: readStringArray(value.defects),
      summary: readString(value.summary),
    };
  }
  if (value === true) {
    return {
      status: 'passed',
      standard_version: 'stock_strategy_quality_gate_v1',
      stage: '',
      score: null,
      passed_checks: [],
      failed_checks: [],
      missing_checks: [],
      defects: [],
      summary: '',
    };
  }
  if (value === false) {
    return {
      status: 'failed',
      standard_version: 'stock_strategy_quality_gate_v1',
      stage: '',
      score: null,
      passed_checks: [],
      failed_checks: [],
      missing_checks: [],
      defects: [],
      summary: '',
    };
  }
  return undefined;
}

function normalizeAssignmentQualityGate(
  value: unknown,
): string | StockStrategyQualityGate | null | undefined {
  const label = readString(value);
  if (label) return label;
  const gate = normalizeQualityGate(value);
  return gate ?? undefined;
}

function normalizeWorkflowAssignment(
  value: unknown,
): StockStrategyWorkflowAssignment | null {
  if (!isRecord(value)) return null;
  const workflowId =
    readString(value.workflow_id) || readString(value.workflowId);
  if (!workflowId) return null;
  const assignment: StockStrategyWorkflowAssignment = {
    workflow_id: workflowId,
  };
  const cadence = readString(value.cadence);
  const nextRunAt =
    readString(value.next_run_at) || readString(value.nextRunAt);
  const priority = readString(value.priority);
  const reason = readString(value.reason);
  const prompt = readString(value.prompt);
  const qualityGate = normalizeAssignmentQualityGate(value.quality_gate);
  if (cadence) assignment.cadence = cadence;
  if (nextRunAt) assignment.next_run_at = nextRunAt;
  if (priority) assignment.priority = priority;
  if (reason) assignment.reason = reason;
  if (prompt) assignment.prompt = prompt;
  if (qualityGate !== undefined) assignment.quality_gate = qualityGate;
  return assignment;
}

function normalizeWorkflowAssignments(
  value: unknown,
): StockStrategyWorkflowAssignment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const assignments = value
    .map(normalizeWorkflowAssignment)
    .filter(
      (assignment): assignment is StockStrategyWorkflowAssignment =>
        assignment !== null,
    );
  return assignments.length > 0 ? assignments : undefined;
}

function normalizeWorkBudget(
  value: unknown,
): StockStrategyWorkBudget | undefined {
  if (!isRecord(value)) return undefined;
  const budget: StockStrategyWorkBudget = {};
  const maxRuntimeMinutes = readNumber(value.max_runtime_minutes);
  const maxRetries = readNumber(value.max_retries);
  const maxCostUsd = readNumber(value.max_cost_usd);
  const priority = readString(value.priority);
  if (maxRuntimeMinutes !== null) {
    budget.max_runtime_minutes = maxRuntimeMinutes;
  }
  if (maxRetries !== null) budget.max_retries = maxRetries;
  if (maxCostUsd !== null) budget.max_cost_usd = maxCostUsd;
  if (priority) budget.priority = priority;
  return Object.keys(budget).length > 0 ? budget : undefined;
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
  const qualityGate = normalizeQualityGate(value.quality_gate);
  const nextWorkflows = normalizeWorkflowAssignments(value.next_workflows);
  const workBudget = normalizeWorkBudget(value.work_budget);

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
  const currentNextRunAt =
    readString(value.current_next_run_at) ||
    readString(value.orchestrator_next_run_at);
  const nextRunAt = readString(value.next_run_at);
  if (currentCadence) decision.current_cadence = currentCadence;
  if (nextCadence) decision.next_cadence = nextCadence;
  if (currentNextRunAt) decision.current_next_run_at = currentNextRunAt;
  if (nextRunAt) decision.next_run_at = nextRunAt;
  if (nextWorkflows) decision.next_workflows = nextWorkflows;
  if (strategyUsability) decision.strategy_usability = strategyUsability;
  if (qualityGate) decision.quality_gate = qualityGate;
  if (workBudget) decision.work_budget = workBudget;
  return decision;
}

function normalizeDecisionResult(
  value: Record<string, unknown>,
): StockStrategyPlannerDecisionParseResult {
  const rawAction = readString(value.action);
  if (!rawAction) {
    return {
      ok: false,
      error: {
        code: 'missing_action',
        message: 'Missing stock strategy scheduler action',
      },
    };
  }
  const action = normalizeAction(rawAction);
  if (!action) {
    return {
      ok: false,
      error: {
        code: 'invalid_action',
        message: `Invalid stock strategy scheduler action: ${rawAction}`,
        action: rawAction,
      },
    };
  }
  const decision = normalizeDecision(value);
  if (!decision) {
    return {
      ok: false,
      error: {
        code: 'missing_action',
        message: 'Missing stock strategy scheduler action',
      },
    };
  }
  return { ok: true, decision };
}

export function parseStockStrategyPlannerDecision(
  result: string | null | undefined,
): StockStrategyPlannerDecision | null {
  const parsed = parseStockStrategyPlannerDecisionResult(result);
  return parsed.ok ? parsed.decision : null;
}

export function parseStockStrategyPlannerDecisionResult(
  result: string | null | undefined,
): StockStrategyPlannerDecisionParseResult {
  if (!result) {
    return {
      ok: false,
      error: {
        code: 'invalid_json',
        message: 'Stock strategy scheduler decision JSON is empty',
      },
    };
  }
  const parsed = parseJsonObjectLike(result);
  if (!parsed) {
    return {
      ok: false,
      error: {
        code: 'invalid_json',
        message: 'Stock strategy scheduler decision JSON was not found',
      },
    };
  }

  const direct = normalizeDecisionResult(parsed);
  if (direct.ok || direct.error.code === 'invalid_action') return direct;

  if (isRecord(parsed.scheduler_decision)) {
    return normalizeDecisionResult(parsed.scheduler_decision);
  }
  if (isRecord(parsed.decision)) {
    return normalizeDecisionResult(parsed.decision);
  }
  return direct;
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
