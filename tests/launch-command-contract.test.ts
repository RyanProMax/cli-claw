import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

function readRepoFile(path: string): string {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
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
  test('make start delegates production backend startup to cli-claw start', () => {
    const makefile = readRepoFile('Makefile');
    const startTarget = extractMakeTarget(makefile, 'start');

    expect(makefile).toContain('CLI_CLAW ?= cli-claw');
    expect(startTarget).toContain('$(CLI_CLAW) start');
    expect(startTarget).not.toContain('\tbun src/index.ts');
    expect(startTarget).not.toContain('\tnode dist/index.js');
  });

  test('LaunchAgent default install uses cli-claw start', () => {
    const script = readRepoFile('ops/install-launch-agent.sh');

    expect(script).toContain('install without COMMAND uses: cli-claw start');
    expect(script).toContain('command -v cli-claw');
    expect(script).toContain('PROGRAM_ARGS=("$(command -v cli-claw)" "start")');
    expect(script).not.toContain('PROGRAM_ARGS=("$(command -v bun)" "src/index.ts")');
  });
});
