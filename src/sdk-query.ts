/**
 * Lightweight Claude Agent SDK wrapper for simple text-in → text-out queries.
 * Replaces all `claude --print` CLI calls so authentication uses the
 * provider configured in the settings page (ANTHROPIC_API_KEY / OAuth / Base URL).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  buildClaudeEnvLines,
  getClaudeProviderConfig,
} from './runtime-config.js';
import { logger } from './logger.js';

// Mutex: process.env mutation is not re-entrant. Serialize concurrent calls
// to prevent overlapping env writes from corrupting each other.
let envLock: Promise<void> = Promise.resolve();

/**
 * Send a prompt to Claude and return the plain-text response.
 * Uses the provider configured in the web settings (not a separate CLI install).
 *
 * @param prompt  The user prompt text
 * @param opts.model   Override model (defaults to provider config)
 * @param opts.timeout Timeout in ms (default 60 000)
 * @returns The assistant's text response, or null on failure
 */
export async function sdkQuery(
  prompt: string,
  opts?: { model?: string; timeout?: number },
): Promise<string | null> {
  // Chain on the lock so only one sdkQuery touches process.env at a time
  let release: () => void;
  const acquired = new Promise<void>((r) => (release = r));
  const prevLock = envLock;
  envLock = acquired;
  await prevLock;

  const timeout = opts?.timeout ?? 60_000;

  // Inject provider credentials into process.env for the SDK
  const config = getClaudeProviderConfig();
  const envLines = buildClaudeEnvLines(config);
  const savedEnv: Record<string, string | undefined> = {};
  for (const line of envLines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeout);

  try {
    const model = opts?.model || config.anthropicModel || undefined;

    let result = '';
    const conversation = query({
      prompt,
      options: {
        ...(model && { model }),
        maxTurns: 1,
        allowedTools: [],
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
        abortController,
      },
    });

    for await (const event of conversation) {
      if (event.type === 'result' && event.subtype === 'success') {
        result = event.result;
      }
    }

    return result.trim() || null;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message?.slice(0, 200) },
      'sdkQuery failed',
    );
    return null;
  } finally {
    clearTimeout(timer);
    // Restore original env
    for (const [key, original] of Object.entries(savedEnv)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    release!();
  }
}
