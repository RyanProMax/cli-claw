import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  clearOpenAiCodexUsageCacheForTests,
  getOpenAiCodexUsageSnapshot,
  resolveOpenAiCodexProxyUrl,
  resolveOpenAiCodexUsageUrl,
} from '../../../../src/core/runtime/openai-codex-usage.ts';

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe('OpenAI Codex usage snapshot', () => {
  beforeEach(() => {
    clearOpenAiCodexUsageCacheForTests();
  });

  test('resolves the ChatGPT Codex backend usage URL', () => {
    expect(
      resolveOpenAiCodexUsageUrl('https://chatgpt.com/backend-api/codex'),
    ).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(
      resolveOpenAiCodexUsageUrl('https://chatgpt.com/backend-api/codex/'),
    ).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(resolveOpenAiCodexUsageUrl('https://proxy.example.test')).toBe(
      'https://proxy.example.test/api/codex/usage',
    );
  });

  test('resolves proxy settings for the Codex usage request', () => {
    expect(
      resolveOpenAiCodexProxyUrl('https://chatgpt.com/backend-api/wham/usage', {
        HTTPS_PROXY: 'http://127.0.0.1:7897',
        NO_PROXY: 'localhost,127.0.0.1',
      }),
    ).toBe('http://127.0.0.1:7897');
    expect(
      resolveOpenAiCodexProxyUrl('https://chatgpt.com/backend-api/wham/usage', {
        HTTPS_PROXY: 'http://127.0.0.1:7897',
        NO_PROXY: '.chatgpt.com',
      }),
    ).toBeNull();
  });

  test('fetches usage through the Codex CLI login state and maps rate-limit windows', async () => {
    const fetchUsage = vi.fn(async () =>
      jsonResponse({
        plan_type: 'plus',
        rate_limit: {
          primary_window: {
            used_percent: 37,
            reset_at: '2026-05-17T12:00:00Z',
          },
          secondary_window: {
            used_percent: 12.5,
            reset_at: 1_779_273_600,
          },
        },
        credits: {
          has_credits: true,
          balance: 5.25,
        },
      }),
    );

    const result = await getOpenAiCodexUsageSnapshot({
      fetchUsage,
      now: () => 1_000,
      resolveAuth: async () => ({
        accessToken: 'codex-token',
        accountId: 'acct_123',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        source: 'codex-app-server',
      }),
    });

    expect(fetchUsage).toHaveBeenCalledOnce();
    expect(fetchUsage).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer codex-token',
          'ChatGPT-Account-ID': 'acct_123',
          'User-Agent': 'codex_cli_rs/0.0.0 (Cli Claw)',
          originator: 'codex_cli_rs',
        },
      },
    );
    expect(result).toMatchObject({
      provider: 'openai',
      available: true,
      source: 'Codex usage API',
      primaryUsagePct: 37,
      secondaryUsagePct: 12.5,
      primaryRemainingPct: 63,
      secondaryRemainingPct: 87.5,
      primaryResetAt: '2026-05-17T12:00:00Z',
      secondaryResetAt: '2026-05-20T10:40:00.000Z',
    });
  });

  test('caches successful snapshots for the short usage TTL', async () => {
    const fetchUsage = vi.fn(async () =>
      jsonResponse({
        rate_limit: {
          primary_window: { used_percent: 10 },
          secondary_window: { used_percent: 20 },
        },
      }),
    );

    const deps = {
      fetchUsage,
      resolveAuth: async () => ({
        accessToken: 'codex-token',
        accountId: 'acct_123',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        source: 'codex-auth-json' as const,
      }),
    };

    const first = await getOpenAiCodexUsageSnapshot({
      ...deps,
      now: () => 1_000,
    });
    const second = await getOpenAiCodexUsageSnapshot({
      ...deps,
      now: () => 2_000,
    });

    expect(fetchUsage).toHaveBeenCalledOnce();
    expect(second).toEqual(first);
  });

  test('returns unavailable when auth or the usage endpoint fails', async () => {
    await expect(
      getOpenAiCodexUsageSnapshot({
        resolveAuth: async () => {
          throw new Error('Codex CLI login is required');
        },
      }),
    ).resolves.toMatchObject({
      provider: 'openai',
      available: false,
      source: 'Codex usage API',
      reason: 'Codex CLI login is required',
    });

    await expect(
      getOpenAiCodexUsageSnapshot({
        fetchUsage: async () => jsonResponse({}, 500),
        resolveAuth: async () => ({
          accessToken: 'codex-token',
          baseURL: 'https://chatgpt.com/backend-api/codex',
          source: 'codex-auth-json',
        }),
      }),
    ).resolves.toMatchObject({
      provider: 'openai',
      available: false,
      source: 'Codex usage API',
      reason: 'Codex usage API returned 500',
    });
  });
});
