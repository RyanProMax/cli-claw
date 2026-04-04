import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { readCodexCliConfig } from '../container/agent-runner/src/codex-config.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeConfig(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-config-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'config.toml');
  fs.writeFileSync(file, contents, 'utf-8');
  return file;
}

describe('readCodexCliConfig', () => {
  test('reads model and model_reasoning_effort from codex config', () => {
    const file = makeConfig([
      'model = "gpt-5.4"',
      'model_reasoning_effort = "xhigh"',
    ].join('\n'));

    expect(readCodexCliConfig(file)).toEqual({
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    });
  });

  test('falls back to reasoning_effort and tolerates missing file', () => {
    const file = makeConfig([
      'model = "gpt-5.4"',
      'reasoning_effort = "high"',
    ].join('\n'));

    expect(readCodexCliConfig(file)).toEqual({
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });
    expect(readCodexCliConfig(path.join(file, '.missing'))).toEqual({
      model: null,
      reasoningEffort: null,
    });
  });
});
