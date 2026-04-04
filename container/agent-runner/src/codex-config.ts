import fs from 'fs';
import os from 'os';
import path from 'path';

export interface CodexCliConfig {
  model: string | null;
  reasoningEffort: string | null;
}

function normalizeTomlString(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readTomlString(content: string, key: string): string | null {
  const match = content.match(
    new RegExp(`^${key}\\s*=\\s*["']([^"']+)["']\\s*$`, 'm'),
  );
  return normalizeTomlString(match?.[1]);
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
