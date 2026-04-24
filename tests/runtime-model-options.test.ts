import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  getAvailableRuntimeModelOptions,
  getAvailableRuntimeModelPresets,
  normalizeAvailableRuntimeModelPreset,
} from '../src/runtime-model-options.ts';

const tempDirs: string[] = [];

function createCodexModelsCache(content: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-model-options-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'models_cache.json');
  fs.writeFileSync(file, JSON.stringify(content), 'utf8');
  return file;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('runtime model options', () => {
  test('reads visible codex model choices from the local CLI cache', () => {
    const cachePath = createCodexModelsCache({
      models: [
        {
          slug: 'gpt-5.5',
          display_name: 'GPT-5.5',
          visibility: 'list',
        },
        {
          slug: 'gpt-hidden',
          display_name: 'GPT-Hidden',
          visibility: 'hidden',
        },
        {
          slug: 'gpt-5.3-codex-spark',
          visibility: 'list',
        },
        {
          slug: 'gpt-5.5',
          display_name: 'GPT-5.5 duplicate',
          visibility: 'list',
        },
      ],
    });

    expect(
      getAvailableRuntimeModelOptions('codex', {
        codexModelsCachePath: cachePath,
      }),
    ).toEqual([
      { value: 'gpt-5.5', label: 'GPT-5.5' },
      { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark' },
    ]);
  });

  test('falls back to built-in presets when the codex cache is missing or invalid', () => {
    expect(
      getAvailableRuntimeModelPresets('codex', {
        codexModelsCachePath: path.join(os.tmpdir(), 'missing-models-cache.json'),
      }),
    ).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2']);

    const invalidPath = createCodexModelsCache({ models: 'not-an-array' });
    expect(
      getAvailableRuntimeModelPresets('codex', {
        codexModelsCachePath: invalidPath,
      }),
    ).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2']);
  });

  test('normalizes codex selections against dynamically discovered models', () => {
    const cachePath = createCodexModelsCache({
      models: [
        {
          slug: 'gpt-5.5',
          display_name: 'GPT-5.5',
          visibility: 'list',
        },
        {
          slug: 'gpt-5.3-codex-spark',
          display_name: 'GPT-5.3-Codex-Spark',
          visibility: 'list',
        },
      ],
    });

    expect(
      normalizeAvailableRuntimeModelPreset('codex', ' GPT-5.5 ', {
        codexModelsCachePath: cachePath,
      }),
    ).toBe('gpt-5.5');
    expect(
      normalizeAvailableRuntimeModelPreset('codex', 'gpt-5.3-codex-spark', {
        codexModelsCachePath: cachePath,
      }),
    ).toBe('gpt-5.3-codex-spark');
    expect(
      normalizeAvailableRuntimeModelPreset('codex', 'gpt-5.4-mini', {
        codexModelsCachePath: cachePath,
      }),
    ).toBeNull();
  });
});
