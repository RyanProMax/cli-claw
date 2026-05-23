import { Hono } from 'hono';

import { getRunningTaskIds } from '../../agent/scheduler/index.js';
import {
  getAllTasks,
  getTaskRunLogsForTaskIdsInRange,
} from '../../storage/scheduler.js';
import {
  listWorkflowRunsForDashboard,
  listWorkflowRunStepsForRunIds,
} from '../../storage/workflows.js';
import { buildWorkflowDashboardData } from '../workflow-dashboard.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Variables } from '../context.js';

const workflowRoutes = new Hono<{ Variables: Variables }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseTimezoneOffsetMinutes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return new Date().getTimezoneOffset();
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return new Date().getTimezoneOffset();
  return Math.max(-14 * 60, Math.min(14 * 60, Math.trunc(parsed)));
}

function dateFromNowWithOffset(now: Date, offsetMinutes: number): string {
  const localLike = new Date(now.getTime() - offsetMinutes * 60_000);
  return localLike.toISOString().slice(0, 10);
}

export function resolveWorkflowDashboardDayWindow(options: {
  dateParam?: string;
  timezoneOffsetMinutes?: string;
  now?: Date;
}): {
  date: string;
  dayStart: string;
  dayEnd: string;
  timezoneOffsetMinutes: number;
} {
  const offset = parseTimezoneOffsetMinutes(options.timezoneOffsetMinutes);
  const now = options.now ?? new Date();
  const date =
    options.dateParam && DATE_RE.test(options.dateParam)
      ? options.dateParam
      : dateFromNowWithOffset(now, offset);
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const startMs = Date.UTC(year, month - 1, day) + offset * 60_000;
  const endMs = Date.UTC(year, month - 1, day + 1) + offset * 60_000;
  return {
    date,
    dayStart: new Date(startMs).toISOString(),
    dayEnd: new Date(endMs).toISOString(),
    timezoneOffsetMinutes: offset,
  };
}

workflowRoutes.get('/dashboard', authMiddleware, (c) => {
  const window = resolveWorkflowDashboardDayWindow({
    dateParam: c.req.query('date'),
    timezoneOffsetMinutes: c.req.query('tzOffsetMinutes'),
  });
  const scheduledTasks = getAllTasks().filter(
    (task) => task.execution_type === 'workflow',
  );
  const workflowTaskIds = scheduledTasks.map((task) => task.id);
  const rawRuns = listWorkflowRunsForDashboard({
    start: window.dayStart,
    end: window.dayEnd,
  });
  const workflowSteps = listWorkflowRunStepsForRunIds(
    rawRuns.map((run) => run.id),
  );
  const taskRunLogs = getTaskRunLogsForTaskIdsInRange(
    workflowTaskIds,
    window.dayStart,
    window.dayEnd,
  );

  const dashboard = buildWorkflowDashboardData({
    dayStart: window.dayStart,
    dayEnd: window.dayEnd,
    generatedAt: new Date().toISOString(),
    runningTaskIds: getRunningTaskIds(),
    workflowRuns: rawRuns,
    workflowSteps,
    scheduledTasks,
    taskRunLogs,
  });

  return c.json({
    ...dashboard,
    date: window.date,
    timezoneOffsetMinutes: window.timezoneOffsetMinutes,
  });
});

export default workflowRoutes;
