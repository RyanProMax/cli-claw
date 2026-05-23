// Single-instance session middleware

import {
  LAST_ACTIVE_DEBOUNCE_MS,
  getCachedAccessSession,
  invalidateSessionCache,
  lastActiveCache,
  parseCookie,
} from '../context.js';
import {
  deleteAccessSession,
  updateAccessSessionLastActive,
} from '../../storage/access.js';
import { isSessionExpired } from '../../core/auth.js';
import {
  SESSION_COOKIE_NAME_PLAIN,
  SESSION_COOKIE_NAME_SECURE,
} from '../../core/config.js';

export const authMiddleware = async (c: any, next: any) => {
  const cookies = parseCookie(c.req.header('cookie'));
  const token =
    cookies[SESSION_COOKIE_NAME_SECURE] || cookies[SESSION_COOKIE_NAME_PLAIN];
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const session = getCachedAccessSession(token);
  if (!session) {
    invalidateSessionCache(token);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (isSessionExpired(session.expires_at)) {
    deleteAccessSession(token);
    invalidateSessionCache(token);
    return c.json({ error: 'Session expired' }, 401);
  }

  c.set('sessionId', token);

  const now = Date.now();
  const lastUpdate = lastActiveCache.get(token) || 0;
  if (now - lastUpdate > LAST_ACTIVE_DEBOUNCE_MS) {
    lastActiveCache.set(token, now);
    try {
      updateAccessSessionLastActive(token);
    } catch {
      // best effort
    }
  }

  await next();
};
