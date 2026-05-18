import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import { canResolveAgentRunnerDependency } from '../../../../src/agent/runner/container-runner.ts';

describe('agent-runner dependency preflight', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts packages that export their entrypoint but not package.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runner-dep-'));
    tempDirs.push(root);
    const depRoot = path.join(root, 'node_modules', 'export-only-package');
    fs.mkdirSync(depRoot, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );
    fs.writeFileSync(
      path.join(depRoot, 'package.json'),
      JSON.stringify({
        name: 'export-only-package',
        type: 'module',
        exports: { '.': './index.js' },
      }),
    );
    fs.writeFileSync(path.join(depRoot, 'index.js'), 'export default 1;');

    expect(
      canResolveAgentRunnerDependency({
        manifestPath: path.join(root, 'package.json'),
        dependency: 'export-only-package',
      }),
    ).toBe(true);
  });
});
