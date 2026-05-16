import { describe, expect, test } from 'vitest';

import {
  buildModelSettings,
  buildOpenAiRuntimeIdentity,
  resolveCodexServiceTier,
} from '../../../container/agent-runner/src/openai-agent-runtime.ts';
import { formatOpenAiRuntimeError } from '../../../container/agent-runner/src/openai-agent-stream.ts';

describe('OpenAI agent runtime settings', () => {
  test('maps UI fast speed to Codex priority service tier', () => {
    expect(resolveCodexServiceTier('fast')).toBe('priority');
    expect(resolveCodexServiceTier(' FAST ')).toBe('priority');
    expect(resolveCodexServiceTier('priority')).toBe('priority');
  });

  test('omits Codex service tier for standard or unknown speeds', () => {
    expect(resolveCodexServiceTier('standard')).toBeNull();
    expect(resolveCodexServiceTier('turbo')).toBeNull();
    expect(resolveCodexServiceTier(null)).toBeNull();
  });

  test('builds model settings with priority service tier for fast requests', () => {
    const settings = buildModelSettings({
      prompt: '',
      groupFolder: 'main',
      chatJid: 'test',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
    });

    expect(settings.reasoning).toEqual({
      effort: 'xhigh',
      summary: 'auto',
    });
    expect(settings.store).toBe(false);
    expect(settings.providerData).toEqual({ service_tier: 'priority' });
  });

  test('builds model settings without service tier for standard requests', () => {
    const settings = buildModelSettings({
      prompt: '',
      groupFolder: 'main',
      chatJid: 'test',
      reasoningEffort: 'high',
      speedTier: 'standard',
    });

    expect(settings.reasoning).toEqual({
      effort: 'high',
      summary: 'auto',
    });
    expect(settings.store).toBe(false);
    expect(settings.providerData).toBeUndefined();
  });

  test('keeps fast in runtime identity for footer and UI state', () => {
    expect(
      buildOpenAiRuntimeIdentity({
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        speedTier: 'fast',
      }),
    ).toMatchObject({
      agentType: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
    });
  });

  test('formats bare Codex backend 400 errors without raw SDK JSON', () => {
    const formatted = formatOpenAiRuntimeError(
      '{ "name": "Error", "message": "400 status code (no body)", "status": 400, "headers": {}, "requestID": null }',
    );

    expect(formatted).toBe(
      'OpenAI runtime request was rejected by Codex backend (400). Check the latest host log for the request id, update and restart cli-claw, then retry.',
    );
    expect(formatted).not.toContain('"headers"');
    expect(formatted).not.toContain('"requestID"');
  });
});
