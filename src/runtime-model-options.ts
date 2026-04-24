import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  getModelPresetOptions,
  type RuntimeAgentType,
  type RuntimePresetOption,
} from './runtime-command-registry.js';
import { buildHostRuntimePath } from './codex-config.js';

const CODEX_MODELS_CACHE_PATH = path.join(
  os.homedir(),
  '.codex',
  'models_cache.json',
);
const CODEX_CLI_MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
const CODEX_CLI_MODEL_DISCOVERY_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export type RuntimeModelOptionsSource = 'codex-cli' | 'codex-cache' | 'preset';

export interface RuntimeModelOptionsResult {
  options: RuntimePresetOption[];
  source: RuntimeModelOptionsSource;
}

export interface RuntimeModelOptionsDiscoveryOptions {
  codexModelsCachePath?: string;
  currentModel?: string | null;
  disableCodexCliCatalog?: boolean;
  codexCommand?: string;
  codexCliTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  execFileSyncFn?: typeof execFileSync;
}

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

function readCodexModelOptionsFromCatalog(
  parsed: unknown,
): RuntimePresetOption[] {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }
  const catalog = parsed as { models?: unknown };
  if (!Array.isArray(catalog.models)) return [];

  const seen = new Set<string>();
  const options: RuntimePresetOption[] = [];
  for (const candidate of catalog.models) {
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
}

function readCodexModelOptionsFromCli(
  options: RuntimeModelOptionsDiscoveryOptions = {},
): RuntimePresetOption[] {
  if (options.disableCodexCliCatalog) return [];

  const execFileSyncFn = options.execFileSyncFn || execFileSync;
  const env = { ...process.env, ...options.env };
  env.PATH = buildHostRuntimePath({
    pathValue: env.PATH,
    homeDir: env.HOME,
  });

  try {
    const output = execFileSyncFn(
      options.codexCommand ?? 'codex',
      ['debug', 'models'],
      {
        env,
        timeout:
          options.codexCliTimeoutMs ?? CODEX_CLI_MODEL_DISCOVERY_TIMEOUT_MS,
        maxBuffer: CODEX_CLI_MODEL_DISCOVERY_MAX_BUFFER_BYTES,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      },
    );
    return readCodexModelOptionsFromCatalog(JSON.parse(String(output)));
  } catch {
    return [];
  }
}

function readCodexModelOptionsFromCache(
  cachePath = CODEX_MODELS_CACHE_PATH,
): RuntimePresetOption[] {
  try {
    if (!fs.existsSync(cachePath)) return [];
    return readCodexModelOptionsFromCatalog(
      JSON.parse(fs.readFileSync(cachePath, 'utf8')),
    );
  } catch {
    return [];
  }
}

function includeCurrentModelOption(
  options: RuntimePresetOption[],
  currentModel: string | null | undefined,
): RuntimePresetOption[] {
  const current = normalizeText(currentModel);
  if (!current) return options;
  if (
    options.some(
      (option) => option.value.toLowerCase() === current.toLowerCase(),
    )
  ) {
    return options;
  }
  const currentOption = toRuntimePresetOption(current);
  return [
    { ...currentOption, label: `${currentOption.label} (current)` },
    ...options,
  ];
}

export function getAvailableRuntimeModelCatalog(
  agentType: RuntimeAgentType,
  options: RuntimeModelOptionsDiscoveryOptions = {},
): RuntimeModelOptionsResult {
  if (agentType !== 'codex') {
    return {
      options: getModelPresetOptions(agentType),
      source: 'preset',
    };
  }

  const cliOptions = readCodexModelOptionsFromCli(options);
  if (cliOptions.length > 0) {
    return {
      options: includeCurrentModelOption(cliOptions, options.currentModel),
      source: 'codex-cli',
    };
  }

  const cachedOptions = readCodexModelOptionsFromCache(
    options.codexModelsCachePath,
  );
  if (cachedOptions.length > 0) {
    return {
      options: includeCurrentModelOption(cachedOptions, options.currentModel),
      source: 'codex-cache',
    };
  }

  return {
    options: includeCurrentModelOption(
      getModelPresetOptions('codex'),
      options.currentModel,
    ),
    source: 'preset',
  };
}

export function getAvailableRuntimeModelOptions(
  agentType: RuntimeAgentType,
  options: RuntimeModelOptionsDiscoveryOptions = {},
): RuntimePresetOption[] {
  return getAvailableRuntimeModelCatalog(agentType, options).options;
}

export function getAvailableRuntimeModelPresets(
  agentType: RuntimeAgentType,
  options: RuntimeModelOptionsDiscoveryOptions = {},
): string[] {
  return getAvailableRuntimeModelOptions(agentType, options).map(
    (option) => option.value,
  );
}

export function normalizeAvailableRuntimeModelPreset(
  agentType: RuntimeAgentType,
  rawValue: string,
  options: RuntimeModelOptionsDiscoveryOptions = {},
): string | null {
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return null;

  return (
    getAvailableRuntimeModelPresets(agentType, options).find(
      (value) => value.toLowerCase() === normalized,
    ) ?? null
  );
}
