import { describe, expect, test } from 'vitest';

import { formatToolStepLine } from '../src/tool-step-display.ts';

describe('formatToolStepLine', () => {
  test('renders plain tool names without status icon, backticks, or timing', () => {
    expect(formatToolStepLine('exec_command')).toBe('exec_command');
  });

  test('appends a compact summary with a middle dot separator', () => {
    expect(formatToolStepLine('write_stdin', 'continue')).toBe(
      'write_stdin · continue',
    );
  });

  test('truncates overly long summaries', () => {
    expect(
      formatToolStepLine('exec_command', 'a'.repeat(80), { maxSummaryChars: 10 }),
    ).toBe('exec_command · aaaaaaaaaa...');
  });
});
