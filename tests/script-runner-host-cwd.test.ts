import { describe, expect, test, vi } from 'vitest';

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: execMock,
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../src/runtime-config.js', () => ({
  getSystemSettings: () => ({
    scriptTimeout: 1234,
    maxConcurrentScripts: 8,
  }),
}));

import { runScript } from '../src/script-runner.js';

describe('runScript', () => {
  test('uses the provided host workspace cwd for script execution', async () => {
    execMock.mockImplementationOnce((_command, options, callback) => {
      queueMicrotask(() => callback(null, 'done', ''));
      return { exitCode: 0 };
    });

    const result = await runScript('echo done', 'main', '/srv/project');

    expect(result.exitCode).toBe(0);
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        cwd: '/srv/project',
        env: expect.objectContaining({
          HOME: '/srv/project',
          GROUP_FOLDER: 'main',
        }),
      }),
    );
  });
});
