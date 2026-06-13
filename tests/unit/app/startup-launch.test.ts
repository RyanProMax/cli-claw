import { describe, expect, test } from 'vitest';

import {
  createCliStartLaunchSpec,
  inferDirectBackendLaunchSpec,
} from '../../../src/core/self/startup-launch.js';

describe('startup launch spec', () => {
  test('marks repo-local source launcher starts as source artifact mode', () => {
    const spec = createCliStartLaunchSpec({
      execPath: '/Users/ryan/.bun/bin/bun',
      argvEntry: '/Users/ryan/projects/agent-fabric/src/cli.ts',
      cwd: '/Users/ryan/projects/agent-fabric',
    });

    expect((spec as any).source).toBe('cli_start');
    expect((spec as any).artifactMode).toBe('source');
  });

  test('accepts relative repo-local source launcher entrypoints', () => {
    const spec = createCliStartLaunchSpec({
      execPath: '/Users/ryan/.bun/bin/bun',
      argvEntry: 'src/cli.ts',
      cwd: '/Users/ryan/projects/agent-fabric',
    });

    expect(spec.restartable).toBe(true);
    expect(spec.validationError).toBeNull();
    expect((spec as any).source).toBe('cli_start');
    expect((spec as any).artifactMode).toBe('source');
  });

  test('marks direct backend TypeScript starts as source artifact mode', () => {
    const spec = inferDirectBackendLaunchSpec({
      execPath: '/Users/ryan/.bun/bin/bun',
      argv: [
        '/Users/ryan/.bun/bin/bun',
        '/Users/ryan/projects/agent-fabric/src/index.ts',
      ],
      cwd: '/Users/ryan/projects/agent-fabric',
    });

    expect((spec as any).source).toBe('direct_backend');
    expect((spec as any).artifactMode).toBe('source');
  });

  test('marks relative direct backend TypeScript starts as source artifact mode', () => {
    const spec = inferDirectBackendLaunchSpec({
      execPath: '/Users/ryan/.bun/bin/bun',
      argv: ['/Users/ryan/.bun/bin/bun', 'src/index.ts'],
      cwd: '/Users/ryan/projects/agent-fabric',
    });

    expect(spec.restartable).toBe(true);
    expect(spec.validationError).toBeNull();
    expect((spec as any).source).toBe('direct_backend');
    expect((spec as any).artifactMode).toBe('source');
  });
});
