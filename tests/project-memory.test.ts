import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  AGENT_MEMORY_FILENAME,
  LEGACY_AGENT_MEMORY_FILENAME,
  getAgentMemoryPath,
  getPreferredAgentMemoryPath,
  migrateLegacyAgentMemoryFile,
} from '../src/project-memory.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-memory-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('project memory helpers', () => {
  test('uses AGENTS.md as the default memory file name', () => {
    const dir = createTempDir();

    expect(AGENT_MEMORY_FILENAME).toBe('AGENTS.md');
    expect(LEGACY_AGENT_MEMORY_FILENAME).toBe('CLAUDE.md');
    expect(getAgentMemoryPath(dir)).toBe(path.join(dir, 'AGENTS.md'));
    expect(getPreferredAgentMemoryPath(dir)).toBe(path.join(dir, 'AGENTS.md'));
  });

  test('migrates legacy CLAUDE.md when AGENTS.md is missing', () => {
    const dir = createTempDir();
    const legacyPath = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(legacyPath, '# legacy memory\n', 'utf-8');

    const result = migrateLegacyAgentMemoryFile(dir);

    expect(result).toEqual({
      migrated: true,
      path: path.join(dir, 'AGENTS.md'),
    });
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toBe(
      '# legacy memory\n',
    );
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(getPreferredAgentMemoryPath(dir)).toBe(path.join(dir, 'AGENTS.md'));
  });

  test('prefers AGENTS.md when both new and legacy files exist', () => {
    const dir = createTempDir();
    const agentsPath = path.join(dir, 'AGENTS.md');
    const legacyPath = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(agentsPath, '# new memory\n', 'utf-8');
    fs.writeFileSync(legacyPath, '# old memory\n', 'utf-8');

    const result = migrateLegacyAgentMemoryFile(dir);

    expect(result).toEqual({
      migrated: false,
      path: agentsPath,
    });
    expect(getPreferredAgentMemoryPath(dir)).toBe(agentsPath);
    expect(fs.readFileSync(agentsPath, 'utf-8')).toBe('# new memory\n');
    expect(fs.readFileSync(legacyPath, 'utf-8')).toBe('# old memory\n');
  });
});
