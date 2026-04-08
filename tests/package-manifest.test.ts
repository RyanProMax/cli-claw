import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

describe('npm package manifest', () => {
  test('exposes the cli launcher and release packaging contract', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name?: string;
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    expect(pkg.name).toBe('cli-claw-kit');
    expect(pkg.bin).toEqual({
      'cli-claw': 'dist/cli.js',
    });
    expect(pkg.files).toEqual(
      expect.arrayContaining([
        'dist',
        'config',
        'shared/dist',
        'web/dist',
        'container/build.sh',
        'container/Dockerfile',
        'container/entrypoint.sh',
        'container/skills',
        'container/agent-runner/dist',
        'container/agent-runner/prompts',
        'container/agent-runner/package.json',
      ]),
    );
    expect(pkg.files).not.toContain('container/agent-runner/src');
    expect(pkg.files).not.toContain('container/agent-runner/tsconfig.json');
    expect(pkg.scripts?.start).toBe('bun src/index.ts');
    expect(pkg.scripts?.build).toBe(
      'npm run build:shared && npm run build:backend && npm run build:web && npm --prefix container/agent-runner run build:runner',
    );
    expect(pkg.scripts?.['build:web']).toBe('npm --prefix web run build');
    expect(pkg.scripts?.['release:check']).toBe('bash ./scripts/release-check.sh');
    expect(pkg.scripts?.prepack).toBe('npm run build');
    expect(pkg.scripts?.dev).toBeUndefined();
    expect(pkg.scripts?.['dev:bun']).toBeUndefined();
    expect(pkg.scripts?.['dev:all']).toBeUndefined();
    expect(pkg.scripts?.['dev:web']).toBeUndefined();
    expect(pkg.scripts?.['build:release']).toBeUndefined();
    expect(pkg.scripts?.['build:all']).toBeUndefined();
    expect(pkg.scripts?.['build:web:local']).toBeUndefined();
    expect(pkg.dependencies?.['@agentclientprotocol/sdk']).toBeDefined();
  });
});
