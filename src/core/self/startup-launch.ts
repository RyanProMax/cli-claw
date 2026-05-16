import fs from 'node:fs';
import path from 'node:path';

export type StartupLaunchSource = 'cli_start' | 'direct_backend' | 'unknown';
export type StartupLaunchArtifactMode = 'source' | 'build' | 'unknown';

export interface StartupLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  source: StartupLaunchSource;
  artifactMode: StartupLaunchArtifactMode;
  restartable: boolean;
  validationError: string | null;
  displayCommand: string;
}

interface LaunchSpecInput {
  command?: string | null;
  args?: string[] | null;
  cwd?: string | null;
  source?: StartupLaunchSource | null;
}

interface DirectBackendLaunchInput {
  execPath?: string | null;
  argv?: string[] | null;
  cwd?: string | null;
}

interface CliStartLaunchInput {
  execPath?: string | null;
  argvEntry?: string | null;
  cwd?: string | null;
}

function normalizePathLike(value: string | null | undefined): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  try {
    return fs.realpathSync(text);
  } catch {
    return path.resolve(text);
  }
}

function normalizeArgs(args: string[] | null | undefined): string[] {
  if (!Array.isArray(args)) return [];
  return args
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function quoteShellArg(value: string): string {
  return /[\s"'\\]/.test(value) ? JSON.stringify(value) : value;
}

function formatLaunchCommand(command: string, args: string[]): string {
  return [command, ...args].filter(Boolean).map(quoteShellArg).join(' ');
}

function matchesPathSuffix(arg: string | undefined, suffix: string[]): boolean {
  if (!arg) return false;
  const normalized = arg.replace(/\\/g, path.sep);
  const suffixPath = suffix.join(path.sep);
  return (
    normalized === suffixPath || normalized.endsWith(path.sep + suffixPath)
  );
}

function looksLikeCliEntrypoint(arg: string | undefined): boolean {
  if (!arg) return false;
  return (
    matchesPathSuffix(arg, ['dist', 'cli.js']) ||
    matchesPathSuffix(arg, ['src', 'cli.ts']) ||
    /(?:^|[/\\])cli-claw(?:\.js)?$/.test(arg)
  );
}

function looksLikeBackendEntrypoint(arg: string | undefined): boolean {
  if (!arg) return false;
  return (
    matchesPathSuffix(arg, ['src', 'index.ts']) ||
    matchesPathSuffix(arg, ['dist', 'index.js']) ||
    /(?:^|[/\\])index\.(?:ts|js)$/.test(arg)
  );
}

function inferArtifactMode(args: string[]): StartupLaunchArtifactMode {
  const entry = args[0] ?? '';
  if (
    matchesPathSuffix(entry, ['src', 'cli.ts']) ||
    matchesPathSuffix(entry, ['src', 'index.ts'])
  ) {
    return 'source';
  }
  if (
    matchesPathSuffix(entry, ['dist', 'cli.js']) ||
    matchesPathSuffix(entry, ['dist', 'index.js'])
  ) {
    return 'build';
  }
  return 'unknown';
}

function inferLaunchSource(args: string[]): StartupLaunchSource {
  if (
    args.length >= 2 &&
    args[1] === 'start' &&
    looksLikeCliEntrypoint(args[0])
  ) {
    return 'cli_start';
  }
  if (args.length >= 1 && looksLikeBackendEntrypoint(args[0])) {
    return 'direct_backend';
  }
  return 'unknown';
}

function validateLaunchSpec(
  source: StartupLaunchSource,
  args: string[],
): string | null {
  if (source === 'cli_start') {
    if (args.length === 0) {
      return 'missing cli launcher entrypoint';
    }
    if (!looksLikeCliEntrypoint(args[0])) {
      return `unrecognized cli launcher entrypoint: ${args[0]}`;
    }
    if (args[1] !== 'start') {
      return 'cli restart launch spec must include the start subcommand';
    }
    return null;
  }

  if (source === 'direct_backend') {
    if (args.length === 0) {
      return 'missing backend entrypoint';
    }
    if (!looksLikeBackendEntrypoint(args[0])) {
      return `unrecognized backend entrypoint: ${args[0]}`;
    }
    return null;
  }

  if (args.length === 0) {
    return 'missing backend entrypoint';
  }

  return `unrecognized cli-claw launch shape: ${args.join(' ')}`;
}

export function createStartupLaunchSpec(
  input: LaunchSpecInput,
): StartupLaunchSpec {
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  const args = normalizeArgs(input.args);
  const cwd = normalizePathLike(input.cwd);
  const source = input.source || inferLaunchSource(args);
  const artifactMode = inferArtifactMode(args);
  const validationError =
    command.length === 0
      ? 'missing launch command'
      : validateLaunchSpec(source, args);

  return {
    command,
    args,
    cwd,
    source,
    artifactMode,
    restartable: validationError === null,
    validationError,
    displayCommand: formatLaunchCommand(command, args),
  };
}

export function inferDirectBackendLaunchSpec(
  input: DirectBackendLaunchInput = {},
): StartupLaunchSpec {
  const argv = normalizeArgs(input.argv);
  return createStartupLaunchSpec({
    command: input.execPath ?? argv[0] ?? '',
    args: argv.slice(1),
    cwd: input.cwd ?? process.cwd(),
    source: 'direct_backend',
  });
}

export function createCliStartLaunchSpec(
  input: CliStartLaunchInput = {},
): StartupLaunchSpec {
  const argvEntry =
    typeof input.argvEntry === 'string' ? input.argvEntry.trim() : '';
  return createStartupLaunchSpec({
    command: input.execPath ?? process.execPath,
    args: argvEntry ? [argvEntry, 'start'] : [],
    cwd: input.cwd ?? process.cwd(),
    source: 'cli_start',
  });
}

export function inferStartupLaunchSpecFromProcess(
  input: DirectBackendLaunchInput = {},
): StartupLaunchSpec {
  const argv = normalizeArgs(input.argv ?? process.argv);
  if (
    argv.length >= 3 &&
    argv[2] === 'start' &&
    looksLikeCliEntrypoint(argv[1])
  ) {
    return createCliStartLaunchSpec({
      execPath: input.execPath ?? process.execPath,
      argvEntry: argv[1],
      cwd: input.cwd ?? process.cwd(),
    });
  }

  return inferDirectBackendLaunchSpec({
    execPath: input.execPath ?? process.execPath,
    argv,
    cwd: input.cwd ?? process.cwd(),
  });
}
