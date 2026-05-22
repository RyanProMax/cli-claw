import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import { GROUPS_DIR } from '../core/config.js';
import { resolveEffectiveWorkspaceCwd } from '../core/workspace/workspace-cwd.js';
import { type RuntimeCommandEntrypoint } from '../core/runtime/command-registry.js';
import { validateSkillPath } from './utils.js';
import type { RegisteredGroup } from '../domain/types.js';

interface SkillCommandExecutor {
  command: string;
  args: string[];
}

interface RawSkillCommandManifest {
  version?: unknown;
  commands?: Record<string, unknown>;
}

interface RawSkillCommandDefinition {
  description?: unknown;
  argumentHint?: unknown;
  argument_hint?: unknown;
  usage?: unknown;
  entrypoints?: unknown;
  executor?: {
    command?: unknown;
    args?: unknown;
  };
}

export interface DiscoveredSkillCommand {
  name: string;
  description: string;
  entrypoints: RuntimeCommandEntrypoint[];
  skillId: string;
  skillDir: string;
  sourceRoot: string;
  priority: number;
  executor: SkillCommandExecutor;
  argumentHint: string | null;
}

export interface SkillCommandDiscoveryResult {
  commands: DiscoveredSkillCommand[];
  errors: string[];
}

export interface SkillCommandWorkspaceRef {
  jid: string;
  folder: string;
  name: string;
}

interface SkillCommandExecutorPayload {
  version: 1;
  command: string;
  entrypoint: RuntimeCommandEntrypoint;
  chatJid: string;
  argsText: string;
  args: string[];
  workspace: SkillCommandWorkspaceRef;
  issuedAt: string;
}

interface SkillCommandExecutorResponse {
  reply?:
    | string
    | {
        type?: unknown;
        content?: unknown;
        prompt?: unknown;
        workflowId?: unknown;
        input?: unknown;
        ack?: unknown;
      };
  error?: unknown;
}

export type SkillCommandExecutionResult =
  | {
      kind: 'final_markdown';
      content: string;
    }
  | {
      kind: 'assistant_prompt';
      prompt: string;
      ack: string | null;
    }
  | {
      kind: 'workflow';
      workflowId: string;
      prompt: string;
      input: Record<string, unknown>;
      ack: string | null;
    }
  | {
      kind: 'error';
      content: string;
    };

function normalizeCommandName(value: string): string {
  return value.trim().toLowerCase();
}

function isSupportedEntrypoint(
  value: unknown,
): value is RuntimeCommandEntrypoint {
  return value === 'im' || value === 'web';
}

function normalizeArgumentHint(
  commandName: string,
  rawValue: string,
): string | null {
  const hint = rawValue.trim();
  if (!hint) return null;

  const commandPrefix = `/${commandName}`;
  if (hint === commandPrefix) return null;
  if (hint.startsWith(`${commandPrefix} `)) {
    return hint.slice(commandPrefix.length).trim() || null;
  }
  return hint;
}

function parseManifestCommand(
  skillId: string,
  skillDir: string,
  sourceRoot: string,
  priority: number,
  rawName: string,
  rawDefinition: unknown,
): DiscoveredSkillCommand | null {
  const name = normalizeCommandName(rawName);
  if (!/^[a-z_][a-z0-9_-]*$/i.test(name)) return null;

  const definition = rawDefinition as RawSkillCommandDefinition;
  const description =
    typeof definition?.description === 'string'
      ? definition.description.trim()
      : '';
  const entrypoints = Array.isArray(definition?.entrypoints)
    ? definition.entrypoints.filter(isSupportedEntrypoint)
    : [];
  const executorCommand =
    typeof definition?.executor?.command === 'string'
      ? definition.executor.command.trim()
      : '';
  const executorArgs = Array.isArray(definition?.executor?.args)
    ? definition.executor.args.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  const rawArgumentHint =
    typeof definition?.argumentHint === 'string'
      ? definition.argumentHint
      : typeof definition?.argument_hint === 'string'
        ? definition.argument_hint
        : typeof definition?.usage === 'string'
          ? definition.usage
          : '';
  const argumentHint = normalizeArgumentHint(name, rawArgumentHint);

  if (!description || entrypoints.length === 0 || !executorCommand) {
    return null;
  }

  return {
    name,
    description,
    entrypoints,
    skillId,
    skillDir,
    sourceRoot,
    priority,
    executor: {
      command: executorCommand,
      args: executorArgs,
    },
    argumentHint,
  };
}

function parseSkillCommandManifest(
  skillId: string,
  skillDir: string,
  sourceRoot: string,
  priority: number,
): DiscoveredSkillCommand[] {
  const manifestPath = path.join(skillDir, 'commands.json');
  if (!fs.existsSync(manifestPath)) return [];

  try {
    const raw = JSON.parse(
      fs.readFileSync(manifestPath, 'utf-8'),
    ) as RawSkillCommandManifest;
    if (
      raw.version !== 1 ||
      !raw.commands ||
      typeof raw.commands !== 'object'
    ) {
      return [];
    }

    return Object.entries(raw.commands)
      .map(([rawName, rawDefinition]) =>
        parseManifestCommand(
          skillId,
          skillDir,
          sourceRoot,
          priority,
          rawName,
          rawDefinition,
        ),
      )
      .filter((command): command is DiscoveredSkillCommand => Boolean(command));
  } catch {
    return [];
  }
}

function resolveSkillExecutorArgument(skillDir: string, value: string): string {
  if (!value || value.startsWith('-') || path.isAbsolute(value)) {
    return value;
  }

  const candidate = path.join(skillDir, value);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return value;
}

function isBarePythonExecutor(command: string): boolean {
  return (
    command === 'python' ||
    command === 'python3' ||
    command === 'python.exe' ||
    command === 'python3.exe'
  );
}

function resolveSkillVenvPython(skillDir: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(skillDir, '.venv', 'Scripts', 'python.exe'),
          path.join(skillDir, '.venv', 'Scripts', 'python'),
        ]
      : [path.join(skillDir, '.venv', 'bin', 'python')];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function parseSkillEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex <= 0) return null;

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

function readSkillEnvFile(skillDir: string): Record<string, string> {
  const envPath = path.join(skillDir, '.env');
  if (!fs.existsSync(envPath)) return {};

  try {
    const values: Record<string, string> = {};
    for (const rawLine of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const parsed = parseSkillEnvLine(rawLine);
      if (!parsed) continue;
      const [key, value] = parsed;
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function resolveSkillExecutor(
  command: DiscoveredSkillCommand,
): SkillCommandExecutor {
  const resolvedCommand = path.isAbsolute(command.executor.command)
    ? command.executor.command
    : isBarePythonExecutor(command.executor.command)
      ? (resolveSkillVenvPython(command.skillDir) ??
        resolveSkillExecutorArgument(
          command.skillDir,
          command.executor.command,
        ))
      : resolveSkillExecutorArgument(
          command.skillDir,
          command.executor.command,
        );

  return {
    command: resolvedCommand,
    args: command.executor.args.map((value) =>
      resolveSkillExecutorArgument(command.skillDir, value),
    ),
  };
}

function findCommandConflictMessage(
  discovered: SkillCommandDiscoveryResult,
  commandName: string,
): string | null {
  const needle = `/${normalizeCommandName(commandName)}`;
  return discovered.errors.find((message) => message.includes(needle)) ?? null;
}

function findDiscoveredSkillCommand(
  discovered: SkillCommandDiscoveryResult,
  commandName: string,
): DiscoveredSkillCommand | null {
  const normalized = normalizeCommandName(commandName);
  return (
    discovered.commands.find((command) => command.name === normalized) ?? null
  );
}

function normalizeWorkflowInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function discoverSkillCommands(options: {
  entrypoint: RuntimeCommandEntrypoint;
  roots: string[];
}): Promise<SkillCommandDiscoveryResult> {
  const chosenCommands = new Map<
    string,
    { priority: number; commands: DiscoveredSkillCommand[] }
  >();

  for (const [priority, rootDir] of options.roots.entries()) {
    if (!rootDir || !fs.existsSync(rootDir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(rootDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillDir = path.join(rootDir, entry.name);
      if (!validateSkillPath(rootDir, skillDir)) continue;
      if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue;

      for (const command of parseSkillCommandManifest(
        entry.name,
        skillDir,
        rootDir,
        priority,
      )) {
        if (!command.entrypoints.includes(options.entrypoint)) continue;

        const existing = chosenCommands.get(command.name);
        if (!existing || priority < existing.priority) {
          chosenCommands.set(command.name, {
            priority,
            commands: [command],
          });
          continue;
        }

        if (priority === existing.priority) {
          existing.commands.push(command);
        }
      }
    }
  }

  const commands: DiscoveredSkillCommand[] = [];
  const errors: string[] = [];

  for (const [commandName, selection] of [...chosenCommands.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (selection.commands.length === 1) {
      commands.push(selection.commands[0]);
      continue;
    }

    const skillIds = selection.commands
      .map((command) => command.skillId)
      .sort((left, right) => left.localeCompare(right));
    errors.push(
      `命令 /${commandName} 同时由多个启用技能声明：${skillIds.join(', ')}`,
    );
  }

  return { commands, errors };
}

export function formatSkillCommandHelpLines(
  commands: DiscoveredSkillCommand[],
): string[] {
  return [...commands]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((command) => {
      const usage = command.argumentHint
        ? `/${command.name} ${command.argumentHint}`
        : `/${command.name}`;
      return `- ${usage}：${command.description}`;
    });
}

function executeSkillCommandProcess(
  command: DiscoveredSkillCommand,
  payload: SkillCommandExecutorPayload,
): Promise<string> {
  const resolvedExecutor = resolveSkillExecutor(command);
  const skillEnv = readSkillEnvFile(command.skillDir);

  return new Promise((resolve, reject) => {
    const child = spawn(resolvedExecutor.command, resolvedExecutor.args, {
      cwd: command.skillDir,
      env: {
        ...skillEnv,
        ...process.env,
        CLI_CLAW_COMMAND: command.name,
        CLI_CLAW_SKILL_ID: command.skillId,
        CLI_CLAW_SKILL_DIR: command.skillDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `executor exited with code ${code ?? 'unknown'}`,
          ),
        );
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function executeDiscoveredSkillCommand(options: {
  commandName: string;
  discovered: SkillCommandDiscoveryResult;
  entrypoint: RuntimeCommandEntrypoint;
  chatJid: string;
  argsText: string;
  args: string[];
  workspace: SkillCommandWorkspaceRef;
}): Promise<string> {
  const result = await executeDiscoveredSkillCommandResult(options);
  if (result.kind === 'final_markdown' || result.kind === 'error') {
    return result.content;
  }

  return (
    result.ack ??
    `已触发技能命令 /${normalizeCommandName(options.commandName)}，开始执行分析`
  );
}

export async function executeDiscoveredSkillCommandResult(options: {
  commandName: string;
  discovered: SkillCommandDiscoveryResult;
  entrypoint: RuntimeCommandEntrypoint;
  chatJid: string;
  argsText: string;
  args: string[];
  workspace: SkillCommandWorkspaceRef;
}): Promise<SkillCommandExecutionResult> {
  const conflictMessage = findCommandConflictMessage(
    options.discovered,
    options.commandName,
  );
  if (conflictMessage) {
    return { kind: 'error', content: conflictMessage };
  }

  const command = findDiscoveredSkillCommand(
    options.discovered,
    options.commandName,
  );
  if (!command) {
    return {
      kind: 'error',
      content: `未找到技能命令 /${normalizeCommandName(options.commandName)}`,
    };
  }

  try {
    const stdout = await executeSkillCommandProcess(command, {
      version: 1,
      command: command.name,
      entrypoint: options.entrypoint,
      chatJid: options.chatJid,
      argsText: options.argsText,
      args: options.args,
      workspace: options.workspace,
      issuedAt: new Date().toISOString(),
    });

    const parsed = JSON.parse(stdout) as SkillCommandExecutorResponse;
    if (typeof parsed.reply === 'string' && parsed.reply.trim()) {
      return { kind: 'final_markdown', content: parsed.reply };
    }

    if (
      parsed.reply &&
      typeof parsed.reply === 'object' &&
      (typeof parsed.reply.content === 'string' ||
        typeof parsed.reply.prompt === 'string')
    ) {
      const content =
        typeof parsed.reply.content === 'string'
          ? parsed.reply.content
          : typeof parsed.reply.prompt === 'string'
            ? parsed.reply.prompt
            : '';
      if (parsed.reply.type === 'assistant_prompt') {
        if (!content.trim()) {
          return {
            kind: 'error',
            content: `技能命令 /${command.name} 没有返回可展示的结果`,
          };
        }
        return {
          kind: 'assistant_prompt',
          prompt: content,
          ack:
            typeof parsed.reply.ack === 'string' && parsed.reply.ack.trim()
              ? parsed.reply.ack
              : null,
        };
      }

      if (
        parsed.reply.type === 'workflow' &&
        typeof parsed.reply.workflowId === 'string' &&
        parsed.reply.workflowId.trim()
      ) {
        return {
          kind: 'workflow',
          workflowId: parsed.reply.workflowId.trim(),
          prompt: content.trim(),
          input: normalizeWorkflowInput(parsed.reply.input),
          ack:
            typeof parsed.reply.ack === 'string' && parsed.reply.ack.trim()
              ? parsed.reply.ack
              : null,
        };
      }

      if (parsed.reply.type === 'final_markdown') {
        if (!content.trim()) {
          return {
            kind: 'error',
            content: `技能命令 /${command.name} 没有返回可展示的结果`,
          };
        }
        return {
          kind: 'final_markdown',
          content,
        };
      }
    }

    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return { kind: 'error', content: parsed.error };
    }

    return {
      kind: 'error',
      content: `技能命令 /${command.name} 没有返回可展示的结果`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.trim() : String(error).trim();
    return {
      kind: 'error',
      content: `技能命令 /${command.name} 执行失败：${message || 'unknown error'}`,
    };
  }
}

export function resolveSkillCommandRoots(options: {
  workspaceGroup: RegisteredGroup;
  homeGroup?: RegisteredGroup | null;
}): string[] {
  const roots: string[] = [];
  const workspaceRoot =
    resolveEffectiveWorkspaceCwd(
      options.workspaceGroup,
      options.homeGroup ?? undefined,
    ) ?? path.join(GROUPS_DIR, options.workspaceGroup.folder);

  roots.push(path.join(workspaceRoot, '.agents', 'skills'));

  return roots;
}
