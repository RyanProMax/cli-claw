import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR } from '../config.js';
import { logger } from '../logger.js';
export { getOpenAiRuntimeDefaults } from './openai-runtime.js';

const MAX_FIELD_LENGTH = 2000;
const CONFIG_DIR = path.join(DATA_DIR, 'config');
const CONFIG_KEY_FILE = path.join(CONFIG_DIR, 'secrets.key');
const FEISHU_CONFIG_FILE = path.join(CONFIG_DIR, 'feishu-provider.json');
const TELEGRAM_CONFIG_FILE = path.join(CONFIG_DIR, 'telegram-provider.json');
export interface FeishuProviderConfig {
  appId: string;
  appSecret: string;
  enabled?: boolean;
  updatedAt: string | null;
}

export type FeishuConfigSource = 'runtime' | 'env' | 'none';

export interface FeishuProviderPublicConfig {
  appId: string;
  hasAppSecret: boolean;
  appSecretMasked: string | null;
  enabled: boolean;
  updatedAt: string | null;
  source: FeishuConfigSource;
}

export interface TelegramProviderConfig {
  botToken: string;
  proxyUrl?: string;
  enabled?: boolean;
  updatedAt: string | null;
}

export type TelegramConfigSource = 'runtime' | 'env' | 'none';

export interface TelegramProviderPublicConfig {
  hasBotToken: boolean;
  botTokenMasked: string | null;
  proxyUrl: string;
  enabled: boolean;
  updatedAt: string | null;
  source: TelegramConfigSource;
}

interface EncryptedSecrets {
  iv: string;
  tag: string;
  data: string;
}

interface FeishuSecretPayload {
  appSecret: string;
}

interface TelegramSecretPayload {
  botToken: string;
}

interface StoredFeishuProviderConfigV1 {
  version: 1;
  appId: string;
  enabled?: boolean;
  updatedAt: string;
  secret: EncryptedSecrets;
}

interface StoredTelegramProviderConfigV1 {
  version: 1;
  proxyUrl?: string;
  enabled?: boolean;
  updatedAt: string;
  secret: EncryptedSecrets;
}

function normalizeSecret(input: unknown, fieldName: string): string {
  if (typeof input !== 'string') {
    throw new Error(`Invalid field: ${fieldName}`);
  }
  // Strip ALL whitespace and non-ASCII characters — API keys/tokens are always ASCII;
  // users often paste with accidental spaces, line breaks, or smart quotes (e.g. U+2019).
  // eslint-disable-next-line no-control-regex
  const value = input.replace(/\s+/g, '').replace(/[^\x00-\x7F]/g, '');
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error(`Field too long: ${fieldName}`);
  }
  return value;
}

function normalizeFeishuAppId(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Invalid field: appId');
  }
  const value = input.trim();
  if (!value) return '';
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error('Field too long: appId');
  }
  return value;
}

function normalizeTelegramProxyUrl(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input !== 'string') {
    throw new Error('Invalid field: proxyUrl');
  }
  const value = input.trim();
  if (!value) return '';
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error('Field too long: proxyUrl');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid field: proxyUrl');
  }
  const protocol = parsed.protocol.toLowerCase();
  if (!['http:', 'https:', 'socks:', 'socks5:'].includes(protocol)) {
    throw new Error('Invalid field: proxyUrl');
  }
  return value;
}

function getLegacyEncryptionKeyFiles(): string[] {
  try {
    return fs
      .readdirSync(CONFIG_DIR)
      .filter((name) => name.endsWith('-provider.key'))
      .map((name) => path.join(CONFIG_DIR, name));
  } catch {
    return [];
  }
}

function getOrCreateEncryptionKey(): Buffer {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  for (const keyFile of [CONFIG_KEY_FILE, ...getLegacyEncryptionKeyFiles()]) {
    if (!fs.existsSync(keyFile)) continue;
    const raw = fs.readFileSync(keyFile, 'utf-8').trim();
    const key = Buffer.from(raw, 'hex');
    if (key.length !== 32) throw new Error('Invalid encryption key file');
    if (keyFile !== CONFIG_KEY_FILE && !fs.existsSync(CONFIG_KEY_FILE)) {
      fs.writeFileSync(CONFIG_KEY_FILE, raw + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
      });
    }
    return key;
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(CONFIG_KEY_FILE, key.toString('hex') + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return key;
}

function encryptChannelSecret<T>(payload: T): EncryptedSecrets {
  const key = getOrCreateEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptChannelSecret<T>(secrets: EncryptedSecrets): T {
  const key = getOrCreateEncryptionKey();
  const iv = Buffer.from(secrets.iv, 'base64');
  const tag = Buffer.from(secrets.tag, 'base64');
  const encrypted = Buffer.from(secrets.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf-8');
  return JSON.parse(decrypted) as T;
}

function readStoredFeishuConfig(): FeishuProviderConfig | null {
  if (!fs.existsSync(FEISHU_CONFIG_FILE)) return null;
  const content = fs.readFileSync(FEISHU_CONFIG_FILE, 'utf-8');
  const parsed = JSON.parse(content) as Record<string, unknown>;
  if (parsed.version !== 1) return null;

  const stored = parsed as unknown as StoredFeishuProviderConfigV1;
  const secret = decryptChannelSecret<FeishuSecretPayload>(stored.secret);
  return {
    appId: normalizeFeishuAppId(stored.appId ?? ''),
    appSecret: secret.appSecret,
    enabled: stored.enabled,
    updatedAt: stored.updatedAt || null,
  };
}

function defaultsFeishuFromEnv(): FeishuProviderConfig {
  const raw = {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
  };
  return {
    appId: raw.appId.trim(),
    appSecret: raw.appSecret.trim(),
    updatedAt: null,
  };
}

export function getFeishuProviderConfigWithSource(): {
  config: FeishuProviderConfig;
  source: FeishuConfigSource;
} {
  try {
    const stored = readStoredFeishuConfig();
    if (stored) return { config: stored, source: 'runtime' };
  } catch (err) {
    logger.warn(
      { err },
      'Failed to read runtime Feishu config, falling back to env',
    );
  }

  const fromEnv = defaultsFeishuFromEnv();
  if (fromEnv.appId || fromEnv.appSecret) {
    return { config: fromEnv, source: 'env' };
  }

  return { config: fromEnv, source: 'none' };
}

export function getFeishuProviderConfig(): FeishuProviderConfig {
  return getFeishuProviderConfigWithSource().config;
}

export function saveFeishuProviderConfig(
  next: Omit<FeishuProviderConfig, 'updatedAt'>,
): FeishuProviderConfig {
  const normalized: FeishuProviderConfig = {
    appId: normalizeFeishuAppId(next.appId),
    appSecret: normalizeSecret(next.appSecret, 'appSecret'),
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredFeishuProviderConfigV1 = {
    version: 1,
    appId: normalized.appId,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptChannelSecret<FeishuSecretPayload>({
      appSecret: normalized.appSecret,
    }),
  };

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${FEISHU_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, FEISHU_CONFIG_FILE);
  return normalized;
}

export function toPublicFeishuProviderConfig(
  config: FeishuProviderConfig,
  source: FeishuConfigSource,
): FeishuProviderPublicConfig {
  return {
    appId: config.appId,
    hasAppSecret: !!config.appSecret,
    appSecretMasked: maskSecret(config.appSecret),
    enabled: config.enabled !== false,
    updatedAt: config.updatedAt,
    source,
  };
}

// ========== Telegram Provider Config ==========

function readStoredTelegramConfig(): TelegramProviderConfig | null {
  if (!fs.existsSync(TELEGRAM_CONFIG_FILE)) return null;
  const content = fs.readFileSync(TELEGRAM_CONFIG_FILE, 'utf-8');
  const parsed = JSON.parse(content) as Record<string, unknown>;
  if (parsed.version !== 1) return null;

  const stored = parsed as unknown as StoredTelegramProviderConfigV1;
  const secret = decryptChannelSecret<TelegramSecretPayload>(stored.secret);
  return {
    botToken: secret.botToken,
    proxyUrl: normalizeTelegramProxyUrl(stored.proxyUrl ?? ''),
    enabled: stored.enabled,
    updatedAt: stored.updatedAt || null,
  };
}

function defaultsTelegramFromEnv(): TelegramProviderConfig {
  const raw = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    proxyUrl: process.env.TELEGRAM_PROXY_URL || '',
  };
  return {
    botToken: raw.botToken.trim(),
    proxyUrl: normalizeTelegramProxyUrl(raw.proxyUrl),
    updatedAt: null,
  };
}

export function getTelegramProviderConfigWithSource(): {
  config: TelegramProviderConfig;
  source: TelegramConfigSource;
} {
  try {
    const stored = readStoredTelegramConfig();
    if (stored) return { config: stored, source: 'runtime' };
  } catch (err) {
    logger.warn(
      { err },
      'Failed to read runtime Telegram config, falling back to env',
    );
  }

  const fromEnv = defaultsTelegramFromEnv();
  if (fromEnv.botToken) {
    return { config: fromEnv, source: 'env' };
  }

  return { config: fromEnv, source: 'none' };
}

export function getTelegramProviderConfig(): TelegramProviderConfig {
  return getTelegramProviderConfigWithSource().config;
}

export function saveTelegramProviderConfig(
  next: Omit<TelegramProviderConfig, 'updatedAt'>,
): TelegramProviderConfig {
  const normalized: TelegramProviderConfig = {
    botToken: normalizeSecret(next.botToken, 'botToken'),
    proxyUrl: normalizeTelegramProxyUrl(next.proxyUrl),
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredTelegramProviderConfigV1 = {
    version: 1,
    proxyUrl: normalized.proxyUrl,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptChannelSecret<TelegramSecretPayload>({
      botToken: normalized.botToken,
    }),
  };

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${TELEGRAM_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, TELEGRAM_CONFIG_FILE);
  return normalized;
}

export function toPublicTelegramProviderConfig(
  config: TelegramProviderConfig,
  source: TelegramConfigSource,
): TelegramProviderPublicConfig {
  return {
    hasBotToken: !!config.botToken,
    botTokenMasked: maskSecret(config.botToken),
    proxyUrl: config.proxyUrl ?? '',
    enabled: config.enabled !== false,
    updatedAt: config.updatedAt,
    source,
  };
}

function maskSecret(value: string): string | null {
  if (!value) return null;
  if (value.length <= 8)
    return `${'*'.repeat(Math.max(value.length - 2, 1))}${value.slice(-2)}`;
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(value.length - 7, 4))}${value.slice(-4)}`;
}

/** Strip control characters from a value before writing to env file (defense-in-depth) */
function sanitizeEnvValue(value: string): string {
  return value.replace(/[\r\n\0]/g, '');
}

/** Convert KEY=value lines to shell-safe format by single-quoting values.
 *  Used when writing env files that are `source`d by bash. */
export function shellQuoteEnvLines(lines: string[]): string[] {
  return lines.map((line) => {
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) return line;
    const key = line.slice(0, eqIdx);
    const value = line.slice(eqIdx + 1);
    // Escape embedded single quotes: ' → '\''
    const quoted = "'" + value.replace(/'/g, "'\\''") + "'";
    return `${key}=${quoted}`;
  });
}

// ─── Appearance config (plain JSON, no encryption) ────────────────

const APPEARANCE_CONFIG_FILE = path.join(CONFIG_DIR, 'appearance.json');

export interface AppearanceConfig {
  appName: string;
  aiName: string;
  aiAvatarEmoji: string;
  aiAvatarColor: string;
}

const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
  appName: ASSISTANT_NAME,
  aiName: ASSISTANT_NAME,
  aiAvatarEmoji: '\u{1F431}',
  aiAvatarColor: '#0d9488',
};

export function getAppearanceConfig(): AppearanceConfig {
  try {
    if (!fs.existsSync(APPEARANCE_CONFIG_FILE)) {
      return { ...DEFAULT_APPEARANCE_CONFIG };
    }
    const raw = JSON.parse(
      fs.readFileSync(APPEARANCE_CONFIG_FILE, 'utf-8'),
    ) as Record<string, unknown>;
    return {
      appName:
        typeof raw.appName === 'string' && raw.appName
          ? raw.appName
          : DEFAULT_APPEARANCE_CONFIG.appName,
      aiName:
        typeof raw.aiName === 'string' && raw.aiName
          ? raw.aiName
          : DEFAULT_APPEARANCE_CONFIG.aiName,
      aiAvatarEmoji:
        typeof raw.aiAvatarEmoji === 'string' && raw.aiAvatarEmoji
          ? raw.aiAvatarEmoji
          : DEFAULT_APPEARANCE_CONFIG.aiAvatarEmoji,
      aiAvatarColor:
        typeof raw.aiAvatarColor === 'string' && raw.aiAvatarColor
          ? raw.aiAvatarColor
          : DEFAULT_APPEARANCE_CONFIG.aiAvatarColor,
    };
  } catch (err) {
    logger.warn(
      { err },
      'Failed to read appearance config, returning defaults',
    );
    return { ...DEFAULT_APPEARANCE_CONFIG };
  }
}

export function saveAppearanceConfig(
  next: Partial<Pick<AppearanceConfig, 'appName'>> &
    Omit<AppearanceConfig, 'appName'>,
): AppearanceConfig {
  const existing = getAppearanceConfig();
  const config = {
    appName: next.appName || existing.appName,
    aiName: next.aiName,
    aiAvatarEmoji: next.aiAvatarEmoji,
    aiAvatarColor: next.aiAvatarColor,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${APPEARANCE_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, APPEARANCE_CONFIG_FILE);
  return {
    appName: config.appName,
    aiName: config.aiName,
    aiAvatarEmoji: config.aiAvatarEmoji,
    aiAvatarColor: config.aiAvatarColor,
  };
}

// ─── Per-user IM config (AES-256-GCM encrypted) ─────────────────

const USER_IM_CONFIG_DIR = path.join(DATA_DIR, 'config', 'user-im');

export interface UserFeishuConfig {
  appId: string;
  appSecret: string;
  enabled?: boolean;
  updatedAt: string | null;
}

export interface UserTelegramConfig {
  botToken: string;
  proxyUrl?: string;
  enabled?: boolean;
  updatedAt: string | null;
}

export interface UserQQConfig {
  appId: string;
  appSecret: string;
  enabled?: boolean;
  updatedAt: string | null;
}

export interface UserDingTalkConfig {
  clientId: string;
  clientSecret: string;
  enabled?: boolean;
  updatedAt: string | null;
}

interface StoredDingTalkProviderConfigV1 {
  version: 1;
  clientId: string;
  enabled?: boolean;
  updatedAt: string;
  secret: EncryptedSecrets;
}

interface DingTalkSecretPayload {
  clientSecret: string;
}

interface StoredQQProviderConfigV1 {
  version: 1;
  appId: string;
  enabled?: boolean;
  updatedAt: string;
  secret: EncryptedSecrets;
}

interface QQSecretPayload {
  appSecret: string;
}

function userImDir(userId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error('Invalid userId');
  }
  return path.join(USER_IM_CONFIG_DIR, userId);
}

export function getUserFeishuConfig(userId: string): UserFeishuConfig | null {
  const filePath = path.join(userImDir(userId), 'feishu.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.version !== 1) return null;

    const stored = parsed as unknown as StoredFeishuProviderConfigV1;
    const secret = decryptChannelSecret<FeishuSecretPayload>(stored.secret);
    return {
      appId: normalizeFeishuAppId(stored.appId ?? ''),
      appSecret: secret.appSecret,
      enabled: stored.enabled,
      updatedAt: stored.updatedAt || null,
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to read user Feishu config');
    return null;
  }
}

export function saveUserFeishuConfig(
  userId: string,
  next: Omit<UserFeishuConfig, 'updatedAt'>,
): UserFeishuConfig {
  const normalized: UserFeishuConfig = {
    appId: normalizeFeishuAppId(next.appId),
    appSecret: normalizeSecret(next.appSecret, 'appSecret'),
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredFeishuProviderConfigV1 = {
    version: 1,
    appId: normalized.appId,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptChannelSecret<FeishuSecretPayload>({
      appSecret: normalized.appSecret,
    }),
  };

  const dir = userImDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'feishu.json');
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
  return normalized;
}

export function getUserTelegramConfig(
  userId: string,
): UserTelegramConfig | null {
  const filePath = path.join(userImDir(userId), 'telegram.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.version !== 1) return null;

    const stored = parsed as unknown as StoredTelegramProviderConfigV1;
    const secret = decryptChannelSecret<TelegramSecretPayload>(stored.secret);
    return {
      botToken: secret.botToken,
      proxyUrl: normalizeTelegramProxyUrl(stored.proxyUrl ?? ''),
      enabled: stored.enabled,
      updatedAt: stored.updatedAt || null,
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to read user Telegram config');
    return null;
  }
}

export function saveUserTelegramConfig(
  userId: string,
  next: Omit<UserTelegramConfig, 'updatedAt'>,
): UserTelegramConfig {
  const normalizedProxyUrl = next.proxyUrl
    ? normalizeTelegramProxyUrl(next.proxyUrl)
    : '';
  const normalized: UserTelegramConfig = {
    botToken: normalizeSecret(next.botToken, 'botToken'),
    proxyUrl: normalizedProxyUrl || undefined,
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredTelegramProviderConfigV1 = {
    version: 1,
    proxyUrl: normalizedProxyUrl || undefined,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptChannelSecret<TelegramSecretPayload>({
      botToken: normalized.botToken,
    }),
  };

  const dir = userImDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'telegram.json');
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
  return normalized;
}

// ========== QQ User IM Config ==========

export function getUserQQConfig(userId: string): UserQQConfig | null {
  const filePath = path.join(userImDir(userId), 'qq.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.version !== 1) return null;

    const stored = parsed as unknown as StoredQQProviderConfigV1;
    const secret = decryptChannelSecret<QQSecretPayload>(stored.secret);
    return {
      appId: normalizeFeishuAppId(stored.appId ?? ''),
      appSecret: secret.appSecret,
      enabled: stored.enabled,
      updatedAt: stored.updatedAt || null,
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to read user QQ config');
    return null;
  }
}

export function saveUserQQConfig(
  userId: string,
  next: Omit<UserQQConfig, 'updatedAt'>,
): UserQQConfig {
  const normalized: UserQQConfig = {
    appId: normalizeFeishuAppId(next.appId),
    appSecret: normalizeSecret(next.appSecret, 'appSecret'),
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredQQProviderConfigV1 = {
    version: 1,
    appId: normalized.appId,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptChannelSecret<QQSecretPayload>({
      appSecret: normalized.appSecret,
    }),
  };

  const dir = userImDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'qq.json');
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
  return normalized;
}

// ========== WeChat User IM Config ==========

export interface UserWeChatConfig {
  botToken: string; // iLink bot_token
  ilinkBotId: string; // bot ID (xxx@im.bot)
  baseUrl?: string; // 默认 https://ilinkai.weixin.qq.com
  cdnBaseUrl?: string; // 默认 https://novac2c.cdn.weixin.qq.com/c2c
  getUpdatesBuf?: string; // 长轮询游标
  bypassProxy?: boolean; // 直连模式：绕过 HTTP 代理（默认 true）
  enabled?: boolean;
  updatedAt: string | null;
}

interface StoredWeChatProviderConfigV1 {
  version: 1;
  ilinkBotId: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
  getUpdatesBuf?: string;
  bypassProxy?: boolean;
  enabled?: boolean;
  updatedAt: string;
  secret: EncryptedSecrets;
}

interface WeChatSecretPayload {
  botToken: string;
}

export function getUserWeChatConfig(userId: string): UserWeChatConfig | null {
  const filePath = path.join(userImDir(userId), 'wechat.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.version !== 1) return null;

    const stored = parsed as unknown as StoredWeChatProviderConfigV1;
    const secret = decryptChannelSecret<WeChatSecretPayload>(stored.secret);
    return {
      botToken: secret.botToken,
      ilinkBotId: ((stored.ilinkBotId as string) ?? '').trim(),
      baseUrl: stored.baseUrl,
      cdnBaseUrl: stored.cdnBaseUrl,
      getUpdatesBuf: stored.getUpdatesBuf,
      bypassProxy: stored.bypassProxy ?? true, // 默认直连
      enabled: stored.enabled,
      updatedAt: stored.updatedAt || null,
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to read user WeChat config');
    return null;
  }
}

export function saveUserWeChatConfig(
  userId: string,
  next: Omit<UserWeChatConfig, 'updatedAt'>,
): UserWeChatConfig {
  const normalized: UserWeChatConfig = {
    botToken: normalizeSecret(next.botToken, 'botToken'),
    ilinkBotId: (next.ilinkBotId ?? '').trim(),
    baseUrl: next.baseUrl?.trim() || undefined,
    cdnBaseUrl: next.cdnBaseUrl?.trim() || undefined,
    getUpdatesBuf: next.getUpdatesBuf,
    bypassProxy: next.bypassProxy ?? true,
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredWeChatProviderConfigV1 = {
    version: 1,
    ilinkBotId: normalized.ilinkBotId,
    baseUrl: normalized.baseUrl,
    cdnBaseUrl: normalized.cdnBaseUrl,
    getUpdatesBuf: normalized.getUpdatesBuf,
    bypassProxy: normalized.bypassProxy,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptChannelSecret<WeChatSecretPayload>({
      botToken: normalized.botToken,
    }),
  };

  const dir = userImDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'wechat.json');
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
  return normalized;
}

// ========== DingTalk User IM Config ==========

export function getUserDingTalkConfig(
  userId: string,
): UserDingTalkConfig | null {
  const filePath = path.join(userImDir(userId), 'dingtalk.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.version !== 1) return null;

    const stored = parsed as unknown as StoredDingTalkProviderConfigV1;
    const secret = decryptChannelSecret<DingTalkSecretPayload>(stored.secret);
    return {
      clientId: ((stored.clientId as string) ?? '').trim(),
      clientSecret: secret.clientSecret,
      enabled: stored.enabled,
      updatedAt: stored.updatedAt || null,
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to read user DingTalk config');
    return null;
  }
}

export function saveUserDingTalkConfig(
  userId: string,
  next: Omit<UserDingTalkConfig, 'updatedAt'>,
): UserDingTalkConfig {
  const normalized: UserDingTalkConfig = {
    clientId: ((next.clientId as string) ?? '').trim(),
    clientSecret: normalizeSecret(next.clientSecret, 'clientSecret'),
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredDingTalkProviderConfigV1 = {
    version: 1,
    clientId: normalized.clientId,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptChannelSecret<DingTalkSecretPayload>({
      clientSecret: normalized.clientSecret,
    }),
  };

  const dir = userImDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'dingtalk.json');
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
  return normalized;
}

// ─── System settings (plain JSON, no encryption) ─────────────────

const SYSTEM_SETTINGS_FILE = path.join(CONFIG_DIR, 'system-settings.json');

export interface SystemSettings {
  processTimeout: number;
  idleTimeout: number;
  processMaxOutputSize: number;
  maxConcurrentProcesses: number;
  maxLoginAttempts: number;
  loginLockoutMinutes: number;
  maxConcurrentScripts: number;
  scriptTimeout: number;
}

const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  processTimeout: 1800000,
  idleTimeout: 1800000,
  processMaxOutputSize: 10485760,
  maxConcurrentProcesses: 5,
  maxLoginAttempts: 5,
  loginLockoutMinutes: 15,
  maxConcurrentScripts: 10,
  scriptTimeout: 60000,
};

function parseIntEnv(envVar: string | undefined, fallback: number): number {
  if (!envVar) return fallback;
  const parsed = parseInt(envVar, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// In-memory cache: avoid synchronous file I/O on hot paths (stdout data handler, queue capacity check)
let _settingsCache: SystemSettings | null = null;
let _settingsMtimeMs = 0;

function readSystemSettingsFromFile(): SystemSettings | null {
  if (!fs.existsSync(SYSTEM_SETTINGS_FILE)) return null;
  const raw = JSON.parse(
    fs.readFileSync(SYSTEM_SETTINGS_FILE, 'utf-8'),
  ) as Record<string, unknown>;
  return {
    processTimeout:
      typeof raw.processTimeout === 'number' && raw.processTimeout > 0
        ? raw.processTimeout
        : DEFAULT_SYSTEM_SETTINGS.processTimeout,
    idleTimeout:
      typeof raw.idleTimeout === 'number' && raw.idleTimeout > 0
        ? raw.idleTimeout
        : DEFAULT_SYSTEM_SETTINGS.idleTimeout,
    processMaxOutputSize:
      typeof raw.processMaxOutputSize === 'number' &&
      raw.processMaxOutputSize > 0
        ? raw.processMaxOutputSize
        : DEFAULT_SYSTEM_SETTINGS.processMaxOutputSize,
    maxConcurrentProcesses:
      typeof raw.maxConcurrentProcesses === 'number' &&
      raw.maxConcurrentProcesses > 0
        ? raw.maxConcurrentProcesses
        : DEFAULT_SYSTEM_SETTINGS.maxConcurrentProcesses,
    maxLoginAttempts:
      typeof raw.maxLoginAttempts === 'number' && raw.maxLoginAttempts > 0
        ? raw.maxLoginAttempts
        : DEFAULT_SYSTEM_SETTINGS.maxLoginAttempts,
    loginLockoutMinutes:
      typeof raw.loginLockoutMinutes === 'number' && raw.loginLockoutMinutes > 0
        ? raw.loginLockoutMinutes
        : DEFAULT_SYSTEM_SETTINGS.loginLockoutMinutes,
    maxConcurrentScripts:
      typeof raw.maxConcurrentScripts === 'number' &&
      raw.maxConcurrentScripts > 0
        ? raw.maxConcurrentScripts
        : DEFAULT_SYSTEM_SETTINGS.maxConcurrentScripts,
    scriptTimeout:
      typeof raw.scriptTimeout === 'number' && raw.scriptTimeout > 0
        ? raw.scriptTimeout
        : DEFAULT_SYSTEM_SETTINGS.scriptTimeout,
  };
}

function buildEnvFallbackSettings(): SystemSettings {
  return {
    processTimeout: parseIntEnv(
      process.env.PROCESS_TIMEOUT,
      DEFAULT_SYSTEM_SETTINGS.processTimeout,
    ),
    idleTimeout: parseIntEnv(
      process.env.IDLE_TIMEOUT,
      DEFAULT_SYSTEM_SETTINGS.idleTimeout,
    ),
    processMaxOutputSize: parseIntEnv(
      process.env.PROCESS_MAX_OUTPUT_SIZE,
      DEFAULT_SYSTEM_SETTINGS.processMaxOutputSize,
    ),
    maxConcurrentProcesses: parseIntEnv(
      process.env.MAX_CONCURRENT_PROCESSES,
      DEFAULT_SYSTEM_SETTINGS.maxConcurrentProcesses,
    ),
    maxLoginAttempts: parseIntEnv(
      process.env.MAX_LOGIN_ATTEMPTS,
      DEFAULT_SYSTEM_SETTINGS.maxLoginAttempts,
    ),
    loginLockoutMinutes: parseIntEnv(
      process.env.LOGIN_LOCKOUT_MINUTES,
      DEFAULT_SYSTEM_SETTINGS.loginLockoutMinutes,
    ),
    maxConcurrentScripts: parseIntEnv(
      process.env.MAX_CONCURRENT_SCRIPTS,
      DEFAULT_SYSTEM_SETTINGS.maxConcurrentScripts,
    ),
    scriptTimeout: parseIntEnv(
      process.env.SCRIPT_TIMEOUT,
      DEFAULT_SYSTEM_SETTINGS.scriptTimeout,
    ),
  };
}

export function getSystemSettings(): SystemSettings {
  // Fast path: return cached value if file hasn't changed (single stat)
  if (_settingsCache) {
    try {
      const mtimeMs = fs.statSync(SYSTEM_SETTINGS_FILE).mtimeMs;
      if (mtimeMs === _settingsMtimeMs) return _settingsCache;
    } catch {
      return _settingsCache; // file gone or stat failed — cached value is still valid
    }
  }

  // 1. Try reading from file
  try {
    const settings = readSystemSettingsFromFile();
    if (settings) {
      _settingsCache = settings;
      try {
        _settingsMtimeMs = fs.statSync(SYSTEM_SETTINGS_FILE).mtimeMs;
      } catch {
        /* ignore */
      }
      return settings;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(
        { err },
        'Failed to read system settings, falling back to env/defaults',
      );
    }
  }

  // 2. Fall back to env vars, then hardcoded defaults
  const settings = buildEnvFallbackSettings();
  _settingsCache = settings;
  _settingsMtimeMs = 0; // no file — will re-check on next call
  return settings;
}

export function saveSystemSettings(
  partial: Partial<SystemSettings>,
): SystemSettings {
  const existing = getSystemSettings();
  const merged: SystemSettings = { ...existing, ...partial };

  // Range validation
  if (merged.processTimeout < 60000) merged.processTimeout = 60000; // min 1 min
  if (merged.processTimeout > 86400000) merged.processTimeout = 86400000; // max 24 hours
  if (merged.idleTimeout < 60000) merged.idleTimeout = 60000;
  if (merged.idleTimeout > 86400000) merged.idleTimeout = 86400000;
  if (merged.processMaxOutputSize < 1048576)
    merged.processMaxOutputSize = 1048576; // min 1MB
  if (merged.processMaxOutputSize > 104857600)
    merged.processMaxOutputSize = 104857600; // max 100MB
  if (merged.maxConcurrentProcesses < 1) merged.maxConcurrentProcesses = 1;
  if (merged.maxConcurrentProcesses > 50) merged.maxConcurrentProcesses = 50;
  if (merged.maxLoginAttempts < 1) merged.maxLoginAttempts = 1;
  if (merged.maxLoginAttempts > 100) merged.maxLoginAttempts = 100;
  if (merged.loginLockoutMinutes < 1) merged.loginLockoutMinutes = 1;
  if (merged.loginLockoutMinutes > 1440) merged.loginLockoutMinutes = 1440; // max 24 hours
  if (merged.maxConcurrentScripts < 1) merged.maxConcurrentScripts = 1;
  if (merged.maxConcurrentScripts > 50) merged.maxConcurrentScripts = 50;
  if (merged.scriptTimeout < 5000) merged.scriptTimeout = 5000; // min 5s
  if (merged.scriptTimeout > 600000) merged.scriptTimeout = 600000; // max 10 min

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${SYSTEM_SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, SYSTEM_SETTINGS_FILE);

  // Update in-memory cache immediately
  _settingsCache = merged;
  try {
    _settingsMtimeMs = fs.statSync(SYSTEM_SETTINGS_FILE).mtimeMs;
  } catch {
    /* ignore */
  }

  return merged;
}
