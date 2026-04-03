// Utility functions

import fs from 'fs';
import path from 'path';

import { DATA_DIR, TRUST_PROXY } from './config.js';

/**
 * Strip agent-internal XML tags from output text.
 * Removes `<internal>...</internal>` and `<process>...</process>` blocks
 * that the agent uses for internal reasoning / process tracking.
 */
export function stripAgentInternalTags(text: string): string {
  return text
    .replace(/<internal>[\s\S]*?<\/internal>/g, '')
    .replace(/<process>[\s\S]*?<\/process>/g, '')
    .trim();
}

/**
 * Detect whether an agent output is system-maintenance noise that should
 * be suppressed from IM delivery when sourceKind is 'auto_continue'.
 *
 * These are short acknowledgements that the agent generates when its session
 * transcript contains memory-flush / CLAUDE.md-update context from the
 * compaction pipeline (issue #275). Substantive user-facing continuations
 * (task resumption, actual replies) are NOT noise and must pass through.
 *
 * Heuristic: text is "noise" if it is short (<= 30 chars) AND matches a
 * known system-acknowledgement pattern after normalisation.
 */
const NOISE_PATTERNS = [
  /^ok[.。!！]?$/,
  /^好的[.。!！]?$/,
  /^已更新/,
  /^已完成/,
  /^已刷新/,
  /^记忆已/,
  /^claude\.md\s*已/,
  /^memory\s*(flush|updated)/i,
];

export function isSystemMaintenanceNoise(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length > 30) return false;
  return NOISE_PATTERNS.some((p) => p.test(normalized));
}

/**
 * Strip virtual JID suffixes (#task:xxx, #agent:xxx) to get the base JID.
 */
export function stripVirtualJidSuffix(jid: string): string {
  const taskSep = jid.indexOf('#task:');
  if (taskSep >= 0) return jid.slice(0, taskSep);
  const agentSep = jid.indexOf('#agent:');
  if (agentSep >= 0) return jid.slice(0, agentSep);
  return jid;
}

export function getClientIp(c: any): string {
  if (TRUST_PROXY) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      const firstIp = xff.split(',')[0]?.trim();
      if (firstIp) return firstIp;
    }
    const realIp = c.req.header('x-real-ip');
    if (realIp) return realIp;
  }
  // Fallback: connection remote address (Hono + Node.js adapter)
  // Hono Node.js adapter 将 IncomingMessage 存于 c.env.incoming
  const connInfo =
    c.env?.incoming?.socket?.remoteAddress ||
    c.env?.remoteAddr ||
    c.req.raw?.socket?.remoteAddress;
  return connInfo || 'unknown';
}

/** Create IPC + session directories for an agent. */
export function ensureAgentDirectories(
  folder: string,
  agentId: string,
): string {
  const agentIpcDir = path.join(DATA_DIR, 'ipc', folder, 'agents', agentId);
  fs.mkdirSync(path.join(agentIpcDir, 'input'), { recursive: true });
  fs.mkdirSync(path.join(agentIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(agentIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(
    path.join(DATA_DIR, 'sessions', folder, 'agents', agentId, '.claude'),
    { recursive: true },
  );
  return agentIpcDir;
}
