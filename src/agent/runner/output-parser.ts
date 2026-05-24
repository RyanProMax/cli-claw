/**
 * Shared output parsing and process lifecycle logic for the agent process runner.
 */
import fs from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { serializeErrorForOutput } from '../../../shared/dist/error-serialization.js';

import { getSystemSettings } from '../../core/runtime/config.js';
import { logger } from '../../core/logger.js';
import type { AgentProcessOutput } from './container-runner.js';

// Sentinel markers for robust output parsing (must match agent-runner)
export const OUTPUT_START_MARKER = '---CLI_CLAW_OUTPUT_START---';
export const OUTPUT_END_MARKER = '---CLI_CLAW_OUTPUT_END---';

// ─── Stdout Stream Parser ────────────────────────────────────────────

export interface StdoutParserState {
  stdout: string;
  stdoutTruncated: boolean;
  parseBuffer: string;
  newSessionId: string | undefined;
  outputChain: Promise<void>;
  lastErrorOutput: AgentProcessOutput | null;
  hasSuccessOutput: boolean;
  /** True when agent emitted a { status: 'closed' } marker (exit due to _close sentinel). */
  hasClosedOutput: boolean;
  /** True when agent emitted a stream event with statusText='interrupted'. */
  hasInterruptedOutput: boolean;
}

export interface StdoutParserOptions {
  groupName: string;
  /** Label used in log messages, e.g. "Agent process" */
  label: string;
  onOutput?: (output: AgentProcessOutput) => Promise<void>;
  resetTimeout: () => void;
}

export function createStdoutParserState(): StdoutParserState {
  return {
    stdout: '',
    stdoutTruncated: false,
    parseBuffer: '',
    newSessionId: undefined,
    outputChain: Promise.resolve(),
    lastErrorOutput: null,
    hasSuccessOutput: false,
    hasClosedOutput: false,
    hasInterruptedOutput: false,
  };
}

export function attachStdoutHandler(
  stream: Readable,
  state: StdoutParserState,
  opts: StdoutParserOptions,
): void {
  stream.on('data', (data) => {
    const chunk = data.toString();

    // Always accumulate for logging
    if (!state.stdoutTruncated) {
      const remaining =
        getSystemSettings().processMaxOutputSize - state.stdout.length;
      if (chunk.length > remaining) {
        state.stdout += chunk.slice(0, remaining);
        state.stdoutTruncated = true;
        logger.warn(
          { group: opts.groupName, size: state.stdout.length },
          `${opts.label} stdout truncated due to size limit`,
        );
      } else {
        state.stdout += chunk;
      }
    }

    // Stream-parse for output markers
    if (opts.onOutput) {
      state.parseBuffer += chunk;
      const MAX_PARSE_BUFFER = 10 * 1024 * 1024; // 10MB
      if (state.parseBuffer.length > MAX_PARSE_BUFFER) {
        logger.warn(
          { group: opts.groupName },
          'Parse buffer overflow, truncating',
        );
        const lastMarkerIdx =
          state.parseBuffer.lastIndexOf(OUTPUT_START_MARKER);
        state.parseBuffer =
          lastMarkerIdx >= 0
            ? state.parseBuffer.slice(lastMarkerIdx)
            : state.parseBuffer.slice(-512);
      }
      let startIdx: number;
      while (
        (startIdx = state.parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1
      ) {
        const endIdx = state.parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
        if (endIdx === -1) break; // Incomplete pair, wait for more data

        const jsonStr = state.parseBuffer
          .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
          .trim();
        state.parseBuffer = state.parseBuffer.slice(
          endIdx + OUTPUT_END_MARKER.length,
        );

        try {
          const parsed: AgentProcessOutput = JSON.parse(jsonStr);
          if (parsed.newSessionId) {
            state.newSessionId = parsed.newSessionId;
          }
          if (parsed.status === 'success') {
            state.hasSuccessOutput = true;
          }
          if (parsed.status === 'error') {
            state.lastErrorOutput = parsed;
          }
          if (parsed.status === 'closed') {
            state.hasClosedOutput = true;
          }
          if (
            parsed.status === 'stream' &&
            parsed.streamEvent?.statusText === 'interrupted'
          ) {
            state.hasInterruptedOutput = true;
          }
          // Activity detected — reset the hard timeout
          opts.resetTimeout();
          // Call onOutput for all markers (including null results)
          // so idle timers start even for "silent" query completions.
          const onOutputFn = opts.onOutput;
          state.outputChain = state.outputChain
            .then(() => onOutputFn(parsed))
            .catch((err) => {
              logger.error(
                { group: opts.groupName, err },
                'onOutput callback error',
              );
            });
        } catch (err) {
          logger.warn(
            { group: opts.groupName, error: err },
            'Failed to parse streamed output chunk',
          );
        }
      }
    }
  });
}

// ─── Stderr Handler ──────────────────────────────────────────────────

export interface StderrState {
  stderr: string;
  stderrTruncated: boolean;
}

export function createStderrState(): StderrState {
  return {
    stderr: '',
    stderrTruncated: false,
  };
}

export function attachStderrHandler(
  stream: Readable,
  state: StderrState,
  groupName: string,
  /** Structured log context for runner stderr. */
  logContext: Record<string, string>,
): void {
  stream.on('data', (data) => {
    const chunk = data.toString();
    const lines = chunk.trim().split('\n');
    for (const line of lines) {
      if (line) logger.debug(logContext, line);
    }
    // Don't reset timeout on stderr — SDK writes debug logs continuously.
    // Timeout only resets on actual output (OUTPUT_MARKER in stdout).
    if (state.stderrTruncated) return;
    const remaining =
      getSystemSettings().processMaxOutputSize - state.stderr.length;
    if (chunk.length > remaining) {
      state.stderr += chunk.slice(0, remaining);
      state.stderrTruncated = true;
      logger.warn(
        { group: groupName, size: state.stderr.length },
        'Agent process stderr truncated due to size limit',
      );
    } else {
      state.stderr += chunk;
    }
  });
}

// ─── Close Event Handlers ────────────────────────────────────────────

export interface CloseHandlerContext {
  groupName: string;
  /** Human-readable runner label used for log titles. */
  label: string;
  /** Short process label used for log filenames */
  filePrefix: string;
  /** Process identifier */
  identifier: string;
  logsDir: string;
  input: {
    prompt: string;
    sessionId?: string;
    isHome?: boolean;
    isMainWorkspace?: boolean;
    chatJid?: string;
    groupFolder?: string;
    agentType?: string;
    agentId?: string;
  };
  stdoutState: StdoutParserState;
  stderrState: StderrState;
  onOutput?: (output: AgentProcessOutput) => Promise<void>;
  resolvePromise: (output: AgentProcessOutput) => void;
  startTime: number;
  timeoutMs: number;
  agentIdentity?: {
    chatJid?: string;
    groupFolder?: string;
    agentType?: string;
    selectedRunner?: string;
    agentId?: string | null;
  };
  runtimeBuildInfo?: {
    backendPid: number;
    backendStartedAt: string;
    backendBuildLoaded: string;
    backendBuildCurrent: string;
    backendBuildStale: boolean;
    agentRunnerBuildLoaded: string;
    agentRunnerBuildCurrent: string;
    agentRunnerBuildStale: boolean;
  };
  /** Extra log lines for the "Input Summary" section (e.g. Mounts, Working Directory) */
  extraSummaryLines?: string[];
  /** Extra log lines for verbose/error section. */
  extraVerboseLines?: string[];
  /** Custom error enrichment: given stderr, return { result, error } overrides */
  enrichError?: (
    stderr: string,
    exitLabel: string,
  ) => { result: string | null; error: string };
}

/**
 * Handle the 'close' event for timeout case.
 * Returns true if this was a timeout (caller should return early).
 */
export function handleTimeoutClose(
  ctx: CloseHandlerContext,
  code: number | null,
  duration: number,
  timedOut: boolean,
): boolean {
  if (!timedOut) return false;

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(ctx.logsDir, { recursive: true });
  const timeoutLog = path.join(ctx.logsDir, `${ctx.filePrefix}-${ts}.log`);
  fs.writeFileSync(
    timeoutLog,
    [
      `=== ${ctx.label} Run Log (TIMEOUT) ===`,
      `Timestamp: ${new Date().toISOString()}`,
      `Group: ${ctx.groupName}`,
      `Process ID: ${ctx.identifier}`,
      `Duration: ${duration}ms`,
      `Exit Code: ${code}`,
    ].join('\n'),
  );

  logger.info(
    {
      group: ctx.groupName,
      processId: ctx.identifier,
      duration,
      code,
    },
    `${ctx.label} timed out`,
  );

  ctx.resolvePromise({
    status: 'error',
    result: null,
    error: `${ctx.label} timed out after ${ctx.timeoutMs}ms`,
  });
  return true;
}

/**
 * Write a run log file. Returns the log file path.
 */
export function writeRunLog(
  ctx: CloseHandlerContext,
  code: number | null,
  duration: number,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(ctx.logsDir, { recursive: true });
  const logFile = path.join(ctx.logsDir, `${ctx.filePrefix}-${timestamp}.log`);
  const isVerbose =
    process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

  const logLines = [
    `=== ${ctx.label} Run Log ===`,
    `Timestamp: ${new Date().toISOString()}`,
    `Group: ${ctx.groupName}`,
    `Is Home: ${ctx.input.isHome ? 'yes' : 'no'}`,
    `Is Main Workspace: ${ctx.input.isMainWorkspace ? 'yes' : 'no'}`,
    `Duration: ${duration}ms`,
    `Exit Code: ${code}`,
    `Stdout Truncated: ${ctx.stdoutState.stdoutTruncated}`,
    `Stderr Truncated: ${ctx.stderrState.stderrTruncated}`,
    ``,
  ];

  const isError = code !== 0;
  const { stderr, stderrTruncated } = ctx.stderrState;
  const { stdout, stdoutTruncated } = ctx.stdoutState;

  const LOG_TAIL_LIMIT = 4000;
  const stderrLog =
    !isVerbose && !isError && stderr.length > LOG_TAIL_LIMIT
      ? `... (truncated ${stderr.length - LOG_TAIL_LIMIT} chars) ...\n` +
        stderr.slice(-LOG_TAIL_LIMIT)
      : stderr;
  const stdoutLog =
    !isVerbose && !isError && stdout.length > LOG_TAIL_LIMIT
      ? `... (truncated ${stdout.length - LOG_TAIL_LIMIT} chars) ...\n` +
        stdout.slice(-LOG_TAIL_LIMIT)
      : stdout;
  logLines.push(
    `=== Input Summary ===`,
    `Prompt length: ${ctx.input.prompt.length} chars`,
    `Session ID: ${ctx.input.sessionId || 'new'}`,
  );
  if (ctx.agentIdentity?.chatJid) {
    logLines.push(`Chat JID: ${ctx.agentIdentity.chatJid}`);
  }
  if (ctx.agentIdentity?.groupFolder) {
    logLines.push(`Group Folder: ${ctx.agentIdentity.groupFolder}`);
  }
  if (ctx.agentIdentity?.agentType) {
    logLines.push(`Agent Type: ${ctx.agentIdentity.agentType}`);
  }
  if (ctx.agentIdentity?.selectedRunner) {
    logLines.push(`Selected Runner: ${ctx.agentIdentity.selectedRunner}`);
  }
  if (ctx.agentIdentity?.agentId) {
    logLines.push(`Agent ID: ${ctx.agentIdentity.agentId}`);
  }
  if (ctx.runtimeBuildInfo) {
    logLines.push(
      `Backend PID: ${ctx.runtimeBuildInfo.backendPid}`,
      `Backend Started At: ${ctx.runtimeBuildInfo.backendStartedAt}`,
      `Backend Build Loaded: ${ctx.runtimeBuildInfo.backendBuildLoaded}`,
      `Backend Build Current: ${ctx.runtimeBuildInfo.backendBuildCurrent}`,
      `Backend Build Stale: ${ctx.runtimeBuildInfo.backendBuildStale}`,
      `Agent Runner Build Loaded: ${ctx.runtimeBuildInfo.agentRunnerBuildLoaded}`,
      `Agent Runner Build Current: ${ctx.runtimeBuildInfo.agentRunnerBuildCurrent}`,
      `Agent Runner Build Stale: ${ctx.runtimeBuildInfo.agentRunnerBuildStale}`,
    );
  }
  if (ctx.extraSummaryLines) {
    logLines.push(...ctx.extraSummaryLines);
  }
  logLines.push(
    ``,
    `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
    stderrLog,
    ``,
    `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
    stdoutLog,
  );

  if (isVerbose || isError) {
    logLines.push(``, `=== Input ===`, JSON.stringify(ctx.input, null, 2));
    if (ctx.extraVerboseLines) {
      logLines.push(``, ...ctx.extraVerboseLines);
    }
  }

  fs.writeFileSync(logFile, logLines.join('\n'));
  logger.debug({ logFile, verbose: isVerbose }, `${ctx.label} log written`);
  return logFile;
}

const OUTPUT_CHAIN_TIMEOUT = 30_000;

/**
 * Wait for the output chain to settle with a safety timeout.
 * Calls `then` callback on success, always ensures chain timer is cleaned up.
 */
function waitForOutputChain(
  outputChain: Promise<void>,
  groupName: string,
  logLabel: string,
  then: () => void,
): void {
  let chainTimer: ReturnType<typeof setTimeout> | null = null;
  const chainTimeout = new Promise<void>((resolve) => {
    chainTimer = setTimeout(() => {
      logger.warn(
        { group: groupName, timeoutMs: OUTPUT_CHAIN_TIMEOUT },
        `Output chain settle timeout on ${logLabel}`,
      );
      resolve();
    }, OUTPUT_CHAIN_TIMEOUT);
  });
  Promise.race([outputChain, chainTimeout])
    .then(() => {
      if (chainTimer) clearTimeout(chainTimer);
      then();
    })
    .catch(() => {
      if (chainTimer) clearTimeout(chainTimer);
      then();
    });
}

/**
 * Handle the non-zero exit code path (force-kill detection, error output chain, resolve).
 * Returns true if handled (caller should return early).
 */
export function handleNonZeroExit(
  ctx: CloseHandlerContext,
  code: number | null,
  signal: NodeJS.Signals | null,
  duration: number,
  logFile: string,
): boolean {
  if (code === 0) return false;

  const exitLabel =
    code === null ? `signal ${signal || 'unknown'}` : `code ${code}`;
  const { newSessionId, outputChain } = ctx.stdoutState;

  // Graceful interrupt: agent emitted 'interrupted' status before exiting.
  if (ctx.stdoutState.hasInterruptedOutput && ctx.onOutput) {
    logger.info(
      { group: ctx.groupName, code, signal, duration, newSessionId },
      `${ctx.label} exited after interrupt (treating as success)`,
    );
    waitForOutputChain(
      outputChain,
      ctx.groupName,
      `${ctx.filePrefix} interrupt path`,
      () => {
        ctx.resolvePromise({ status: 'success', result: null, newSessionId });
      },
    );
    return true;
  }

  // Graceful shutdown: agent was killed by SIGTERM/SIGKILL (e.g. user
  // clicked stop, session reset, clear-history). Treat as normal
  // completion instead of an error — BUT only if the agent had already
  // produced some output. If killed before emitting ANY output markers
  // (success/closed), it means the process died during initialization
  // (e.g., race condition) and should be treated as an error so the UI
  // waiting state gets cleared via sendSystemMessage('agent_error').
  const isForceKilled =
    signal === 'SIGTERM' || signal === 'SIGKILL' || code === 137;
  if (isForceKilled && ctx.onOutput) {
    const hadOutput =
      ctx.stdoutState.hasSuccessOutput || ctx.stdoutState.hasClosedOutput;

    if (hadOutput) {
      logger.info(
        { group: ctx.groupName, signal, code, duration, newSessionId },
        `${ctx.label} terminated by signal (user stop / graceful shutdown)`,
      );
      waitForOutputChain(
        outputChain,
        ctx.groupName,
        `${ctx.filePrefix} force-kill path`,
        () => {
          ctx.resolvePromise({
            status: 'success',
            result: null,
            newSessionId,
          });
        },
      );
      return true;
    }

    // Agent was killed before producing any output — fall through to
    // error path so the caller can broadcast an error and clear the UI.
    logger.warn(
      { group: ctx.groupName, signal, code, duration },
      `${ctx.label} killed before producing any output — treating as error`,
    );
  }

  // Build error output
  const { stderr } = ctx.stderrState;
  const enriched = ctx.enrichError
    ? ctx.enrichError(stderr, exitLabel)
    : {
        result: null as string | null,
        error: `${ctx.label} exited with ${exitLabel}: ${stderr.slice(-200)}`,
      };

  logger.error(
    {
      group: ctx.groupName,
      code,
      signal,
      duration,
      stderr,
      stdout: ctx.stdoutState.stdout,
      logFile,
    },
    `${ctx.label} exited with error`,
  );

  const finalizeError = () => {
    if (ctx.stdoutState.lastErrorOutput) {
      const streamedError = ctx.stdoutState.lastErrorOutput;
      ctx.resolvePromise({
        ...streamedError,
        result: streamedError.result ?? enriched.result,
        error: streamedError.error || enriched.error,
        finalizationReason:
          streamedError.finalizationReason || ('error' as const),
        alreadyStreamedError: true,
      });
      return;
    }
    ctx.resolvePromise({
      status: 'error',
      result: enriched.result,
      error: enriched.error,
    });
  };

  // Even on error exits, wait for pending output callbacks to settle.
  if (ctx.onOutput) {
    waitForOutputChain(
      outputChain,
      ctx.groupName,
      `${ctx.filePrefix} error path`,
      finalizeError,
    );
    return true;
  }

  finalizeError();
  return true;
}

/**
 * Handle the success (code === 0) path — streaming mode or legacy parsing.
 */
export function handleSuccessClose(
  ctx: CloseHandlerContext,
  duration: number,
): void {
  const { newSessionId, outputChain } = ctx.stdoutState;

  // Streaming mode: wait for output chain to settle
  if (ctx.onOutput) {
    const { hasClosedOutput } = ctx.stdoutState;
    waitForOutputChain(
      outputChain,
      ctx.groupName,
      `${ctx.filePrefix} success path`,
      () => {
        // Propagate 'closed' status so the backend can distinguish a _close-interrupted
        // exit from a normal completion and avoid committing the message cursor.
        const finalStatus = hasClosedOutput
          ? ('closed' as const)
          : ('success' as const);
        logger.info(
          { group: ctx.groupName, duration, newSessionId, finalStatus },
          `${ctx.label} completed (streaming mode)`,
        );
        ctx.resolvePromise({
          status: finalStatus,
          result: null,
          newSessionId,
        });
      },
    );
    return;
  }

  // Legacy mode: parse the last output marker pair from accumulated stdout
  parseLegacyOutput(ctx);
}

/**
 * Parse legacy (non-streaming) output from accumulated stdout.
 */
function parseLegacyOutput(ctx: CloseHandlerContext): void {
  const { stdout } = ctx.stdoutState;
  try {
    const parsedOutputs: AgentProcessOutput[] = [];
    let searchFrom = 0;
    while (true) {
      const startIdx = stdout.indexOf(OUTPUT_START_MARKER, searchFrom);
      if (startIdx === -1) break;
      const endIdx = stdout.indexOf(OUTPUT_END_MARKER, startIdx);
      if (endIdx === -1) break;
      const jsonLine = stdout
        .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
        .trim();
      parsedOutputs.push(JSON.parse(jsonLine) as AgentProcessOutput);
      searchFrom = endIdx + OUTPUT_END_MARKER.length;
    }

    let output: AgentProcessOutput | undefined;
    for (const parsed of parsedOutputs) {
      if (parsed.status === 'error') {
        output = parsed;
      } else if (parsed.status === 'success' && parsed.result !== null) {
        output = parsed;
      } else if (!output && parsed.status !== 'stream') {
        output = parsed;
      }
    }
    output ??= parsedOutputs.at(-1);

    if (!output) {
      // Fallback: last non-empty line (backwards compatibility)
      const lines = stdout.trim().split('\n');
      output = JSON.parse(lines[lines.length - 1]) as AgentProcessOutput;
    }

    logger.info(
      {
        group: ctx.groupName,
        duration: Date.now() - ctx.startTime,
        status: output.status,
        hasResult: !!output.result,
      },
      `${ctx.label} completed`,
    );

    ctx.resolvePromise(output);
  } catch (err) {
    logger.error(
      {
        group: ctx.groupName,
        stdout,
        stderr: ctx.stderrState.stderr,
        error: err,
      },
      `Failed to parse ${ctx.filePrefix} output`,
    );

    ctx.resolvePromise({
      status: 'error',
      result: null,
      error: `Failed to parse ${ctx.filePrefix} output: ${serializeErrorForOutput(err)}`,
    });
  }
}

// ─── API Error Classification ────────────────────────────────────────

function normalizeRuntimeErrorText(stderr: string): string {
  return stderr
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatUserFacingRuntimeError(stderr: string): string | null {
  const normalized = normalizeRuntimeErrorText(stderr);
  if (!normalized) return null;

  if (
    /remote compact task/i.test(normalized) &&
    /unknown[_ ]parameter/i.test(normalized) &&
    /safety_identifier/i.test(normalized)
  ) {
    return 'OpenAI 上下文压缩失败：当前 OpenAI 运行时向远端 compact 接口发送了不兼容参数 safety_identifier。任务已中断；请升级或重启 OpenAI runtime 后重试，必要时发送 /clear 清除当前线程上下文。';
  }

  if (
    /Codex CLI login|CLI_CLAW_CODEX_ACCESS_TOKEN|OpenAI API key is missing|api key/i.test(
      normalized,
    ) ||
    /auth_required|login required|not logged in|unauthorized|401/i.test(
      normalized,
    )
  ) {
    return 'Codex CLI 登录态缺失或已过期。请执行 `codex login` 后重试。';
  }

  if (
    /UsageLimitExceeded/i.test(normalized) ||
    /purchase more credits/i.test(normalized) ||
    /insufficient_quota|quota|rate limit|429/i.test(normalized)
  ) {
    const retryAt = normalized.match(/try again at ([^.]+)\.?/i)?.[1]?.trim();
    return retryAt
      ? `OpenAI API 用量或频率限制已触发，请在 ${retryAt} 后重试。`
      : 'OpenAI API 用量或频率限制已触发，请稍后重试或检查账户额度。';
  }

  if (/Store must be set to false/i.test(normalized)) {
    return 'OpenAI runtime 请求被 Codex 后端拒绝：store 必须为 false。请更新并重启 cli-claw 后重试。';
  }

  if (
    /400 status code \(no body\)|"status"\s*:\s*400|status:\s*400/i.test(
      normalized,
    )
  ) {
    return 'OpenAI runtime 请求被 Codex 后端拒绝（400）。请查看最新进程日志中的 request id，更新并重启 cli-claw 后重试。';
  }

  return null;
}

/** Patterns that indicate an API-level error (runtime issue, not user code bug) */
const API_ERROR_PATTERNS = [
  /\bapi[_ ]?key\b.*\b(invalid|missing|expired|required)\b/i,
  /\bauthentication\s+(failed|error|required)\b/i,
  /\b(401|403)\b.*\bunauthorized\b/i,
  /\brate[_ ]?limit(ed)?\b/i,
  /\bquota\s+(exceeded|exhausted)\b/i,
  /\boverloaded\b/i,
  /\binternal\s+server\s+error\b/i,
  /\b(502|503|504|529)\b/,
  /\binvalid[_ ]?api\b/i,
  /\bcredit(s)?\s+(exhausted|insufficient)\b/i,
  /connection\s*(refused|reset|timed?\s*out)/i,
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT/,
];

/**
 * Classify whether stderr output indicates an API-level error
 * (runtime unreachable, auth failure, rate limit, etc.)
 * vs a normal agent exit or user code issue.
 */
export function isApiError(stderr: string): boolean {
  if (!stderr) return false;
  return API_ERROR_PATTERNS.some((pattern) => pattern.test(stderr));
}
