import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  formatHelpText,
  isExecutedAsCliEntry,
  parseCliArgs,
  runCli,
} from '../../../src/cli.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseCliArgs', () => {
  test('recognizes start, restart, help, and version entry points', () => {
    expect(parseCliArgs([])).toEqual({ command: 'help' });
    expect(parseCliArgs(['start'])).toEqual({ command: 'start' });
    expect(parseCliArgs(['restart'])).toEqual({ command: 'restart' });
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
    const originalArgv = process.argv;
    process.argv = ['/usr/local/bin/node', '/repo/dist/cli.js', 'start'];

    try {
      const exitCode = await runCli(['start'], {
        start,
        stdout,
        stderr,
        version: '1.2.3',
      });

      expect(exitCode).toBe(0);
      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith({
        startupLaunchSpec: expect.objectContaining({
          command: process.execPath,
          args: ['/repo/dist/cli.js', 'start'],
          source: 'cli_start',
          restartable: true,
        }),
      });
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      process.argv = originalArgv;
    }
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

  test('dispatches restart to the external self-restart seam', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const restart = vi.fn(() => ({
      status: 'accepted' as const,
      message: 'Self-restart requested: /tmp/restart-abc.json',
    }));

    const exitCode = await runCli(['restart'], {
      start: vi.fn(),
      restart,
      stdout,
      stderr,
      version: '1.2.3',
    });

    expect(exitCode).toBe(0);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(
      'Self-restart requested: /tmp/restart-abc.json',
    );
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('isExecutedAsCliEntry', () => {
  test('treats symlinked launcher paths as the same entry module', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-cli-test-'));
    tempDirs.push(tempDir);

    const entryPath = path.join(tempDir, 'dist', 'cli.js');
    const launcherPath = path.join(tempDir, 'bin', 'cli-claw');

    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
    fs.writeFileSync(entryPath, '#!/usr/bin/env node\n');
    fs.symlinkSync(entryPath, launcherPath);

    expect(
      isExecutedAsCliEntry(launcherPath, pathToFileURL(entryPath).href),
    ).toBe(true);
  });

  test('rejects unrelated launchers', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-cli-test-'));
    tempDirs.push(tempDir);

    const entryPath = path.join(tempDir, 'dist', 'cli.js');
    const otherPath = path.join(tempDir, 'bin', 'other-cli');

    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.mkdirSync(path.dirname(otherPath), { recursive: true });
    fs.writeFileSync(entryPath, '#!/usr/bin/env node\n');
    fs.writeFileSync(otherPath, '#!/usr/bin/env node\n');

    expect(
      isExecutedAsCliEntry(otherPath, pathToFileURL(entryPath).href),
    ).toBe(false);
  });
});
