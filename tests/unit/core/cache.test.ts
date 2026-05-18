import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  cleanupCache,
  createCacheTempDir,
  ensureCacheNamespaceDir,
  resolveCacheNamespaceDir,
  startCacheCleanupLoop,
  withCacheTempDir,
} from '../../../src/core/cache.ts';

function writeFile(filePath: string, content: string, mtimeMs: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  const time = new Date(mtimeMs);
  fs.utimesSync(filePath, time, time);
}

describe('cache manager', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeCacheRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-cache-test-'));
    tempDirs.push(dir);
    return dir;
  }

  test('resolves namespaces under the cache root and rejects path traversal', () => {
    const cacheRoot = makeCacheRoot();

    expect(resolveCacheNamespaceDir('hkex-docs', { cacheRoot })).toBe(
      path.join(cacheRoot, 'hkex-docs'),
    );
    expect(ensureCacheNamespaceDir('downloads.v1', { cacheRoot })).toBe(
      path.join(cacheRoot, 'downloads.v1'),
    );
    expect(fs.existsSync(path.join(cacheRoot, 'downloads.v1'))).toBe(true);

    expect(() => resolveCacheNamespaceDir('../ops', { cacheRoot })).toThrow(
      /Invalid cache namespace/,
    );
    expect(() => resolveCacheNamespaceDir('hkex/docs', { cacheRoot })).toThrow(
      /Invalid cache namespace/,
    );
    expect(() =>
      createCacheTempDir('hkex-docs', '../tmp-', { cacheRoot }),
    ).toThrow(/Invalid cache temp prefix/);
  });

  test('refuses unsafe cleanup roots', () => {
    const cacheRoot = path.join(os.tmpdir(), 'Caches', 'cli-claw');
    tempDirs.push(cacheRoot);

    expect(() =>
      cleanupCache({ cacheRoot, nowMs: 1_000, ttlMs: 1_000, maxBytes: 1_000 }),
    ).not.toThrow();
    expect(() =>
      cleanupCache({ cacheRoot: path.parse(process.cwd()).root }),
    ).toThrow(/Refusing unsafe cache root/);
    expect(() => cleanupCache({ cacheRoot: os.tmpdir() })).toThrow(
      /Refusing unsafe cache root/,
    );
  });

  test('removes expired files and prunes empty directories', () => {
    const cacheRoot = makeCacheRoot();
    const oldFile = path.join(cacheRoot, 'hkex-docs', 'nested', 'old.pdf');
    const freshFile = path.join(cacheRoot, 'hkex-docs', 'fresh.pdf');
    writeFile(oldFile, 'old', 1_000);
    writeFile(freshFile, 'fresh', 9_000);

    const result = cleanupCache({
      cacheRoot,
      nowMs: 10_000,
      ttlMs: 5_000,
      maxBytes: 1_000_000,
    });

    expect(result.removedFiles).toBe(1);
    expect(result.removedBytes).toBe(Buffer.byteLength('old'));
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(path.dirname(oldFile))).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);
  });

  test('enforces max bytes by removing the oldest files first', () => {
    const cacheRoot = makeCacheRoot();
    const first = path.join(cacheRoot, 'hkex-docs', 'first.bin');
    const second = path.join(cacheRoot, 'hkex-docs', 'second.bin');
    const third = path.join(cacheRoot, 'hkex-docs', 'third.bin');
    writeFile(first, '1111111111', 1_000);
    writeFile(second, '2222222222', 2_000);
    writeFile(third, '3333333333', 3_000);

    const result = cleanupCache({
      cacheRoot,
      nowMs: 4_000,
      ttlMs: 60_000,
      maxBytes: 15,
    });

    expect(result.removedFiles).toBe(2);
    expect(result.remainingBytes).toBe(10);
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(false);
    expect(fs.existsSync(third)).toBe(true);
  });

  test('runs cleanup immediately and then on interval until stopped', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn(() => ({
      scannedFiles: 0,
      removedFiles: 0,
      removedBytes: 0,
      remainingBytes: 0,
      errors: [],
    }));

    const loop = startCacheCleanupLoop({
      intervalMs: 1_000,
      cleanup,
    });

    expect(cleanup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(cleanup).toHaveBeenCalledTimes(3);

    loop.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  test('cleans temporary cache directories after scoped work', async () => {
    const cacheRoot = makeCacheRoot();
    let tempDir = '';

    const result = await withCacheTempDir(
      'hkex-docs',
      async (dir) => {
        tempDir = dir;
        fs.writeFileSync(path.join(dir, 'download.pdf'), 'pdf');
        expect(fs.existsSync(dir)).toBe(true);
        return 'parsed';
      },
      { cacheRoot },
    );

    expect(result).toBe('parsed');
    expect(tempDir).not.toBe('');
    expect(fs.existsSync(tempDir)).toBe(false);

    let failingTempDir = '';
    await expect(
      withCacheTempDir(
        'hkex-docs',
        async (dir) => {
          failingTempDir = dir;
          fs.writeFileSync(path.join(dir, 'broken.pdf'), 'pdf');
          throw new Error('parse failed');
        },
        { cacheRoot },
      ),
    ).rejects.toThrow(/parse failed/);
    expect(failingTempDir).not.toBe('');
    expect(fs.existsSync(failingTempDir)).toBe(false);
  });
});
