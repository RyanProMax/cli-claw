import { describe, expect, test } from 'vitest';

import { TaskCreateSchema } from '../../../src/core/schemas.ts';

describe('task schemas', () => {
  test('accepts workflow scheduled tasks with a workflow id and prompt', () => {
    const result = TaskCreateSchema.safeParse({
      schedule_type: 'interval',
      schedule_value: String(6 * 60 * 60 * 1000),
      execution_type: 'workflow',
      script_command: 'stock-strategy-loop',
      prompt:
        'Review recent stock strategy results and plan the next iteration.',
    });

    expect(result.success).toBe(true);
  });

  test('requires a workflow id for workflow scheduled tasks', () => {
    const result = TaskCreateSchema.safeParse({
      schedule_type: 'interval',
      schedule_value: String(6 * 60 * 60 * 1000),
      execution_type: 'workflow',
      prompt: 'Review recent stock strategy results.',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['script_command'],
      message: 'Workflow 模式下 workflow id 为必填项',
    });
  });
});
