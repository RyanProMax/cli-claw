import { beforeEach, describe, expect, test, vi } from 'vitest';

const { resolveCodexCliRuntimeAuthMock } = vi.hoisted(() => ({
  resolveCodexCliRuntimeAuthMock: vi.fn(),
}));

vi.mock('../../../src/core/runtime/codex-cli-auth.js', () => ({
  resolveCodexCliRuntimeAuth: resolveCodexCliRuntimeAuthMock,
}));

import { sdkQuery } from '../../../src/agent/runner/sdk-query.ts';

describe('sdkQuery', () => {
  beforeEach(() => {
    resolveCodexCliRuntimeAuthMock.mockReset();
    vi.unstubAllGlobals();
  });

  test('uses Codex CLI auth to call the OpenAI responses endpoint', async () => {
    resolveCodexCliRuntimeAuthMock.mockResolvedValue({
      accessToken: 'codex-token',
      accountId: 'acct-1',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      source: 'codex-auth-json',
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: ' bug summary ' }],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sdkQuery('summarize bug', { model: 'gpt-5.4' })).resolves.toBe(
      'bug summary',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer codex-token',
          'ChatGPT-Account-ID': 'acct-1',
          originator: 'codex_cli_rs',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: 'gpt-5.4',
      store: false,
    });
    expect(JSON.stringify(body.input)).toContain('summarize bug');
  });

  test('returns null when Codex CLI auth is unavailable', async () => {
    resolveCodexCliRuntimeAuthMock.mockRejectedValue(new Error('login needed'));
    vi.stubGlobal('fetch', vi.fn());

    await expect(sdkQuery('summarize bug')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
