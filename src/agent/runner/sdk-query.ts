import {
  resolveCodexCliRuntimeAuth,
  type CodexCliRuntimeAuth,
} from '../../core/runtime/codex-cli-auth.js';
import { logger } from '../../core/logger.js';

const DEFAULT_MODEL = 'gpt-5.4';

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function buildResponsesUrl(auth: CodexCliRuntimeAuth): string {
  return `${auth.baseURL.replace(/\/+$/, '')}/responses`;
}

function buildHeaders(auth: CodexCliRuntimeAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'codex_cli_rs/0.0.0 (Agent Fabric)',
    originator: 'codex_cli_rs',
    ...(auth.accountId ? { 'ChatGPT-Account-ID': auth.accountId } : {}),
  };
}

function collectTextFromContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const text = normalizeText(record.text) ?? normalizeText(record.refusal);
    if (text) parts.push(text);
  }
  return parts;
}

function extractResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  const outputText = normalizeText(record.output_text);
  if (outputText) return outputText;

  const parts: string[] = [];
  if (Array.isArray(record.output)) {
    for (const item of record.output) {
      if (!item || typeof item !== 'object') continue;
      parts.push(
        ...collectTextFromContent((item as Record<string, unknown>).content),
      );
    }
  }

  if (Array.isArray(record.choices)) {
    for (const choice of record.choices) {
      if (!choice || typeof choice !== 'object') continue;
      const message = (choice as Record<string, unknown>).message;
      if (!message || typeof message !== 'object') continue;
      const content = (message as Record<string, unknown>).content;
      const text = normalizeText(content);
      if (text) parts.push(text);
    }
  }

  return normalizeText(parts.join('\n\n'));
}

/**
 * Send a prompt through the Codex CLI login-backed OpenAI backend and return
 * the plain-text response.
 *
 * @param prompt  The user prompt text
 * @param opts.model   Override model
 * @param opts.timeout Timeout in ms (default 60 000)
 * @returns The assistant's text response, or null on failure
 */
export async function sdkQuery(
  prompt: string,
  opts?: { model?: string; timeout?: number },
): Promise<string | null> {
  const timeout = opts?.timeout ?? 60_000;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeout);

  try {
    const auth = await resolveCodexCliRuntimeAuth();
    const model = normalizeText(opts?.model) ?? DEFAULT_MODEL;
    const response = await fetch(buildResponsesUrl(auth), {
      method: 'POST',
      headers: buildHeaders(auth),
      signal: abortController.signal,
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI backend returned ${response.status}`);
    }

    const payload = await response.json();
    return extractResponseText(payload);
  } catch (err) {
    logger.warn(
      {
        err: (err as Error).message?.slice(0, 200),
      },
      'sdkQuery failed',
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
