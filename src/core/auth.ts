import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

// --- Password hashing ---

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// --- Session token generation ---

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateUserId(): string {
  return crypto.randomUUID();
}

export function generateInviteCode(): string {
  return crypto.randomBytes(16).toString('hex');
}

// --- Input validation ---

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export function validateUsername(username: string): string | null {
  if (!username || typeof username !== 'string') return '用户名不能为空';
  if (!USERNAME_RE.test(username)) return '用户名须为3-32位字母、数字或下划线';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password || typeof password !== 'string') return '密码不能为空';
  if (password.length < PASSWORD_MIN)
    return `密码长度不能少于${PASSWORD_MIN}位`;
  if (password.length > PASSWORD_MAX)
    return `密码长度不能超过${PASSWORD_MAX}位`;
  return null;
}

// --- Login rate limiting ---

interface AttemptRecord {
  count: number;
  firstAttempt: number;
  lastAttempt: number;
}

const loginAttempts = new Map<string, AttemptRecord>();

// Sliding window: clean old entries every 10 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, record] of loginAttempts) {
      // Remove entries older than lockout period * 2
      if (now - record.lastAttempt > 30 * 60 * 1000) {
        loginAttempts.delete(key);
      }
    }
  },
  10 * 60 * 1000,
);

export function checkLoginRateLimit(
  username: string,
  ip: string,
  maxAttempts: number,
  lockoutMinutes: number,
): { allowed: boolean; retryAfterSeconds?: number } {
  const key = `${username}:${ip}`;
  const now = Date.now();
  const windowMs = lockoutMinutes * 60 * 1000;

  const record = loginAttempts.get(key);
  if (!record) return { allowed: true };

  // Reset if window has passed since first attempt
  if (now - record.firstAttempt > windowMs) {
    loginAttempts.delete(key);
    return { allowed: true };
  }

  if (record.count >= maxAttempts) {
    const retryAfter = Math.ceil((record.firstAttempt + windowMs - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  return { allowed: true };
}

export function recordLoginAttempt(username: string, ip: string): void {
  const key = `${username}:${ip}`;
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (record) {
    record.count += 1;
    record.lastAttempt = now;
  } else {
    loginAttempts.set(key, { count: 1, firstAttempt: now, lastAttempt: now });
  }
}

export function clearLoginAttempts(username: string, ip: string): void {
  loginAttempts.delete(`${username}:${ip}`);
}

// --- Session expiry ---

export function sessionExpiresAt(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

export function isSessionExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}
