import { Hono } from 'hono';

import { getRunningTaskIds } from '../../agent/scheduler/index.js';
import type { AuthUser, RegisteredGroup } from '../../domain/types.js';
import {
  getAllRegisteredGroups,
  getAllTasks,
  getTaskRunLogsForTaskIdsInRange,
  listWorkflowRunsForDashboard,
  listWorkflowRunStepsForRunIds,
} from '../../storage/db.js';
import { buildWorkflowDashboardData } from '../workflow-dashboard.js';
import { canAccessGroup } from '../context.js';
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

function userCanSeeGroup(
  user: AuthUser,
  group: (RegisteredGroup & { jid: string }) | undefined,
): group is RegisteredGroup & { jid: string } {
  if (!group) return user.role === 'admin';
  if (user.role === 'admin') return true;
  return canAccessGroup({ id: user.id, role: user.role }, group);
}

workflowRoutes.get('/dashboard', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const allGroups = getAllRegisteredGroups();
  const window = resolveWorkflowDashboardDayWindow({
    dateParam: c.req.query('date'),
    timezoneOffsetMinutes: c.req.query('tzOffsetMinutes'),
  });
  const isAdmin = authUser.role === 'admin';
  const visibleFolders = new Set(
    Object.entries(allGroups)
      .map(([jid, group]) => ({ ...group, jid }))
      .filter((group) => userCanSeeGroup(authUser, group))
      .map((group) => group.folder),
  );
  const folderFilter = isAdmin ? undefined : [...visibleFolders].sort();

  const scheduledTasks = getAllTasks().filter((task) =>
    userCanSeeGroup(
      authUser,
      allGroups[task.chat_jid]
        ? { ...allGroups[task.chat_jid], jid: task.chat_jid }
        : undefined,
    ),
  );
  const workflowTaskIds = scheduledTasks
    .filter((task) => task.execution_type === 'workflow')
    .map((task) => task.id);
  const rawRuns = listWorkflowRunsForDashboard({
    folders: folderFilter,
    start: window.dayStart,
    end: window.dayEnd,
  });
  const workflowRuns = isAdmin
    ? rawRuns
    : rawRuns.filter((run) => visibleFolders.has(run.folder));
  const workflowSteps = listWorkflowRunStepsForRunIds(
    workflowRuns.map((run) => run.id),
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
    workflowRuns,
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
