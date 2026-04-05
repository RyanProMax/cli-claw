import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createRuntimeBuildStatus,
  getRuntimeBuildArtifactPaths,
  readBuildFingerprint,
} from '../src/runtime-build.js';

const ORIGINAL_CWD = process.cwd();
const tempDirs: string[] = [];
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('runtime build status', () => {
  test('resolves artifact paths from the installed module root instead of launch cwd', async () => {
    const launchCwd = makeTempDir('cli-claw-runtime-build-');
    process.chdir(launchCwd);
    vi.resetModules();

    const runtimeBuild = await import('../src/runtime-build.js');

    expect(runtimeBuild.getRuntimeBuildArtifactPaths()).toEqual({
      backendBuildPath: path.join(REPO_ROOT, 'dist', 'index.js'),
      backendPackagePath: path.join(REPO_ROOT, 'package.json'),
      agentRunnerBuildPath: path.join(
        REPO_ROOT,
        'container',
        'agent-runner',
        'dist',
        'index.js',
      ),
      agentRunnerPackagePath: path.join(
        REPO_ROOT,
        'container',
        'agent-runner',
        'package.json',
      ),
    });
  });

  test('returns not stale when startup fingerprint matches current files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-build-'));
    const backendPath = path.join(tempDir, 'backend.js');
    const runnerPath = path.join(tempDir, 'agent-runner.js');
    fs.writeFileSync(backendPath, 'backend');
    fs.writeFileSync(runnerPath, 'runner');

    const snapshot = {
      pid: 1234,
      startedAt: '2026-04-04T10:00:00.000Z',
      backend: readBuildFingerprint(backendPath, '1.0.0'),
      agentRunner: readBuildFingerprint(runnerPath, '1.0.0'),
    };

    const status = createRuntimeBuildStatus(snapshot, {
      backend: readBuildFingerprint(backendPath, '1.0.0'),
      agentRunner: readBuildFingerprint(runnerPath, '1.0.0'),
    });

    expect(status.stale).toBe(false);
    expect(status.backend.stale).toBe(false);
    expect(status.agentRunner.stale).toBe(false);
  });

  test('returns stale when backend fingerprint changes', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-build-'));
    const backendPath = path.join(tempDir, 'backend.js');
    const runnerPath = path.join(tempDir, 'agent-runner.js');
    fs.writeFileSync(backendPath, 'backend');
    fs.writeFileSync(runnerPath, 'runner');

    const snapshot = {
      pid: 1234,
      startedAt: '2026-04-04T10:00:00.000Z',
      backend: readBuildFingerprint(backendPath, '1.0.0'),
      agentRunner: readBuildFingerprint(runnerPath, '1.0.0'),
    };

    const backendStat = fs.statSync(backendPath);
    fs.utimesSync(
      backendPath,
      backendStat.atime,
      new Date(backendStat.mtimeMs + 10_000),
    );

    const status = createRuntimeBuildStatus(snapshot, {
      backend: readBuildFingerprint(backendPath, '1.0.0'),
      agentRunner: readBuildFingerprint(runnerPath, '1.0.0'),
    });

    expect(status.stale).toBe(true);
    expect(status.backend.stale).toBe(true);
    expect(status.agentRunner.stale).toBe(false);
  });

  test('returns stale when agent-runner fingerprint changes', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-build-'));
    const backendPath = path.join(tempDir, 'backend.js');
    const runnerPath = path.join(tempDir, 'agent-runner.js');
    fs.writeFileSync(backendPath, 'backend');
    fs.writeFileSync(runnerPath, 'runner');

    const snapshot = {
      pid: 1234,
      startedAt: '2026-04-04T10:00:00.000Z',
      backend: readBuildFingerprint(backendPath, '1.0.0'),
      agentRunner: readBuildFingerprint(runnerPath, '1.0.0'),
    };

    const runnerStat = fs.statSync(runnerPath);
    fs.utimesSync(
      runnerPath,
      runnerStat.atime,
      new Date(runnerStat.mtimeMs + 10_000),
    );

    const status = createRuntimeBuildStatus(snapshot, {
      backend: readBuildFingerprint(backendPath, '1.0.0'),
      agentRunner: readBuildFingerprint(runnerPath, '1.0.0'),
    });

    expect(status.stale).toBe(true);
    expect(status.backend.stale).toBe(false);
    expect(status.agentRunner.stale).toBe(true);
  });
});
