import { describe, expect, test } from 'vitest';

import {
  getAvailableRuntimeModelCatalog,
  getAvailableRuntimeModelOptions,
  getAvailableRuntimeModelPresets,
  normalizeAvailableRuntimeModelPreset,
} from '../../../../src/core/runtime/model-options.ts';

describe('runtime model options', () => {
  test('returns OpenAI preset model options without CLI or cache discovery', () => {
    expect(getAvailableRuntimeModelCatalog('openai')).toEqual({
      source: 'preset',
      options: [
        { value: 'gpt-5.4', label: 'GPT-5.4' },
        { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
        { value: 'gpt-5.2', label: 'GPT-5.2' },
      ],
    });
  });

  test('includes the effective current OpenAI model when it is absent from presets', () => {
    expect(
      getAvailableRuntimeModelOptions('openai', {
        currentModel: 'gpt-5.5',
      }),
    ).toEqual([
      { value: 'gpt-5.5', label: 'GPT-5.5 (current)' },
      { value: 'gpt-5.4', label: 'GPT-5.4' },
      { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
      { value: 'gpt-5.2', label: 'GPT-5.2' },
    ]);

    expect(
      normalizeAvailableRuntimeModelPreset('openai', 'GPT-5.5', {
        currentModel: 'gpt-5.5',
      }),
    ).toBe('gpt-5.5');
  });

  test('normalizes OpenAI selections against local presets', () => {
    expect(normalizeAvailableRuntimeModelPreset('openai', ' GPT-5.4 ')).toBe(
      'gpt-5.4',
    );
    expect(
      normalizeAvailableRuntimeModelPreset('openai', 'gpt-5.4-mini'),
    ).toBe('gpt-5.4-mini');
    expect(normalizeAvailableRuntimeModelPreset('openai', 'gpt-5.5')).toBeNull();
  });

  test('keeps Claude model presets preset-only', () => {
    expect(
      getAvailableRuntimeModelPresets('claude', {
        currentModel: 'claude-experimental-current',
      }),
    ).toEqual(['opus[1m]', 'opus', 'sonnet[1m]', 'sonnet', 'haiku']);

    expect(
      normalizeAvailableRuntimeModelPreset(
        'claude',
        'claude-experimental-current',
        { currentModel: 'claude-experimental-current' },
      ),
    ).toBeNull();
  });
});
