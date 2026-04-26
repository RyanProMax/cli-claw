export interface CliClawServiceControlContext {
  backendPid?: number | null;
  launchdServiceName?: string | null;
  allowSafeRestartCommand?: boolean;
}

export interface UnsafeCliClawServiceControlMatch {
  matchedText: string;
  reason: string;
  message: string;
}

export const BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE =
  '禁止直接控制正在运行的 Cli Claw 服务；请使用 `cli-claw restart` 或 IM `/self-restart`。';

export const BLOCKED_AGENT_SAFE_RESTART_MESSAGE =
  '禁止由 agent 在 IM 会话中自主执行服务重启；只有用户显式发送 `/self-restart` 或“重启服务”这类受管命令时才能重启。';

const MANAGED_SELF_RESTART_PATTERNS = [
  /^(?:请\s*)?重启(?:一下)?(?:\s*(?:服务|项目|cli[-\s]?claw|cliclaw))?(?:\s*[吧呀啊呢])?$/i,
  /^(?:请\s*)?(?:把\s*)?(?:服务|项目|cli[-\s]?claw|cliclaw)\s*(?:重启|重新启动)(?:一下)?(?:\s*[吧呀啊呢])?$/i,
];

const GENERIC_SERVICE_REFS = [
  'cli-claw',
  'com.ryan.cli-claw',
  'src/index.ts',
  'dist/index.js',
  'bun src/index.ts',
  'node dist/index.js',
];

function normalizeFreeformText(text: string): string {
  return text
    .trim()
    .replace(/^@\S+\s+/, '')
    .replace(/[，。！？、；：]/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeShellCommand(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildServiceRefs(context: CliClawServiceControlContext): string[] {
  const refs = new Set<string>(GENERIC_SERVICE_REFS);
  const serviceName = context.launchdServiceName?.trim();
  if (serviceName) {
    refs.add(serviceName.toLowerCase());
    const label = serviceName.split('/').pop()?.trim();
    if (label) refs.add(label.toLowerCase());
  }
  return [...refs];
}

function matchesAnyRef(normalizedCommand: string, refs: string[]): boolean {
  return refs.some((ref) => normalizedCommand.includes(ref));
}

function matchesBackendPid(
  normalizedCommand: string,
  backendPid: number | null | undefined,
): boolean {
  if (!backendPid || !Number.isFinite(backendPid) || backendPid <= 0) {
    return false;
  }
  const pidPattern = new RegExp(
    `(^|\\D)${escapeRegex(String(backendPid))}(\\D|$)`,
  );
  return pidPattern.test(normalizedCommand);
}

function matchesCliClawSafeRestartCommand(normalizedCommand: string): boolean {
  return (
    /(?:^|[;&|]\s*)(?:\S+\/)?cli-claw\s+restart(?:\s|$)/.test(
      normalizedCommand,
    ) ||
    /\b(?:bun|node|tsx)\s+\S*(?:src\/cli\.ts|dist\/cli\.js)\s+restart(?:\s|$)/.test(
      normalizedCommand,
    )
  );
}

export function resolveManagedSelfRestartCommand(
  text: string,
): 'self-restart' | null {
  const normalized = normalizeFreeformText(text);
  if (!normalized) return null;
  return MANAGED_SELF_RESTART_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  )
    ? 'self-restart'
    : null;
}

export function extractShellCommandText(input: unknown): string | null {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed || null;
  }
  if (!input || typeof input !== 'object') return null;

  for (const key of ['command', 'cmd', 'text', 'script_command']) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function detectUnsafeCliClawServiceControl(
  commandText: string,
  context: CliClawServiceControlContext = {},
): UnsafeCliClawServiceControlMatch | null {
  const normalizedCommand = normalizeShellCommand(commandText);
  if (!normalizedCommand) return null;

  const refs = buildServiceRefs(context);

  if (
    context.allowSafeRestartCommand === false &&
    matchesCliClawSafeRestartCommand(normalizedCommand)
  ) {
    return {
      matchedText: commandText,
      reason: 'agent-initiated cli-claw safe restart command',
      message: BLOCKED_AGENT_SAFE_RESTART_MESSAGE,
    };
  }

  const hasKill = /\bkill\b/.test(normalizedCommand);
  const hasPkill = /\bpkill\b/.test(normalizedCommand);
  const hasKillall = /\bkillall\b/.test(normalizedCommand);
  const hasDangerousLaunchctl =
    /\blaunchctl\b/.test(normalizedCommand) &&
    /\b(bootout|kickstart|stop|remove|disable)\b/.test(normalizedCommand);

  if (hasDangerousLaunchctl && matchesAnyRef(normalizedCommand, refs)) {
    return {
      matchedText: commandText,
      reason: 'direct launchctl control of the cli-claw service',
      message: BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE,
    };
  }

  if (hasKillall && /\b(bun|node|cli-claw)\b/.test(normalizedCommand)) {
    return {
      matchedText: commandText,
      reason: 'broad killall against runtime processes',
      message: BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE,
    };
  }

  if (
    hasPkill &&
    (matchesAnyRef(normalizedCommand, refs) ||
      (/\b-f\b/.test(normalizedCommand) &&
        /\b(bun|node)\b/.test(normalizedCommand)))
  ) {
    return {
      matchedText: commandText,
      reason: 'pattern kill targeting cli-claw runtime processes',
      message: BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE,
    };
  }

  if (hasKill) {
    if (
      matchesBackendPid(normalizedCommand, context.backendPid) ||
      matchesAnyRef(normalizedCommand, refs)
    ) {
      return {
        matchedText: commandText,
        reason: 'direct kill targeting the current cli-claw backend',
        message: BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE,
      };
    }
  }

  return null;
}
