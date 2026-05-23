// Single-instance authentication routes

import { Hono } from 'hono';
import type { Variables } from '../context.js';
import { authMiddleware } from '../middleware/auth.js';
import { getClientIp } from '../../core/utils.js';
import {
  getAppearanceConfig,
  getFeishuProviderConfigWithSource,
  getSystemSettings,
} from '../../core/runtime/config.js';
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  generateSessionToken,
  hashPassword,
  recordLoginAttempt,
  sessionExpiresAt,
  validatePassword,
  verifyPassword,
} from '../../core/auth.js';
import {
  createAccessSession,
  deleteAccessSession,
  deleteAllAccessSessions,
  getAccessPasswordHash,
  isAccessConfigured,
  setAccessPasswordHash,
} from '../../storage/access.js';
import {
  SESSION_COOKIE_NAME_PLAIN,
  SESSION_COOKIE_NAME_SECURE,
  TRUST_PROXY,
} from '../../core/config.js';
import {
  invalidateAllSessionCaches,
  invalidateSessionCache,
} from '../context.js';

const authRoutes = new Hono<{ Variables: Variables }>();
const RATE_LIMIT_KEY = 'instance';

function isSecureRequest(c: any): boolean {
  if (TRUST_PROXY) {
    const proto = c.req.header('x-forwarded-proto');
    if (proto === 'https') return true;
  }
  try {
    const url = new URL(c.req.url, 'http://localhost');
    if (url.protocol === 'https:') return true;
  } catch {
    // ignore
  }
  return false;
}

function getSessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_NAME_SECURE : SESSION_COOKIE_NAME_PLAIN;
}

export function setSessionCookie(c: any, token: string): string {
  const secure = isSecureRequest(c);
  const name = getSessionCookieName(secure);
  const secureSuffix = secure ? '; Secure' : '';
  return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}${secureSuffix}`;
}

export function clearSessionCookie(c: any): string {
  const secure = isSecureRequest(c);
  const name = getSessionCookieName(secure);
  const secureSuffix = secure ? '; Secure' : '';
  return `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureSuffix}`;
}

function buildSetupStatus() {
  const { source: feishuSource } = getFeishuProviderConfigWithSource();
  return {
    needsSetup: false,
    codexConfigured: true,
    feishuConfigured: feishuSource !== 'none',
  };
}

function successResponse(c: any, status = 200): Response {
  const token = generateSessionToken();
  const now = new Date().toISOString();
  createAccessSession({
    id: token,
    ip_address: getClientIp(c),
    user_agent: c.req.header('user-agent') || null,
    created_at: now,
    expires_at: sessionExpiresAt(),
    last_active_at: now,
  });

  return new Response(
    JSON.stringify({
      success: true,
      authenticated: true,
      appearance: getAppearanceConfig(),
      setupStatus: buildSetupStatus(),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': setSessionCookie(c, token),
      },
    },
  );
}

authRoutes.get('/status', (c) => {
  return c.json({ initialized: isAccessConfigured() });
});

authRoutes.post('/setup', async (c) => {
  if (isAccessConfigured()) {
    return c.json({ error: 'System already initialized' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  const passwordError = validatePassword(password);
  if (passwordError) return c.json({ error: passwordError }, 400);

  const passwordHash = await hashPassword(password);
  setAccessPasswordHash(passwordHash);
  return successResponse(c, 201);
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) return c.json({ error: 'Invalid credentials' }, 401);

  const ip = getClientIp(c);
  const { maxLoginAttempts, loginLockoutMinutes } = getSystemSettings();
  const rateCheck = checkLoginRateLimit(
    RATE_LIMIT_KEY,
    ip,
    maxLoginAttempts,
    loginLockoutMinutes,
  );
  if (!rateCheck.allowed) {
    return c.json(
      {
        error: `Too many login attempts. Try again in ${rateCheck.retryAfterSeconds}s`,
      },
      429,
    );
  }

  const hash = getAccessPasswordHash();
  const dummyHash =
    '$2b$12$GBXvNon/zJbUI4jtleGnP.YX03zXP5eSXjppo7a3vyWEUK/2YwdP.';
  const passwordMatch = await verifyPassword(password, hash ?? dummyHash).catch(
    () => false,
  );

  if (!hash || !passwordMatch) {
    recordLoginAttempt(RATE_LIMIT_KEY, ip);
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  clearLoginAttempts(RATE_LIMIT_KEY, ip);
  return successResponse(c);
});

authRoutes.post('/logout', authMiddleware, (c) => {
  const sessionId = c.get('sessionId');
  deleteAccessSession(sessionId);
  invalidateSessionCache(sessionId);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(c),
    },
  });
});

authRoutes.get('/me', authMiddleware, (c) => {
  return c.json({
    authenticated: true,
    appearance: getAppearanceConfig(),
    setupStatus: buildSetupStatus(),
  });
});

authRoutes.put('/password', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const currentPassword =
    typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword =
    typeof body.new_password === 'string' ? body.new_password : '';
  const hash = getAccessPasswordHash();

  if (!hash || !(await verifyPassword(currentPassword, hash))) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }
  if (currentPassword === newPassword) {
    return c.json(
      { error: 'New password must be different from current password' },
      400,
    );
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) return c.json({ error: passwordError }, 400);

  setAccessPasswordHash(await hashPassword(newPassword));
  deleteAllAccessSessions();
  invalidateAllSessionCaches();
  return successResponse(c);
});

export default authRoutes;
