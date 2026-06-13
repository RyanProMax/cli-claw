import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Unable to locate repo root');
    current = parent;
  }
}

const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

function readRepoFile(path: string): string {
  return fs.readFileSync(`${REPO_ROOT}/${path}`, 'utf8');
}

function extractMakeTarget(makefile: string, targetName: string): string {
  const lines = makefile.split('\n');
  const startIndex = lines.findIndex((line) =>
    line.startsWith(`${targetName}:`),
  );
  expect(startIndex).toBeGreaterThanOrEqual(0);

  const targetLines: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      break;
    }
    targetLines.push(line);
  }
  return targetLines.join('\n');
}

describe('launch command contract', () => {
  test('make start delegates production backend startup to agent-fabric start', () => {
    const makefile = readRepoFile('Makefile');
    const startTarget = extractMakeTarget(makefile, 'start');

    expect(makefile).toContain('AGENT_FABRIC ?= agent-fabric');
    expect(startTarget).toContain('$(AGENT_FABRIC) start');
    expect(startTarget).not.toContain('\tbun src/index.ts');
    expect(startTarget).not.toContain('\tnode dist/index.js');
  });

  test('LaunchAgent default install uses agent-fabric start', () => {
    const script = readRepoFile('ops/install-launch-agent.sh');

    expect(script).toContain(
      'install without COMMAND uses: agent-fabric start',
    );
    expect(script).toContain('command -v agent-fabric');
    expect(script).toContain(
      'PROGRAM_ARGS=("$(command -v agent-fabric)" "start")',
    );
    expect(script).not.toContain(
      'PROGRAM_ARGS=("$(command -v bun)" "src/index.ts")',
    );
  });

  test('LaunchAgent installer retries transient bootstrap failures', () => {
    const script = readRepoFile('ops/install-launch-agent.sh');

    expect(script).toContain('bootstrap_launch_agent()');
    expect(script).toContain('local max_attempts=2');
    expect(script).toContain(
      'launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"',
    );
    expect(script).toContain('sleep 1');
    expect(script).toContain('bootstrap_launch_agent');
  });
});
