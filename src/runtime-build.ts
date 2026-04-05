import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from './app-root.js';

export interface BuildFingerprint {
  path: string;
  version: string | null;
  exists: boolean;
  mtimeMs: number | null;
  mtimeIso: string | null;
}

export interface RuntimeBuildSnapshot {
  pid: number;
  startedAt: string;
  backend: BuildFingerprint;
  agentRunner: BuildFingerprint;
}

export interface RuntimeBuildArtifactStatus {
  loaded: BuildFingerprint;
  current: BuildFingerprint;
  stale: boolean;
}

export interface RuntimeBuildStatus {
  pid: number;
  startedAt: string;
  backend: RuntimeBuildArtifactStatus;
  agentRunner: RuntimeBuildArtifactStatus;
  stale: boolean;
}

export interface RuntimeBuildLogFields {
  staleBuild: boolean;
  backendPid: number;
  backendStartedAt: string;
  backendBuildLoaded: string;
  backendBuildCurrent: string;
  backendBuildStale: boolean;
  agentRunnerBuildLoaded: string;
  agentRunnerBuildCurrent: string;
  agentRunnerBuildStale: boolean;
}

export interface RuntimeBuildArtifactPaths {
  backendBuildPath: string;
  backendPackagePath: string;
  agentRunnerBuildPath: string;
  agentRunnerPackagePath: string;
}

export function getRuntimeBuildArtifactPaths(
  appRoot: string = APP_ROOT,
): RuntimeBuildArtifactPaths {
  return {
    backendBuildPath: path.resolve(appRoot, 'dist', 'index.js'),
    backendPackagePath: path.resolve(appRoot, 'package.json'),
    agentRunnerBuildPath: path.resolve(
      appRoot,
      'container',
      'agent-runner',
      'dist',
      'index.js',
    ),
    agentRunnerPackagePath: path.resolve(
      appRoot,
      'container',
      'agent-runner',
      'package.json',
    ),
  };
}

function readPackageVersion(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      version?: unknown;
    };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

export function readBuildFingerprint(
  filePath: string,
  version: string | null = null,
): BuildFingerprint {
  const resolvedPath = path.resolve(filePath);
  try {
    const stat = fs.statSync(resolvedPath);
    return {
      path: resolvedPath,
      version,
      exists: true,
      mtimeMs: stat.mtimeMs,
      mtimeIso: stat.mtime.toISOString(),
    };
  } catch {
    return {
      path: resolvedPath,
      version,
      exists: false,
      mtimeMs: null,
      mtimeIso: null,
    };
  }
}

export function isBuildFingerprintStale(
  loaded: BuildFingerprint,
  current: BuildFingerprint,
): boolean {
  return (
    loaded.path !== current.path ||
    loaded.exists !== current.exists ||
    loaded.mtimeMs !== current.mtimeMs
  );
}

export function formatBuildFingerprintForLog(
  fingerprint: BuildFingerprint,
): string {
  const version = fingerprint.version || 'unknown';
  const mtime = fingerprint.mtimeIso || 'missing';
  const suffix = fingerprint.exists ? `mtime=${mtime}` : 'missing';
  return `${version} @ ${fingerprint.path} (${suffix})`;
}

export function createRuntimeBuildSnapshot(): RuntimeBuildSnapshot {
  const artifactPaths = getRuntimeBuildArtifactPaths();
  return {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    backend: readBuildFingerprint(
      artifactPaths.backendBuildPath,
      readPackageVersion(artifactPaths.backendPackagePath),
    ),
    agentRunner: readBuildFingerprint(
      artifactPaths.agentRunnerBuildPath,
      readPackageVersion(artifactPaths.agentRunnerPackagePath),
    ),
  };
}

export function createRuntimeBuildStatus(
  snapshot: RuntimeBuildSnapshot,
  current: {
    backend?: BuildFingerprint;
    agentRunner?: BuildFingerprint;
  } = {},
): RuntimeBuildStatus {
  const artifactPaths = getRuntimeBuildArtifactPaths();
  const currentBackend =
    current.backend ||
    readBuildFingerprint(
      artifactPaths.backendBuildPath,
      snapshot.backend.version ||
        readPackageVersion(artifactPaths.backendPackagePath),
    );
  const currentAgentRunner =
    current.agentRunner ||
    readBuildFingerprint(
      artifactPaths.agentRunnerBuildPath,
      snapshot.agentRunner.version ||
        readPackageVersion(artifactPaths.agentRunnerPackagePath),
    );

  const backendStale = isBuildFingerprintStale(
    snapshot.backend,
    currentBackend,
  );
  const agentRunnerStale = isBuildFingerprintStale(
    snapshot.agentRunner,
    currentAgentRunner,
  );

  return {
    pid: snapshot.pid,
    startedAt: snapshot.startedAt,
    backend: {
      loaded: snapshot.backend,
      current: currentBackend,
      stale: backendStale,
    },
    agentRunner: {
      loaded: snapshot.agentRunner,
      current: currentAgentRunner,
      stale: agentRunnerStale,
    },
    stale: backendStale || agentRunnerStale,
  };
}

const STARTUP_RUNTIME_BUILD_SNAPSHOT = createRuntimeBuildSnapshot();

export function getRuntimeBuildStartupSnapshot(): RuntimeBuildSnapshot {
  return STARTUP_RUNTIME_BUILD_SNAPSHOT;
}

export function getRuntimeBuildStatus(): RuntimeBuildStatus {
  return createRuntimeBuildStatus(STARTUP_RUNTIME_BUILD_SNAPSHOT);
}

export function isRuntimeBuildStale(): boolean {
  return getRuntimeBuildStatus().stale;
}

export function getRuntimeBuildLogFields(): RuntimeBuildLogFields {
  const status = getRuntimeBuildStatus();
  return {
    staleBuild: status.stale,
    backendPid: status.pid,
    backendStartedAt: status.startedAt,
    backendBuildLoaded: formatBuildFingerprintForLog(status.backend.loaded),
    backendBuildCurrent: formatBuildFingerprintForLog(status.backend.current),
    backendBuildStale: status.backend.stale,
    agentRunnerBuildLoaded: formatBuildFingerprintForLog(
      status.agentRunner.loaded,
    ),
    agentRunnerBuildCurrent: formatBuildFingerprintForLog(
      status.agentRunner.current,
    ),
    agentRunnerBuildStale: status.agentRunner.stale,
  };
}
