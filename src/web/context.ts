// Shared state and utilities for web server

import { WebSocket } from 'ws';
import type {
  AccessSession,
  NewMessage,
  MessageCursor,
  RegisteredGroup,
} from '../domain/types.js';
import { GroupQueue } from '../agent/queue/group-queue.js';
import { getAccessSession } from '../storage/access.js';

export interface WsClientInfo {
  sessionId: string;
}

export interface WebDeps {
  queue: GroupQueue;
  getRegisteredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  processGroupMessages: (chatJid: string) => Promise<boolean>;
  formatMessages: (messages: NewMessage[], isShared?: boolean) => string;
  getLastAgentTimestamp: () => Record<string, MessageCursor>;
  advanceAcceptedCursor: (jid: string, cursor: MessageCursor) => void;
  setLastAgentTimestamp: (jid: string, cursor: MessageCursor) => void;
  advanceGlobalCursor: (cursor: MessageCursor) => void;
  reloadFeishuConnection?: (config: {
    appId: string;
    appSecret: string;
    enabled?: boolean;
  }) => Promise<boolean>;
  reloadUserIMConfig?: (channel: 'feishu' | 'wechat') => Promise<boolean>;
  isFeishuConnected?: () => boolean;
  isWeChatConnected?: () => boolean;
  processAgentConversation?: (
    chatJid: string,
    agentId: string,
  ) => Promise<void>;
  getFeishuChatInfo?: (chatId: string) => Promise<{
    avatar?: string;
    name?: string;
    user_count?: string;
    chat_type?: string;
    chat_mode?: string;
  } | null>;
  clearImFailCounts?: (jid: string) => void;
  updateReplyRoute?: (
    folder: string,
    sourceJid: string | null,
    lifecycleMessages?: NewMessage[],
  ) => void;
  shouldBypassActiveRuntimeIpc?: (input: {
    chatJid: string;
    groupFolder: string;
    messages: Array<Pick<NewMessage, 'id' | 'timestamp' | 'source_kind'>>;
  }) => {
    bypass: boolean;
    reason?:
      | 'assistant_prompt_turn'
      | 'assistant_prompt_polluted_session'
      | null;
    ignoredSessionId?: string | null;
  };
  triggerTaskRun?: (taskId: string) => { success: boolean; error?: string };
  handleSpawnCommand?: (
    chatJid: string,
    message: string,
    sourceImJid?: string,
  ) => Promise<string>;
  handleWorkflowCommand?: (
    chatJid: string,
    argsText: string,
    initialInput?: Record<string, unknown>,
    lifecycle?: {
      background?: boolean;
      onBackgroundResult?: (message: string) => Promise<void> | void;
    },
  ) => Promise<string>;
}

export type Variables = {
  sessionId: string;
};

let deps: WebDeps | null = null;
export const wsClients = new Map<WebSocket, WsClientInfo>();
export const MAX_GROUP_NAME_LEN = 40;

export function setWebDeps(d: WebDeps): void {
  deps = d;
}
export function getWebDeps(): WebDeps | null {
  return deps;
}

// lastActiveCache - 5 min debounce for session activity tracking
export const lastActiveCache = new Map<string, number>();
export const LAST_ACTIVE_DEBOUNCE_MS = 5 * 60 * 1000;
const LAST_ACTIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const lastActiveCleanupTimer = setInterval(
  () => {
    const cutoff = Date.now() - LAST_ACTIVE_CACHE_TTL_MS;
    for (const [sessionId, touchedAt] of lastActiveCache.entries()) {
      if (touchedAt < cutoff) lastActiveCache.delete(sessionId);
    }
  },
  60 * 60 * 1000,
);
lastActiveCleanupTimer.unref?.();

// Session data cache - 30s TTL, avoids DB query on every request.
const SESSION_CACHE_TTL_MS = 30 * 1000;
const sessionCache = new Map<string, { data: AccessSession; expiry: number }>();

export function getCachedAccessSession(
  sessionId: string,
): AccessSession | undefined {
  const cached = sessionCache.get(sessionId);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  sessionCache.delete(sessionId);
  const data = getAccessSession(sessionId);
  if (data) {
    sessionCache.set(sessionId, {
      data,
      expiry: Date.now() + SESSION_CACHE_TTL_MS,
    });
  }
  return data;
}

export function invalidateSessionCache(sessionId: string): void {
  sessionCache.delete(sessionId);
  lastActiveCache.delete(sessionId);
}

export function invalidateAllSessionCaches(): void {
  sessionCache.clear();
  lastActiveCache.clear();
}

const sessionCacheCleanupTimer = setInterval(
  () => {
    const now = Date.now();
    for (const [sid, entry] of sessionCache.entries()) {
      if (entry.expiry < now) sessionCache.delete(sid);
    }
  },
  5 * 60 * 1000,
);
sessionCacheCleanupTimer.unref?.();

// Cookie parser - used by middleware and WebSocket
export function parseCookie(
  cookieHeader: string | undefined,
): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const cookie of cookieHeader.split(';')) {
    const pair = cookie.trim();
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

export function canAccessGroup(): boolean {
  return true;
}

export function canModifyGroup(): boolean {
  return true;
}

export function canManageGroupMembers(): boolean {
  return false;
}

export function canDeleteGroup(
  _group?: RegisteredGroup & { jid: string },
): boolean {
  return true;
}
