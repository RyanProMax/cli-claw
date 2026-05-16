import { OpenAIProvider, setDefaultModelProvider } from '@openai/agents';
import { OpenAI } from 'openai/index.js';

const CODEX_BACKEND_BASE_URL =
  process.env.CLI_CLAW_CODEX_BASE_URL || 'https://chatgpt.com/backend-api/codex';

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function base64UrlDecode(value: string): string {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    .toString('utf8');
}

export function getChatGptAccountIdFromToken(
  accessToken: string,
): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
    const authClaim = claims['https://api.openai.com/auth'];
    if (!authClaim || typeof authClaim !== 'object') return null;
    return normalizeText(
      (authClaim as Record<string, unknown>).chatgpt_account_id as
        | string
        | undefined,
    );
  } catch {
    return null;
  }
}

export function buildCodexCliHeaders(accessToken: string): Record<string, string> {
  const accountId =
    normalizeText(process.env.CLI_CLAW_CODEX_ACCOUNT_ID) ??
    getChatGptAccountIdFromToken(accessToken);
  return {
    'User-Agent': 'codex_cli_rs/0.0.0 (Cli Claw)',
    originator: 'codex_cli_rs',
    ...(accountId ? { 'ChatGPT-Account-ID': accountId } : {}),
  };
}

export function configureCodexCliOpenAiProvider(): void {
  const accessToken = normalizeText(process.env.CLI_CLAW_CODEX_ACCESS_TOKEN);
  if (!accessToken) {
    throw new Error(
      'Codex CLI login is required. Run `codex login` on the host, then retry.',
    );
  }

  const client = new OpenAI({
    apiKey: accessToken,
    baseURL: CODEX_BACKEND_BASE_URL,
    defaultHeaders: buildCodexCliHeaders(accessToken),
  });

  setDefaultModelProvider(
    new OpenAIProvider({
      openAIClient: client,
      useResponses: true,
    }),
  );
}
