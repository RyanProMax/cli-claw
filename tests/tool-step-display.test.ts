import { describe, expect, test } from 'vitest';

import { formatToolStepLine } from '../src/tool-step-display.ts';

describe('formatToolStepLine', () => {
  test('prefixes tool names with runclaw-style emoji', () => {
    expect(formatToolStepLine('exec_command')).toBe('💻 exec_command');
  });

  test('uses summary verbs to distinguish common Codex step types', () => {
    expect(formatToolStepLine('tool', 'Read index.ts')).toBe(
      '📖 tool · Read index.ts',
    );
    expect(
      formatToolStepLine('tool', 'Search runtime-identity in index.ts'),
    ).toBe('🔎 tool · Search runtime-identity in index.ts');
    expect(formatToolStepLine('tool', 'Edit src/index.ts')).toBe(
      '✏️ tool · Edit src/index.ts',
    );
  });

  test('uses tool-name verbs when Codex sends the whole step as the name', () => {
    expect(formatToolStepLine('Read SKILL.md')).toBe('📖 Read SKILL.md');
    expect(formatToolStepLine('Search runtime command in src')).toBe(
      '🔎 Search runtime command in src',
    );
    expect(
      formatToolStepLine('Edit /Users/ryan/projects/cli-claw/PLANS/ACTIVE.md'),
    ).toBe('✏️ Edit /Users/ryan/projects/cli-claw/PLANS/ACTIVE.md');
    expect(formatToolStepLine('List /Users/ryan/projects/cli-claw')).toBe(
      '📂 List /Users/ryan/projects/cli-claw',
    );
  });

  test('covers web, plan, input, and command step categories', () => {
    expect(formatToolStepLine('web_search', 'Searching the Web')).toBe(
      '🌐 web_search · Searching the Web',
    );
    expect(formatToolStepLine('todo_write', 'Update plan')).toBe(
      '📋 todo_write · Update plan',
    );
    expect(formatToolStepLine('write_stdin', 'continue')).toBe(
      '⌨️ write_stdin · continue',
    );
    expect(formatToolStepLine('exec_command', 'npm test')).toBe(
      '💻 exec_command · npm test',
    );
  });

  test('appends a compact summary with a middle dot separator', () => {
    expect(formatToolStepLine('write_stdin', 'continue')).toBe(
      '⌨️ write_stdin · continue',
    );
  });

  test('truncates overly long summaries', () => {
    expect(
      formatToolStepLine('exec_command', 'a'.repeat(80), {
        maxSummaryChars: 10,
      }),
    ).toBe('💻 exec_command · aaaaaaaaaa...');
  });

  test('uses a safe default emoji for unknown tools', () => {
    expect(formatToolStepLine('custom_tool')).toBe('🛠️ custom_tool');
  });
});
