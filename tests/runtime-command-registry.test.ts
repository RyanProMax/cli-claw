import { describe, expect, test } from 'vitest';

import {
  formatCommandHelp,
  getModelPresets,
  normalizeModelPreset,
  normalizeReasoningEffortPreset,
  supportsReasoningEffort,
} from '../src/runtime-command-registry.ts';

describe('runtime command registry', () => {
  test('formats web help with only web-direct commands for codex workspaces', () => {
    const help = formatCommandHelp({
      entrypoint: 'web',
      agentType: 'codex',
    });

    expect(help).toContain('/help');
    expect(help).toContain('/clear');
    expect(help).toContain('/sw <任务描述>');
    expect(help).toContain('/model <preset>');
    expect(help).toContain('/effort <low|medium|high|xhigh>');
    expect(help).not.toContain('/bind <workspace>');
  });

  test('formats IM help with workspace management commands', () => {
    const help = formatCommandHelp({
      entrypoint: 'im',
      agentType: 'claude',
    });

    expect(help).toContain('/help');
    expect(help).toContain('/bind <workspace>');
    expect(help).toContain('/where');
    expect(help).toContain('/model <preset>');
    expect(help).not.toContain('/effort <low|medium|high|xhigh>');
  });

  test('normalizes preset-only model selections', () => {
    expect(normalizeModelPreset('claude', ' SONNET ')).toBe('sonnet');
    expect(normalizeModelPreset('codex', 'GPT-5.4')).toBe('gpt-5.4');
    expect(normalizeModelPreset('codex', 'not-a-preset')).toBeNull();
  });

  test('normalizes reasoning effort presets only for supported runtimes', () => {
    expect(supportsReasoningEffort('codex')).toBe(true);
    expect(supportsReasoningEffort('claude')).toBe(false);
    expect(normalizeReasoningEffortPreset(' xhigh ')).toBe('xhigh');
    expect(normalizeReasoningEffortPreset('turbo')).toBeNull();
  });

  test('exposes preset-only model lists by runtime', () => {
    expect(getModelPresets('claude')).toEqual([
      'opus[1m]',
      'opus',
      'sonnet[1m]',
      'sonnet',
      'haiku',
    ]);
    expect(getModelPresets('codex')).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
  });
});
