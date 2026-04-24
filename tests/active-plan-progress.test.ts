import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';

import {
  appendActivePlanProgressLine,
  appendActivePlanProgressFromFile,
  formatActivePlanProgressLine,
  shouldAppendActivePlanProgress,
} from '../src/active-plan-progress.ts';

const samplePlan = `# Sample Plan

## Milestones

### Milestone 1

Status:
- done

### Milestone 2

Status:
- done

### Milestone 3

Status:
- in_progress
`;

describe('active plan progress', () => {
  test('formats milestone progress with completed items checked', () => {
    expect(formatActivePlanProgressLine(samplePlan)).toBe(
      '进度: ✓ Milestone 1 · ✓ Milestone 2 · … Milestone 3',
    );
  });

  test('appends progress line only once', () => {
    const first = appendActivePlanProgressLine('Final answer', samplePlan);

    expect(first).toBe(
      'Final answer\n\n进度: ✓ Milestone 1 · ✓ Milestone 2 · … Milestone 3',
    );
    expect(appendActivePlanProgressLine(first, samplePlan)).toBe(first);
  });

  test('only task-like assistant messages require active plan progress', () => {
    expect(shouldAppendActivePlanProgress('sdk_final')).toBe(true);
    expect(shouldAppendActivePlanProgress('interrupt_partial')).toBe(true);
    expect(shouldAppendActivePlanProgress('auto_continue')).toBe(true);
    expect(shouldAppendActivePlanProgress('user_command')).toBe(false);
    expect(shouldAppendActivePlanProgress('scheduled_task_prompt')).toBe(false);
    expect(shouldAppendActivePlanProgress(null)).toBe(false);
  });

  test('reads progress from the explicit active plan path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-plan-'));
    const planPath = path.join(tempDir, 'ACTIVE.md');
    fs.writeFileSync(planPath, samplePlan, 'utf8');

    expect(
      appendActivePlanProgressFromFile('Final answer', 'sdk_final', planPath),
    ).toBe('Final answer\n\n进度: ✓ Milestone 1 · ✓ Milestone 2 · … Milestone 3');
  });
});
