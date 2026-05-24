import { create } from 'zustand';
import { api } from '../api/client';
import { extractErrorMessage } from '../utils/error';

export type WorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped';

export interface WorkflowDashboardStepSummary {
  total: number;
  pending: number;
  running: number;
  success: number;
  error: number;
  skipped: number;
}

export interface WorkflowDashboardRunSourceTask {
  id: string;
  prompt: string;
  workflowId: string | null;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  status: 'active' | 'paused' | 'completed' | 'parsing';
  nextRun: string | null;
}

export interface WorkflowDashboardRunStep {
  id: string;
  nodeId: string;
  roleId: string | null;
  status: WorkflowStepStatus;
  attempt: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface WorkflowDashboardRun {
  id: string;
  folder: string;
  workflowId: string;
  prompt: string;
  status: WorkflowRunStatus;
  error: string | null;
  resultPreview: string | null;
  sourceTask: WorkflowDashboardRunSourceTask | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  stepSummary: WorkflowDashboardStepSummary;
  steps: WorkflowDashboardRunStep[];
}

export interface WorkflowDashboardScheduledTask {
  id: string;
  groupFolder: string;
  chatJid: string;
  prompt: string;
  workflowId: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  status: 'active' | 'paused' | 'completed' | 'parsing';
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
  running: boolean;
  todayRunCount: number;
  todayErrorCount: number;
  todaySuccessCount: number;
  todayLastLogStatus: 'running' | 'success' | 'error' | null;
  todayLastLogAt: string | null;
}

export interface WorkflowDashboardSummary {
  totalRuns: number;
  queuedRuns: number;
  runningRuns: number;
  successRuns: number;
  errorRuns: number;
  cancelledRuns: number;
  scheduledWorkflowTasks: number;
  runningScheduledTasks: number;
  completedTaskRuns: number;
  failedTaskRuns: number;
}

export type WorkflowDashboardStockStrategyState =
  | 'discovering'
  | 'validating'
  | 'blocked'
  | 'cooldown'
  | 'human_review_ready'
  | 'approved'
  | 'rejected';

export interface WorkflowDashboardStockStrategyDecision {
  action:
    | 'continue'
    | 'pause'
    | 'pause_discovery'
    | 'slow_down'
    | 'switch_workflow'
    | 'ask_human';
  nextWorkflow: string | null;
  cadence: string | null;
  reason: string;
  evidenceSignature: string;
  requiresHuman: boolean;
  workflowId: string;
  updatedAt: string;
}

export interface WorkflowDashboardStockStrategyMarket {
  market: 'US' | 'HK' | 'CN';
  state: WorkflowDashboardStockStrategyState;
  source: 'planner_decision' | 'local_artifact' | 'scheduled_task';
  workflowId: string | null;
  action: WorkflowDashboardStockStrategyDecision['action'] | null;
  nextWorkflow: string | null;
  cadence: string | null;
  reason: string | null;
  evidenceSignature: string | null;
  requiresHuman: boolean;
  updatedAt: string | null;
}

export interface WorkflowDashboardStockStrategy {
  workspaceJid: 'web:stock-strategy';
  workspaceFolder: 'stock-strategy';
  globalDecision: WorkflowDashboardStockStrategyDecision | null;
  markets: WorkflowDashboardStockStrategyMarket[];
}

export interface WorkflowDashboardData {
  dayStart: string;
  dayEnd: string;
  generatedAt: string;
  date: string;
  timezoneOffsetMinutes: number;
  summary: WorkflowDashboardSummary;
  runningRuns: WorkflowDashboardRun[];
  todayRuns: WorkflowDashboardRun[];
  scheduledTasks: WorkflowDashboardScheduledTask[];
  stockStrategy: WorkflowDashboardStockStrategy | null;
}

interface WorkflowsState {
  dashboard: WorkflowDashboardData | null;
  loading: boolean;
  error: string | null;
  loadDashboard: (date: string) => Promise<void>;
}

function timezoneOffsetMinutes(): number {
  return new Date().getTimezoneOffset();
}

export const useWorkflowsStore = create<WorkflowsState>((set) => ({
  dashboard: null,
  loading: false,
  error: null,

  loadDashboard: async (date: string) => {
    set({ loading: true });
    try {
      const params = new URLSearchParams({
        date,
        tzOffsetMinutes: String(timezoneOffsetMinutes()),
      });
      const dashboard = await api.get<WorkflowDashboardData>(
        `/api/workflows/dashboard?${params.toString()}`,
      );
      set({ dashboard, loading: false, error: null });
    } catch (err) {
      set({
        loading: false,
        error: extractErrorMessage(err),
      });
    }
  },
}));
