import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  CODEX_BACKEND_BASE_URL,
  getChatGptAccountIdFromToken,
  isJwtExpiring,
  resolveCodexCliRuntimeEnv,
} from '../src/core/runtime/codex-cli-auth.ts';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-codex-auth-'));
  tempDirs.push(dir);
  return dir;
}

function jwtWithClaims(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.signature`;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Codex CLI runtime auth', () => {
  test('extracts ChatGPT account id from Codex access token claims', () => {
    const token = jwtWithClaims({
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_from_token',
      },
    });

    expect(isJwtExpiring(token)).toBe(false);
    expect(getChatGptAccountIdFromToken(token)).toBe('acct_from_token');
  });

  test('builds runner environment from a valid Codex auth.json fallback', async () => {
    const dir = createTempDir();
    const authPath = path.join(dir, 'auth.json');
    const token = jwtWithClaims({
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_from_token',
      },
    });
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: token,
          account_id: 'acct_from_auth_json',
        },
      }),
    );

    const env = await resolveCodexCliRuntimeEnv({
      useAppServer: false,
      codexAuthPath: authPath,
    });

    expect(env).toMatchObject({
      CLI_CLAW_OPENAI_AUTH_MODE: 'codex-cli',
      CLI_CLAW_CODEX_ACCESS_TOKEN: token,
      CLI_CLAW_CODEX_BASE_URL: CODEX_BACKEND_BASE_URL,
      CLI_CLAW_CODEX_AUTH_SOURCE: 'codex-auth-json',
      CLI_CLAW_CODEX_ACCOUNT_ID: 'acct_from_auth_json',
    });
  });

  test('rejects expired Codex auth.json tokens instead of reusing stale login state', async () => {
    const dir = createTempDir();
    const authPath = path.join(dir, 'auth.json');
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: jwtWithClaims({
            exp: Math.floor(Date.now() / 1000) - 60,
          }),
        },
      }),
    );

    await expect(
      resolveCodexCliRuntimeEnv({
        useAppServer: false,
        codexAuthPath: authPath,
      }),
    ).rejects.toThrow('Codex CLI login is required');
  });
});
