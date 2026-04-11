import { describe, expect, test } from 'vitest';

import {
  formatCommandHelp,
  getDefaultModelPreset,
  getDefaultReasoningEffortPreset,
  getModelPresetOptions,
  formatUnknownRuntimeCommandReply,
  getModelPresets,
  normalizeModelPreset,
  normalizeReasoningEffortPreset,
  parseSlashCommandCandidate,
  parseRuntimeCommand,
  supportsReasoningEffort,
} from '../src/runtime-command-registry.ts';
import {
  detectRuntimePickerCommand,
  getRuntimePickerOptions,
} from '../web/src/lib/runtimeCommandPicker.ts';

describe('runtime command registry', () => {
  test('formats web help with only web-direct commands for codex workspaces', () => {
    const help = formatCommandHelp({
      entrypoint: 'web',
      agentType: 'codex',
    });

    expect(help).toContain('/help');
    expect(help).toContain('/clear');
    expect(help).toContain('/sw <任务描述>');
    expect(help).toContain('/model');
    expect(help).toContain('/effort');
    expect(help).not.toContain('/model <preset>');
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
    expect(help).toContain('/model');
    expect(help).not.toContain('/effort <low|medium|high|xhigh>');
  });

  test('shows /usage in IM help, hides it from Web help, and parses it as a local command', () => {
    const imHelp = formatCommandHelp({
      entrypoint: 'im',
      agentType: 'codex',
    });
    const webHelp = formatCommandHelp({
      entrypoint: 'web',
      agentType: 'codex',
    });

    expect(imHelp).toContain('/usage');
    expect(webHelp).not.toContain('/usage');
    expect(parseRuntimeCommand('/usage')).toMatchObject({
      name: 'usage',
      argsText: '',
      args: [],
    });
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
    expect(getModelPresets('codex')).toEqual([
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.2',
    ]);
  });

  test('exposes display labels for runtime model pickers', () => {
    expect(getModelPresetOptions('codex')).toEqual([
      { value: 'gpt-5.4', label: 'GPT-5.4' },
      { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
      { value: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
      { value: 'gpt-5.2', label: 'GPT-5.2' },
    ]);
  });

  test('exposes stable runtime fallback defaults for picker/status rendering', () => {
    expect(getDefaultModelPreset('claude')).toBe('opus[1m]');
    expect(getDefaultModelPreset('codex')).toBe('gpt-5.4');
    expect(getDefaultReasoningEffortPreset('claude')).toBeNull();
    expect(getDefaultReasoningEffortPreset('codex')).toBe('medium');
  });

  test('detects runtime picker commands only for bare slash commands', () => {
    expect(detectRuntimePickerCommand('/model')).toBe('model');
    expect(detectRuntimePickerCommand('/model ')).toBe('model');
    expect(detectRuntimePickerCommand('/effort')).toBe('effort');
    expect(detectRuntimePickerCommand('/model gpt-5.4')).toBeNull();
    expect(detectRuntimePickerCommand('hello')).toBeNull();
  });

  test('returns runtime picker options only when the runtime supports them', () => {
    expect(getRuntimePickerOptions({ command: 'model', agentType: 'codex' })).toHaveLength(4);
    expect(
      getRuntimePickerOptions({ command: 'effort', agentType: 'claude' }),
    ).toEqual([]);
    expect(
      getRuntimePickerOptions({ command: 'effort', agentType: 'codex' }).map(
        (item) => item.value,
      ),
    ).toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  test('extracts unknown slash commands without treating them as valid runtime commands', () => {
    expect(parseSlashCommandCandidate('/statis')).toEqual({
      rawName: 'statis',
      argsText: '',
      args: [],
    });
    expect(parseRuntimeCommand('/statis')).toBeNull();
  });

  test('supports IM command parsing when connectors strip the leading slash', () => {
    expect(parseSlashCommandCandidate('status')).toBeNull();
    expect(parseSlashCommandCandidate('status', { allowBare: true })).toEqual({
      rawName: 'status',
      argsText: '',
      args: [],
    });
    expect(
      parseSlashCommandCandidate('model gpt-5.4', { allowBare: true }),
    ).toEqual({
      rawName: 'model',
      argsText: 'gpt-5.4',
      args: ['gpt-5.4'],
    });
  });

  test('formats a stable reply for unsupported slash commands', () => {
    expect(formatUnknownRuntimeCommandReply('statis')).toBe(
      '不支持的命令 /statis，请使用 /help 查看当前可用命令',
    );
  });
});
