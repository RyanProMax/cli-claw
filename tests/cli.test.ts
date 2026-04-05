import { describe, expect, test, vi } from 'vitest';

import {
  formatHelpText,
  parseCliArgs,
  runCli,
} from '../src/cli.js';

describe('parseCliArgs', () => {
  test('recognizes start, help, and version entry points', () => {
    expect(parseCliArgs([])).toEqual({ command: 'help' });
    expect(parseCliArgs(['start'])).toEqual({ command: 'start' });
    expect(parseCliArgs(['help'])).toEqual({ command: 'help' });
    expect(parseCliArgs(['version'])).toEqual({ command: 'version' });
  });

  test('recognizes help and version flags', () => {
    expect(parseCliArgs(['-h'])).toEqual({ command: 'help' });
    expect(parseCliArgs(['--help'])).toEqual({ command: 'help' });
    expect(parseCliArgs(['-v'])).toEqual({ command: 'version' });
    expect(parseCliArgs(['--version'])).toEqual({ command: 'version' });
  });
});

describe('runCli', () => {
  test('dispatches start to the backend seam', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['start'], {
      start,
      stdout,
      stderr,
      version: '1.2.3',
    });

    expect(exitCode).toBe(0);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  test('prints stable help text', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['help'], {
      start: vi.fn(),
      stdout,
      stderr,
      version: '1.2.3',
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(formatHelpText('1.2.3'));
    expect(stderr).not.toHaveBeenCalled();
  });

  test('prints the version string for version commands', async () => {
    const stdout = vi.fn();

    const exitCode = await runCli(['--version'], {
      start: vi.fn(),
      stdout,
      stderr: vi.fn(),
      version: '1.2.3',
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith('1.2.3');
  });
});
