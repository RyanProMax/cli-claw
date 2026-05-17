import { describe, expect, test } from 'vitest';

import {
  formatCommandHelp,
  getDefaultModelPreset,
  getDefaultReasoningEffortPreset,
  getDefaultSpeedTierPreset,
  getModelPresetOptions,
  formatUnknownRuntimeCommandReply,
  getModelPresets,
  getSpeedTierOptions,
  normalizeModelPreset,
  normalizeReasoningEffortPreset,
  normalizeSpeedTierPreset,
  parseSlashCommandCandidate,
  parseRuntimeCommand,
  supportsReasoningEffort,
  supportsSpeedTier,
} from '../../../../src/core/runtime/command-registry.ts';
import {
  detectRuntimePickerCommand,
  getRuntimePickerSections,
} from '../../../../web/src/lib/runtimeCommandPicker.ts';

describe('runtime command registry', () => {
  test('formats web help as grouped module sections for openai workspaces', () => {
    const help = formatCommandHelp({
      entrypoint: 'web',
      agentType: 'openai',
    });

    expect(help).not.toContain('可用命令：');
    expect(help).toContain('Agent 命令：');
    expect(help).toContain('/help');
    expect(help).toContain('/clear');
    expect(help).toContain('/sw <任务描述>');
    expect(help).toContain('/openai');
    expect(help).not.toContain('/claude');
    expect(help).not.toContain('/model');
    expect(help).not.toContain('/effort');
    expect(help).not.toContain('/speed');
    expect(help).not.toContain('/model <preset>');
    expect(help).not.toContain('/bind <workspace>');
  });

  test('formats IM help with commands grouped by module', () => {
    const help = formatCommandHelp({
      entrypoint: 'im',
      agentType: 'claude',
    });

    expect(help).not.toContain('可用命令：');
    expect(help).toContain('Agent 命令：');
    expect(help).toContain('工作区命令：');
    expect(help).toContain('服务命令：');
    expect(help).toContain('/help');
    expect(help).toContain('/bind <workspace>');
    expect(help).not.toContain('/where');
    expect(help).toContain('/claude');
    expect(help).not.toContain('/openai');
    expect(help).not.toContain('/model');
    expect(help).not.toContain('/autopilot');
    expect(help).not.toContain('/recall');
    expect(help).not.toContain('/effort <low|medium|high|xhigh>');
  });

  test('does not expose legacy /usage or standalone runtime setting commands', () => {
    const imHelp = formatCommandHelp({
      entrypoint: 'im',
      agentType: 'openai',
    });
    const webHelp = formatCommandHelp({
      entrypoint: 'web',
      agentType: 'openai',
    });

    expect(imHelp).not.toContain('/usage');
    expect(webHelp).not.toContain('/usage');
    expect(parseRuntimeCommand('/usage')).toBeNull();
    expect(parseRuntimeCommand('/where')).toBeNull();
    expect(parseRuntimeCommand('/model')).toBeNull();
    expect(parseRuntimeCommand('/effort')).toBeNull();
    expect(parseRuntimeCommand('/speed')).toBeNull();
    expect(parseRuntimeCommand('/openai')).toMatchObject({
      name: 'openai',
      argsText: '',
      args: [],
    });
    expect(parseRuntimeCommand('/claude')).toMatchObject({
      name: 'claude',
      argsText: '',
      args: [],
    });
  });

  test('shows self-iteration commands in IM help and parses them as local commands', () => {
    const imHelp = formatCommandHelp({
      entrypoint: 'im',
      agentType: 'openai',
    });
    const webHelp = formatCommandHelp({
      entrypoint: 'web',
      agentType: 'openai',
    });

    expect(imHelp).toContain('/self-status');
    expect(imHelp).toContain('/self-check');
    expect(imHelp).toContain('/self-restart');
    expect(webHelp).not.toContain('/self-status');
    expect(webHelp).not.toContain('/self-check');
    expect(webHelp).not.toContain('/self-restart');
    expect(parseRuntimeCommand('/self-status')).toMatchObject({
      name: 'self-status',
      argsText: '',
      args: [],
    });
    expect(parseRuntimeCommand('/self-check')).toMatchObject({
      name: 'self-check',
      argsText: '',
      args: [],
    });
    expect(parseRuntimeCommand('/self-restart')).toMatchObject({
      name: 'self-restart',
      argsText: '',
      args: [],
    });
    expect(parseRuntimeCommand('/autopilot on')).toBeNull();
    expect(parseRuntimeCommand('/recall')).toBeNull();
  });

  test('normalizes preset-only model selections', () => {
    expect(normalizeModelPreset('claude', ' SONNET ')).toBe('sonnet');
    expect(normalizeModelPreset('openai', 'GPT-5.4')).toBe('gpt-5.4');
    expect(normalizeModelPreset('openai', 'not-a-preset')).toBeNull();
  });

  test('normalizes reasoning effort presets only for supported runtimes', () => {
    expect(supportsReasoningEffort('openai')).toBe(true);
    expect(supportsReasoningEffort('claude')).toBe(false);
    expect(normalizeReasoningEffortPreset(' xhigh ')).toBe('xhigh');
    expect(normalizeReasoningEffortPreset('turbo')).toBeNull();
  });

  test('normalizes speed tier presets only for supported runtimes', () => {
    expect(supportsSpeedTier('openai')).toBe(true);
    expect(supportsSpeedTier('claude')).toBe(false);
    expect(normalizeSpeedTierPreset(' FAST ')).toBe('fast');
    expect(normalizeSpeedTierPreset('turbo')).toBeNull();
  });

  test('exposes preset-only model lists by runtime', () => {
    expect(getModelPresets('claude')).toEqual([
      'opus[1m]',
      'opus',
      'sonnet[1m]',
      'sonnet',
      'haiku',
    ]);
    expect(getModelPresets('openai')).toEqual([
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.2',
    ]);
  });

  test('exposes display labels for runtime model pickers', () => {
    expect(getModelPresetOptions('openai')).toEqual([
      { value: 'gpt-5.4', label: 'GPT-5.4' },
      { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
      { value: 'gpt-5.2', label: 'GPT-5.2' },
    ]);
  });

  test('exposes stable runtime fallback defaults for picker/status rendering', () => {
    expect(getDefaultModelPreset('claude')).toBe('opus[1m]');
    expect(getDefaultModelPreset('openai')).toBe('gpt-5.4');
    expect(getDefaultReasoningEffortPreset('claude')).toBeNull();
    expect(getDefaultReasoningEffortPreset('openai')).toBe('medium');
    expect(getDefaultSpeedTierPreset('claude')).toBeNull();
    expect(getDefaultSpeedTierPreset('openai')).toBe('standard');
  });

  test('detects agent-scoped runtime picker commands only for bare slash commands', () => {
    expect(detectRuntimePickerCommand('/openai')).toBe('openai');
    expect(detectRuntimePickerCommand('/openai ')).toBe('openai');
    expect(detectRuntimePickerCommand('/claude')).toBe('claude');
    expect(detectRuntimePickerCommand('/model')).toBeNull();
    expect(detectRuntimePickerCommand('/effort')).toBeNull();
    expect(detectRuntimePickerCommand('/speed')).toBeNull();
    expect(detectRuntimePickerCommand('/openai gpt-5.4')).toBeNull();
    expect(detectRuntimePickerCommand('hello')).toBeNull();
  });

  test('returns grouped runtime picker sections only for the matching agent command', () => {
    expect(
      getRuntimePickerSections({ command: 'openai', agentType: 'openai' }).map(
        (section) => section.command,
      ),
    ).toEqual(['model', 'effort', 'speed']);
    expect(
      getRuntimePickerSections({ command: 'claude', agentType: 'claude' }).map(
        (section) => section.command,
      ),
    ).toEqual(['model']);
    expect(
      getRuntimePickerSections({ command: 'openai', agentType: 'claude' }),
    ).toEqual([]);
    expect(
      getRuntimePickerSections({ command: 'openai', agentType: 'openai' })
        .find((section) => section.command === 'effort')
        ?.options.map((item) => item.value),
    ).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(getSpeedTierOptions()).toEqual([
      { value: 'standard', label: 'standard (1x)' },
      { value: 'fast', label: 'fast (2x)' },
    ]);
    expect(
      getRuntimePickerSections({ command: 'openai', agentType: 'openai' })
        .find((section) => section.command === 'speed')
        ?.options.map((item) => item.value),
    ).toEqual(['standard', 'fast']);
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
    expect(parseSlashCommandCandidate('openai', { allowBare: true })).toEqual({
      rawName: 'openai',
      argsText: '',
      args: [],
    });
  });

  test('formats a stable reply for unsupported slash commands', () => {
    expect(formatUnknownRuntimeCommandReply('statis')).toBe(
      '不支持的命令 /statis，请使用 /help 查看当前可用命令',
    );
  });
});
