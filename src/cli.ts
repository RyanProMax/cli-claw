#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

type CliCommand = 'start' | 'version' | 'help';

export interface CliArgs {
  command: CliCommand;
}

export interface CliDeps {
  start: () => Promise<void> | void;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  version: string;
}

const HELP_TEXT = [
  'Usage: cli-claw <command>',
  '',
  'Commands:',
  '  start',
  '  version',
  '  help',
  '',
  'Options:',
  '  -h, --help',
  '  -v, --version',
].join('\n');

function readPackageVersion(): string {
  const packagePath = new URL('../package.json', import.meta.url);
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
    version?: string;
  };
  return packageJson.version ?? '0.0.0';
}

export function parseCliArgs(argv: string[]): CliArgs {
  const [firstArg] = argv;

  switch (firstArg) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      return { command: 'help' };
    case 'start':
      return { command: 'start' };
    case 'version':
    case '-v':
    case '--version':
      return { command: 'version' };
    default:
      return { command: 'help' };
  }
}

export function formatHelpText(_version: string): string {
  return HELP_TEXT;
}

async function loadBackendStart(): Promise<() => Promise<void> | void> {
  const mod = (await import('./index.js')) as Record<string, unknown>;
  const candidate =
    mod.startCliClaw ?? mod.start ?? mod.main ?? mod.runCliClaw ?? mod.default;

  if (typeof candidate !== 'function') {
    throw new Error(
      'cli-claw backend start export is unavailable; expected a callable start function from src/index.ts',
    );
  }

  return candidate as () => Promise<void> | void;
}

export async function runCli(
  argv: string[],
  deps: Partial<CliDeps> = {},
): Promise<number> {
  const parsed = parseCliArgs(argv);
  const version = deps.version ?? readPackageVersion();
  const stdout = deps.stdout ?? ((line: string) => console.log(line));
  const stderr = deps.stderr ?? ((line: string) => console.error(line));

  if (parsed.command === 'version') {
    stdout(version);
    return 0;
  }

  if (parsed.command === 'help') {
    stdout(formatHelpText(version));
    return 0;
  }

  try {
    const start = deps.start ?? (await loadBackendStart());
    await start();
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(message);
    return 1;
  }
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const exitCode = await runCli(argv);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
