import { Hono } from 'hono';

import type { Variables } from '../context.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthUser } from '../../domain/types.js';
import { canAccessGroup, getWebDeps } from '../context.js';
import { getRegisteredGroup, getRouterState } from '../../storage/db.js';
import { getSystemSettings } from '../../core/runtime/config.js';
import { logger } from '../../core/logger.js';

const monitorRoutes = new Hono<{ Variables: Variables }>();

// GET /api/health - 健康检查（无认证）
monitorRoutes.get('/health', async (c) => {
  const checks = {
    database: false,
    queue: false,
    uptime: 0,
  };

  let healthy = true;

  try {
    getRouterState('last_timestamp');
    checks.database = true;
  } catch (err) {
    healthy = false;
    logger.warn({ err }, '健康检查：数据库连接失败');
  }

  try {
    const deps = getWebDeps();
    if (deps?.queue) {
      checks.queue = true;
    } else {
      healthy = false;
    }
  } catch (err) {
    healthy = false;
    logger.warn({ err }, '健康检查：队列不可用');
  }

  checks.uptime = Math.floor(process.uptime());

  return c.json(
    { status: healthy ? 'healthy' : 'unhealthy', checks },
    healthy ? 200 : 503,
  );
});

// GET /api/status - 获取系统状态
monitorRoutes.get('/status', authMiddleware, async (c) => {
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not initialized' }, 500);

  const authUser = c.get('user') as AuthUser;
  const isAdmin = authUser.role === 'admin';
  const queueStatus = deps.queue.getStatus();

  const filteredGroups = isAdmin
    ? queueStatus.groups
    : queueStatus.groups.filter((g) => {
        const group = getRegisteredGroup(g.jid);
        if (!group) return false;
        return canAccessGroup({ id: authUser.id, role: authUser.role }, group);
      });

  const activeProcesses = isAdmin
    ? queueStatus.activeProcessCount
    : filteredGroups.filter((g) => g.active).length;
  const queueLength = isAdmin
    ? queueStatus.waitingCount
    : queueStatus.waitingGroupJids.filter((jid) => {
        const group = getRegisteredGroup(jid);
        if (!group) return false;
        return canAccessGroup({ id: authUser.id, role: authUser.role }, group);
      }).length;

  return c.json({
    activeProcesses,
    activeTotal: isAdmin ? queueStatus.activeCount : activeProcesses,
    maxConcurrentProcesses: isAdmin
      ? getSystemSettings().maxConcurrentProcesses
      : undefined,
    queueLength,
    uptime: Math.floor(process.uptime()),
    groups: filteredGroups,
  });
});

export default monitorRoutes;
