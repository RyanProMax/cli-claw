import { describe, expect, test } from 'vitest';

import {
  enforceAgentExecutionMode,
  normalizeAgentType,
} from '../src/group-runtime.js';

describe('normalizeAgentType', () => {
  test('defaults empty values to claude', () => {
    expect(normalizeAgentType(undefined)).toBe('claude');
    expect(normalizeAgentType(null)).toBe('claude');
    expect(normalizeAgentType('')).toBe('claude');
  });

  test('accepts codex explicitly', () => {
    expect(normalizeAgentType('codex')).toBe('codex');
  });

  test('falls back unknown values to claude', () => {
    expect(normalizeAgentType('unknown')).toBe('claude');
  });
});

describe('enforceAgentExecutionMode', () => {
  test('allows claude in both execution modes', () => {
    expect(enforceAgentExecutionMode('claude', 'host')).toBeNull();
    expect(enforceAgentExecutionMode('claude', 'container')).toBeNull();
  });

  test('allows codex only in host mode', () => {
    expect(enforceAgentExecutionMode('codex', 'host')).toBeNull();
    expect(enforceAgentExecutionMode('codex', 'container')).toBe(
      'Codex only supports host execution mode',
    );
  });
});
