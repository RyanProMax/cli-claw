import fs from 'fs';
import path from 'path';

import { CACHE_DIR } from './config.js';
import { logger } from './logger.js';

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const NAMESPACE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const TEMP_PREFIX_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}-$/;

export interface CachePathOptions {
  cacheRoot?: string;
}

export interface CacheCleanupOptions extends CachePathOptions {
  nowMs?: number;
  ttlMs?: number;
  maxBytes?: number;
}

export interface CacheCleanupResult {
  scannedFiles: number;
  removedFiles: number;
  removedBytes: number;
  remainingBytes: number;
  errors: Array<{ path: string; error: string }>;
}

interface CacheFileEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface CacheCleanupLoopOptions extends CacheCleanupOptions {
  intervalMs?: number;
  cleanup?: () => CacheCleanupResult;
}

export interface CacheCleanupLoop {
  stop: () => void;
  runNow: () => CacheCleanupResult;
}

function envPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCacheRoot(cacheRoot = CACHE_DIR): string {
  const resolved = path.resolve(cacheRoot);
  const parsed = path.parse(resolved);
  const hasCachePathSegment = resolved
    .split(path.sep)
    .some((segment) => segment.toLowerCase().includes('cache'));
  if (resolved === parsed.root || !hasCachePathSegment) {
    throw new Error(`Refusing unsafe cache root: ${resolved}`);
  }
  return resolved;
}

function assertCacheNamespace(namespace: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(`Invalid cache namespace: ${namespace}`);
  }
}

function assertCacheTempPrefix(prefix: string): void {
  if (!TEMP_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid cache temp prefix: ${prefix}`);
  }
}

export function resolveCacheNamespaceDir(
  namespace: string,
  options: CachePathOptions = {},
): string {
  assertCacheNamespace(namespace);
  return path.join(getCacheRoot(options.cacheRoot), namespace);
}

export function ensureCacheNamespaceDir(
  namespace: string,
  options: CachePathOptions = {},
): string {
  const namespaceDir = resolveCacheNamespaceDir(namespace, options);
  fs.mkdirSync(namespaceDir, { recursive: true });
  return namespaceDir;
}

export function createCacheTempDir(
  namespace: string,
  prefix = 'tmp-',
  options: CachePathOptions = {},
): string {
  assertCacheTempPrefix(prefix);
  const namespaceDir = ensureCacheNamespaceDir(namespace, options);
  return fs.mkdtempSync(path.join(namespaceDir, prefix));
}

export async function withCacheTempDir<T>(
  namespace: string,
  work: (dir: string) => Promise<T> | T,
  options: CachePathOptions & { prefix?: string } = {},
): Promise<T> {
  const tempDir = createCacheTempDir(
    namespace,
    options.prefix ?? 'tmp-',
    options,
  );
  try {
    return await work(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function collectCacheEntries(
  dir: string,
  files: CacheFileEntry[],
  directories: string[],
  errors: CacheCleanupResult['errors'],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    errors.push({ path: dir, error: String(error) });
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(fullPath);
    } catch (error) {
      errors.push({ path: fullPath, error: String(error) });
      continue;
    }

    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      collectCacheEntries(fullPath, files, directories, errors);
      directories.push(fullPath);
      continue;
    }

    files.push({
      path: fullPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
}

function removeFile(
  entry: CacheFileEntry,
  result: CacheCleanupResult,
  removed: Set<string>,
): boolean {
  if (removed.has(entry.path)) return false;
  try {
    fs.rmSync(entry.path, { force: true });
    removed.add(entry.path);
    result.removedFiles += 1;
    result.removedBytes += entry.size;
    result.remainingBytes -= entry.size;
    return true;
  } catch (error) {
    result.errors.push({ path: entry.path, error: String(error) });
    return false;
  }
}

function pruneEmptyDirectories(
  directories: string[],
  errors: CacheCleanupResult['errors'],
): void {
  for (const dir of directories.sort((a, b) => b.length - a.length)) {
    try {
      fs.rmdirSync(dir);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOTEMPTY' && nodeError.code !== 'ENOENT') {
        errors.push({ path: dir, error: String(error) });
      }
    }
  }
}

export function cleanupCache(
  options: CacheCleanupOptions = {},
): CacheCleanupResult {
  const cacheRoot = getCacheRoot(options.cacheRoot);
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs =
    options.ttlMs ??
    envPositiveNumber('AGENT_FABRIC_CACHE_TTL_MS', DEFAULT_TTL_MS);
  const maxBytes =
    options.maxBytes ??
    envPositiveNumber('AGENT_FABRIC_CACHE_MAX_BYTES', DEFAULT_MAX_BYTES);
  const result: CacheCleanupResult = {
    scannedFiles: 0,
    removedFiles: 0,
    removedBytes: 0,
    remainingBytes: 0,
    errors: [],
  };

  if (!fs.existsSync(cacheRoot)) {
    fs.mkdirSync(cacheRoot, { recursive: true });
    return result;
  }

  const files: CacheFileEntry[] = [];
  const directories: string[] = [];
  collectCacheEntries(cacheRoot, files, directories, result.errors);
  result.scannedFiles = files.length;
  result.remainingBytes = files.reduce((sum, entry) => sum + entry.size, 0);

  const removed = new Set<string>();
  for (const entry of files) {
    if (nowMs - entry.mtimeMs > ttlMs) {
      removeFile(entry, result, removed);
    }
  }

  if (result.remainingBytes > maxBytes) {
    for (const entry of files
      .filter((file) => !removed.has(file.path))
      .sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (result.remainingBytes <= maxBytes) break;
      removeFile(entry, result, removed);
    }
  }

  pruneEmptyDirectories(directories, result.errors);
  return result;
}

export function startCacheCleanupLoop(
  options: CacheCleanupLoopOptions = {},
): CacheCleanupLoop {
  const intervalMs =
    options.intervalMs ??
    envPositiveNumber(
      'AGENT_FABRIC_CACHE_CLEANUP_INTERVAL_MS',
      DEFAULT_CLEANUP_INTERVAL_MS,
    );
  const run = () => {
    const result = options.cleanup
      ? options.cleanup()
      : cleanupCache({
          cacheRoot: options.cacheRoot,
          ttlMs: options.ttlMs,
          maxBytes: options.maxBytes,
        });
    if (result.removedFiles > 0 || result.errors.length > 0) {
      logger.info(result, 'Cache cleanup completed');
    }
    return result;
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
    runNow: run,
  };
}
