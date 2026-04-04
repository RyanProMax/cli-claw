import fs from 'node:fs';
import path from 'node:path';

export const AGENT_MEMORY_FILENAME = 'AGENTS.md';
export const LEGACY_AGENT_MEMORY_FILENAME = 'CLAUDE.md';
export const AGENT_MEMORY_TEMPLATE_FILENAME = 'global-agents-md.template.md';

export function getAgentMemoryPath(dir: string): string {
  return path.join(dir, AGENT_MEMORY_FILENAME);
}

export function getLegacyAgentMemoryPath(dir: string): string {
  return path.join(dir, LEGACY_AGENT_MEMORY_FILENAME);
}

export function getPreferredAgentMemoryPath(dir: string): string {
  const nextPath = getAgentMemoryPath(dir);
  if (fs.existsSync(nextPath)) return nextPath;

  const legacyPath = getLegacyAgentMemoryPath(dir);
  if (fs.existsSync(legacyPath)) return legacyPath;

  return nextPath;
}

export function migrateLegacyAgentMemoryFile(dir: string): {
  migrated: boolean;
  path: string;
} {
  const nextPath = getAgentMemoryPath(dir);
  if (fs.existsSync(nextPath)) {
    return { migrated: false, path: nextPath };
  }

  const legacyPath = getLegacyAgentMemoryPath(dir);
  if (!fs.existsSync(legacyPath)) {
    return { migrated: false, path: nextPath };
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(legacyPath, nextPath);
  return { migrated: true, path: nextPath };
}
