// Workflow schedule routes

import { Hono } from 'hono';
import * as crypto from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import type { Variables } from '../context.js';
import { authMiddleware } from '../middleware/auth.js';
import { TaskCreateSchema, TaskPatchSchema } from '../../core/schemas.js';
import {
  createTask,
  deleteTask,
  getAllTasks,
  getTaskById,
  getTaskRunLogs,
  updateTask,
} from '../../storage/scheduler.js';
import { getRegisteredGroup } from '../../storage/workspaces.js';
import { TIMEZONE } from '../../core/config.js';
import { getWebDeps } from '../context.js';
import { getRunningTaskIds } from '../../agent/scheduler/index.js';

const tasksRoutes = new Hono<{ Variables: Variables }>();

function resolveNextRun(
  scheduleType: 'cron' | 'interval' | 'once',
  scheduleValue: string,
): string {
  if (scheduleType === 'cron') {
    const next = CronExpressionParser.parse(scheduleValue, { tz: TIMEZONE })
      .next()
      .toISOString();
    if (!next) throw new Error('Invalid cron schedule');
    return next;
  }
  if (scheduleType === 'interval') {
    const ms = parseInt(scheduleValue, 10);
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error('Invalid interval value');
    }
    return new Date(Date.now() + ms).toISOString();
  }
  const ts = Date.parse(scheduleValue);
  if (Number.isNaN(ts)) {
    throw new Error('Invalid once schedule value');
  }
  return new Date(ts).toISOString();
}

tasksRoutes.get('/', authMiddleware, (c) => {
  const tasks = getAllTasks().filter(
    (task) => task.execution_type === 'workflow',
  );
  const visibleTaskIds = new Set(tasks.map((task) => task.id));
  const runningTaskIds = getRunningTaskIds().filter((id) =>
    visibleTaskIds.has(id),
  );
  return c.json({ tasks, runningTaskIds });
});

tasksRoutes.post('/', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = TaskCreateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const {
    group_folder: groupFolder,
    chat_jid: chatJid,
    prompt,
    schedule_type,
    schedule_value,
    script_command: workflowId,
    notify_channels,
  } = validation.data;

  if (!groupFolder || !chatJid) {
    return c.json({ error: 'group_folder and chat_jid are required' }, 400);
  }
  if (!workflowId?.trim()) {
    return c.json({ error: 'workflow id is required' }, 400);
  }

  const group = getRegisteredGroup(chatJid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  if (group.folder !== groupFolder) {
    return c.json(
      { error: 'group_folder does not match chat_jid group folder' },
      400,
    );
  }

  let nextRun: string;
  try {
    nextRun = resolveNextRun(schedule_type, schedule_value);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Invalid schedule' },
      400,
    );
  }

  const taskId = crypto.randomUUID();
  createTask({
    id: taskId,
    group_folder: groupFolder,
    chat_jid: chatJid,
    prompt: prompt || '',
    schedule_type,
    schedule_value,
    context_mode: 'isolated',
    execution_type: 'workflow',
    script_command: workflowId.trim(),
    next_run: nextRun,
    status: 'active',
    created_at: new Date().toISOString(),
    notify_channels: notify_channels ?? null,
  });

  return c.json({ success: true, taskId });
});

tasksRoutes.patch('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const existing = getTaskById(id);
  if (!existing || existing.execution_type !== 'workflow') {
    return c.json({ error: 'Task not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const validation = TaskPatchSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const patchData = { ...validation.data, execution_type: 'workflow' as const };
  if (
    patchData.schedule_type !== undefined ||
    patchData.schedule_value !== undefined
  ) {
    const scheduleType = patchData.schedule_type ?? existing.schedule_type;
    const scheduleValue = patchData.schedule_value ?? existing.schedule_value;
    try {
      patchData.next_run = resolveNextRun(scheduleType, scheduleValue);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Invalid schedule' },
        400,
      );
    }
  }

  updateTask(id, patchData);
  return c.json({ success: true });
});

tasksRoutes.delete('/:id', authMiddleware, (c) => {
  const id = c.req.param('id');
  const existing = getTaskById(id);
  if (!existing || existing.execution_type !== 'workflow') {
    return c.json({ error: 'Task not found' }, 404);
  }

  deleteTask(id);
  return c.json({ success: true });
});

tasksRoutes.post('/:id/run', authMiddleware, (c) => {
  const id = c.req.param('id');
  const existing = getTaskById(id);
  if (!existing || existing.execution_type !== 'workflow') {
    return c.json({ error: 'Task not found' }, 404);
  }

  const deps = getWebDeps();
  if (!deps?.triggerTaskRun) {
    return c.json({ error: 'Scheduler not available' }, 503);
  }

  const result = deps.triggerTaskRun(id);
  if (!result.success) return c.json({ error: result.error }, 409);

  return c.json({ success: true });
});

tasksRoutes.get('/:id/logs', authMiddleware, (c) => {
  const id = c.req.param('id');
  const existing = getTaskById(id);
  if (!existing || existing.execution_type !== 'workflow') {
    return c.json({ error: 'Task not found' }, 404);
  }

  const limitRaw = parseInt(c.req.query('limit') || '20', 10);
  const limit = Math.min(
    Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : 20,
    200,
  );
  return c.json({ logs: getTaskRunLogs(id, limit) });
});

export default tasksRoutes;
