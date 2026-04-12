import { describe, expect, test } from 'vitest';

import { formatToolStepLine } from '../src/tool-step-display.ts';

describe('formatToolStepLine', () => {
  test('prefixes tool names with runclaw-style emoji', () => {
    expect(formatToolStepLine('exec_command')).toBe('💻 exec_command');
  });

  test('appends a compact summary with a middle dot separator', () => {
    expect(formatToolStepLine('write_stdin', 'continue')).toBe(
      '⌨️ write_stdin · continue',
    );
  });

  test('truncates overly long summaries', () => {
    expect(
      formatToolStepLine('exec_command', 'a'.repeat(80), { maxSummaryChars: 10 }),
    ).toBe('💻 exec_command · aaaaaaaaaa...');
  });

  test('uses a safe default emoji for unknown tools', () => {
    expect(formatToolStepLine('custom_tool')).toBe('🛠️ custom_tool');
  });
});
