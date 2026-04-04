import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  AGENT_MEMORY_FILENAME,
  AGENT_MEMORY_TEMPLATE_FILENAME,
  getAgentMemoryPath,
} from '../src/project-memory.js';

describe('project memory helpers', () => {
  test('uses AGENTS.md as the only runtime memory filename', () => {
    expect(AGENT_MEMORY_FILENAME).toBe('AGENTS.md');
    expect(AGENT_MEMORY_TEMPLATE_FILENAME).toBe('global-agents-md.template.md');
  });

  test('builds the AGENTS.md path inside a target directory', () => {
    expect(getAgentMemoryPath('/tmp/workspace')).toBe(
      path.join('/tmp/workspace', 'AGENTS.md'),
    );
  });
});
