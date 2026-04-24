import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  getModelPresetOptions,
  type RuntimeAgentType,
  type RuntimePresetOption,
} from './runtime-command-registry.js';

const CODEX_MODELS_CACHE_PATH = path.join(
  os.homedir(),
  '.codex',
  'models_cache.json',
);

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function formatModelLabel(value: string): string {
  return value
    .split('-')
    .map((part) => {
      const normalized = part.toLowerCase();
      if (normalized === 'gpt') return 'GPT';
      if (normalized === 'codex') return 'Codex';
      if (normalized === 'mini') return 'Mini';
      if (normalized === 'spark') return 'Spark';
      if (normalized.startsWith('opus')) return `Opus${part.slice(4)}`;
      if (normalized.startsWith('sonnet')) return `Sonnet${part.slice(6)}`;
      if (normalized.startsWith('haiku')) return `Haiku${part.slice(5)}`;
      return part;
    })
    .join('-');
}

function toRuntimePresetOption(
  value: string,
  label?: string | null,
): RuntimePresetOption {
  return {
    value,
    label: normalizeText(label) ?? formatModelLabel(value),
  };
}

function readCodexModelOptionsFromCache(
  cachePath = CODEX_MODELS_CACHE_PATH,
): RuntimePresetOption[] {
  try {
    if (!fs.existsSync(cachePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
      models?: unknown;
    };
    if (!Array.isArray(parsed.models)) return [];

    const seen = new Set<string>();
    const options: RuntimePresetOption[] = [];
    for (const candidate of parsed.models) {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        continue;
      }
      const entry = candidate as Record<string, unknown>;
      const value = normalizeText(entry.slug);
      if (!value || seen.has(value)) continue;

      const visibility = normalizeText(entry.visibility);
      if (visibility && visibility !== 'list') continue;

      seen.add(value);
      options.push(
        toRuntimePresetOption(value, normalizeText(entry.display_name)),
      );
    }

    return options;
  } catch {
    return [];
  }
}

export function getAvailableRuntimeModelOptions(
  agentType: RuntimeAgentType,
  options: {
    codexModelsCachePath?: string;
  } = {},
): RuntimePresetOption[] {
  if (agentType !== 'codex') {
    return getModelPresetOptions(agentType);
  }

  const discovered = readCodexModelOptionsFromCache(
    options.codexModelsCachePath,
  );
  return discovered.length > 0 ? discovered : getModelPresetOptions('codex');
}

export function getAvailableRuntimeModelPresets(
  agentType: RuntimeAgentType,
  options: {
    codexModelsCachePath?: string;
  } = {},
): string[] {
  return getAvailableRuntimeModelOptions(agentType, options).map(
    (option) => option.value,
  );
}

export function normalizeAvailableRuntimeModelPreset(
  agentType: RuntimeAgentType,
  rawValue: string,
  options: {
    codexModelsCachePath?: string;
  } = {},
): string | null {
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return null;

  return (
    getAvailableRuntimeModelPresets(agentType, options).find(
      (value) => value.toLowerCase() === normalized,
    ) ?? null
  );
}
