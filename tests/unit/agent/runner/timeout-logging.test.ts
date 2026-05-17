import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../../../src/core/logger.js', () => ({
  logger: {
    info: hoisted.loggerInfo,
    error: hoisted.loggerError,
  },
}));

import {
  createStderrState,
  createStdoutParserState,
  handleTimeoutClose,
} from '../../../../src/agent/runner/output-parser.ts';

describe('agent timeout logging', () => {
  test('logs controlled agent process timeouts as info instead of error', () => {
    const logsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-timeout-log-'),
    );
    let resolved: any = null;

    const handled = handleTimeoutClose(
      {
        groupName: '飞书私聊',
        label: 'Agent Process',
        filePrefix: 'agent',
        identifier: 'agent-main-1',
        logsDir,
        input: {
          prompt: 'hello',
          isHome: true,
          isAdminHome: true,
        },
        stdoutState: createStdoutParserState(),
        stderrState: createStderrState(),
        onOutput: async () => {},
        resolvePromise: (output) => {
          resolved = output;
        },
        startTime: Date.now(),
        timeoutMs: 1_800_000,
      },
      0,
      3_715_236,
      true,
    );

    expect(handled).toBe(true);
    expect(hoisted.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        group: '飞书私聊',
        processId: 'agent-main-1',
        duration: 3_715_236,
        code: 0,
      }),
      'Agent Process timed out',
    );
    expect(hoisted.loggerError).not.toHaveBeenCalled();
    expect(resolved).toEqual({
      status: 'error',
      result: null,
      error: 'Agent Process timed out after 1800000ms',
    });
  });
});
