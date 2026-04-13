import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexCliConfig {
  model: string | null;
  reasoningEffort: string | null;
}

export interface CodexRuntimeFallback {
  model: string | null;
  reasoningEffort: string | null;
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readTomlString(content: string, key: string): string | null {
  const match = content.match(
    new RegExp(`^${key}\\s*=\\s*["']([^"']+)["']\\s*$`, 'm'),
  );
  return normalizeText(match?.[1]);
}

export function readCodexCliConfig(
  configPath = path.join(os.homedir(), '.codex', 'config.toml'),
): CodexCliConfig {
  try {
    if (!fs.existsSync(configPath)) {
      return { model: null, reasoningEffort: null };
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return {
      model: readTomlString(content, 'model'),
      reasoningEffort:
        readTomlString(content, 'model_reasoning_effort') ??
        readTomlString(content, 'reasoning_effort'),
    };
  } catch {
    return { model: null, reasoningEffort: null };
  }
}

export function getCodexRuntimeFallback(
  options: {
    env?: NodeJS.ProcessEnv;
    configPath?: string;
  } = {},
): CodexRuntimeFallback {
  const env = options.env ?? process.env;
  const cliConfig = readCodexCliConfig(options.configPath);
  return {
    model:
      normalizeText(env.OPENAI_MODEL) ??
      normalizeText(env.CODEX_MODEL) ??
      cliConfig.model,
    reasoningEffort:
      normalizeText(env.OPENAI_REASONING_EFFORT) ??
      normalizeText(env.CODEX_REASONING_EFFORT) ??
      normalizeText(env.REASONING_EFFORT) ??
      cliConfig.reasoningEffort,
  };
}
