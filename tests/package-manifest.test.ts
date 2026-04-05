import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

describe('npm package manifest', () => {
  test('exposes the cli launcher and release packaging contract', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

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
    expect(pkg.scripts?.['build:release']).toBeDefined();
    expect(pkg.scripts?.['release:check']).toBe('bash ./scripts/release-check.sh');
    expect(pkg.scripts?.prepack).toBe('npm run build:release');
    expect(pkg.scripts?.start).toBe('node dist/cli.js start');
    expect(pkg.dependencies?.['@agentclientprotocol/sdk']).toBeDefined();
  });
});
