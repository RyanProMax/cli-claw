/**
 * agent-fabric Agent Runner
 * Runs as the local agent process, receives config via stdin, outputs result to stdout.
 *
 * Input protocol:
 *   Stdin: Full AgentProcessInput JSON (read until EOF)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json - polled and consumed
 *          Sentinel: /workspace/ipc/input/_close signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { serializeErrorForOutput } from '../../../shared/dist/error-serialization.js';

import type { AgentProcessInput, AgentProcessOutput } from './types.js';
export type { StreamEventType, StreamEvent } from './types.js';

import {
  buildOpenAiRuntimeIdentity,
  runOpenAiAgentLoop,
} from './openai-agent-runtime.js';
import {
  formatOpenAiRuntimeError,
  mergeRuntimeIdentityState,
  type RuntimeIdentityState,
} from './openai-agent-stream.js';

const WORKSPACE_GROUP =
  process.env.AGENT_FABRIC_WORKSPACE_GROUP || '/workspace/group';
const WORKSPACE_IPC = process.env.AGENT_FABRIC_WORKSPACE_IPC || '/workspace/ipc';

const IPC_INPUT_DIR = path.join(WORKSPACE_IPC, 'input');
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_INPUT_DRAIN_SENTINEL = path.join(IPC_INPUT_DIR, '_drain');
const IPC_INPUT_INTERRUPT_SENTINEL = path.join(IPC_INPUT_DIR, '_interrupt');
const IPC_FALLBACK_POLL_MS = 5000;
const INTERRUPT_GRACE_WINDOW_MS = 10_000;

let latestSessionId: string | undefined;
let activeRuntimeIdentity: RuntimeIdentityState | null = null;
let lastInterruptRequestedAt = 0;

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---AGENT_FABRIC_OUTPUT_START---';
const OUTPUT_END_MARKER = '---AGENT_FABRIC_OUTPUT_END---';

function asOpenAiRuntimeIdentity(
  value: AgentProcessOutput['runtimeIdentity'] | undefined,
): RuntimeIdentityState | null {
  if (value?.agentType !== 'openai') return null;
  return {
    agentType: 'openai',
    model: value.model,
    reasoningEffort: value.reasoningEffort,
    speedTier: value.speedTier,
    supportsReasoningEffort: value.supportsReasoningEffort,
  };
}

function writeOutput(output: AgentProcessOutput): void {
  const runtimeIdentity = mergeRuntimeIdentityState(
    activeRuntimeIdentity,
    asOpenAiRuntimeIdentity(
      output.runtimeIdentity ?? output.streamEvent?.runtimeIdentity,
    ),
  );
  if (runtimeIdentity) {
    output = {
      ...output,
      runtimeIdentity,
      ...(output.streamEvent
        ? {
            streamEvent: { ...output.streamEvent, runtimeIdentity },
          }
        : {}),
    };
  }
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function generateTurnId(): string {
  return `ipc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeHomeFlags(input: AgentProcessInput): {
  isHome: boolean;
  isMainWorkspace: boolean;
} {
  return { isHome: !!input.isHome, isMainWorkspace: !!input.isMainWorkspace };
}

function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

function markInterruptRequested(): void {
  lastInterruptRequestedAt = Date.now();
}

function clearInterruptRequested(): void {
  lastInterruptRequestedAt = 0;
}

function isWithinInterruptGraceWindow(): boolean {
  return (
    lastInterruptRequestedAt > 0 &&
    Date.now() - lastInterruptRequestedAt <= INTERRUPT_GRACE_WINDOW_MS
  );
}

function isInterruptRelatedError(err: unknown): boolean {
  const errno = err as NodeJS.ErrnoException;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return (
    errno?.code === 'ABORT_ERR' ||
    /abort|aborted|interrupt|interrupted|cancelled|canceled/i.test(message)
  );
}

function shouldInterrupt(): boolean {
  if (fs.existsSync(IPC_INPUT_INTERRUPT_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_INTERRUPT_SENTINEL);
    } catch {
      /* ignore */
    }
    markInterruptRequested();
    return true;
  }
  return false;
}

function cleanupStartupInterruptSentinel(): void {
  try {
    const stat = fs.statSync(IPC_INPUT_INTERRUPT_SENTINEL);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs <= INTERRUPT_GRACE_WINDOW_MS) {
      log(
        `Preserving recent interrupt sentinel at startup (${Math.round(ageMs)}ms old)`,
      );
      return;
    }
    fs.unlinkSync(IPC_INPUT_INTERRUPT_SENTINEL);
    log(
      `Removed stale interrupt sentinel at startup (${Math.round(ageMs)}ms old)`,
    );
  } catch {
    /* ignore */
  }
}

function shouldDrain(): boolean {
  if (fs.existsSync(IPC_INPUT_DRAIN_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_DRAIN_SENTINEL);
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

interface IpcDrainResult {
  messages: Array<{
    text: string;
    images?: Array<{ data: string; mimeType?: string }>;
  }>;
  cursor?: { timestamp: string; id?: string };
}

function normalizeIpcMessageCursor(
  value: unknown,
): { timestamp: string; id?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const timestamp = (value as { timestamp?: unknown }).timestamp;
  if (typeof timestamp !== 'string' || !timestamp) return null;
  const id = (value as { id?: unknown }).id;
  return {
    timestamp,
    id: typeof id === 'string' ? id : undefined,
  };
}

function isIpcCursorAfter(
  candidate: { timestamp: string; id?: string },
  base: { timestamp: string; id?: string },
): boolean {
  if (candidate.timestamp > base.timestamp) return true;
  if (candidate.timestamp < base.timestamp) return false;
  return (candidate.id || '') > (base.id || '');
}

function drainIpcInput(): IpcDrainResult {
  const result: IpcDrainResult = { messages: [] };
  try {
    const files = fs
      .readdirSync(IPC_INPUT_DIR)
      .filter((file) => file.endsWith('.json'))
      .sort();

    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
          type?: string;
          text?: string;
          images?: Array<{ data: string; mimeType?: string }>;
          cursor?: unknown;
        };
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          const cursor = normalizeIpcMessageCursor(data.cursor);
          if (
            cursor &&
            (!result.cursor || isIpcCursorAfter(cursor, result.cursor))
          ) {
            result.cursor = cursor;
          }
          result.messages.push({
            text: data.text,
            images: data.images,
          });
        }
      } catch (err) {
        log(
          `Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}

function createIpcWatcher(onFileDetected: () => void): { close: () => void } {
  let watcher: fs.FSWatcher | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const debouncedDetect = () => {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!closed) onFileDetected();
    }, 50);
  };

  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
  } catch {
    /* ignore */
  }

  try {
    watcher = fs.watch(IPC_INPUT_DIR, () => {
      debouncedDetect();
    });
    watcher.on('error', (err) => {
      log(
        `IPC watcher error: ${err.message}, degrading to ${IPC_FALLBACK_POLL_MS}ms fallback polling`,
      );
      watcher?.close();
      watcher = null;
    });
  } catch (err) {
    log(
      `Failed to create IPC watcher: ${err instanceof Error ? err.message : String(err)}, using fallback polling`,
    );
  }

  fallbackTimer = setInterval(() => {
    if (!closed) onFileDetected();
  }, IPC_FALLBACK_POLL_MS);
  fallbackTimer.unref();

  return {
    close() {
      closed = true;
      watcher?.close();
      watcher = null;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    },
  };
}

function waitForIpcMessage(): Promise<{
  text: string;
  images?: Array<{ data: string; mimeType?: string }>;
  cursor?: { timestamp: string; id?: string };
} | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const tryDrain = () => {
      if (resolved) return;

      if (shouldClose()) {
        resolved = true;
        ipcWatcher?.close();
        resolve(null);
        return;
      }

      if (shouldDrain()) {
        log('Drain sentinel received, exiting after completed query');
        resolved = true;
        ipcWatcher?.close();
        resolve(null);
        return;
      }

      if (shouldInterrupt()) {
        log('Interrupt sentinel received while idle, ignoring');
        clearInterruptRequested();
      }

      const { messages, cursor } = drainIpcInput();

      if (messages.length > 0) {
        const combinedText = messages.map((message) => message.text).join('\n');
        const allImages = messages.flatMap((message) => message.images || []);
        resolved = true;
        ipcWatcher?.close();
        resolve({
          text: combinedText,
          images: allImages.length > 0 ? allImages : undefined,
          cursor,
        });
      }
    };

    const ipcWatcher = createIpcWatcher(tryDrain);
    tryDrain();
  });
}

function emitTurnInitEvent(
  sessionId: string | undefined,
  turnId: string | undefined,
  messageCursor?: { timestamp: string; id?: string },
): void {
  if (!messageCursor) return;
  writeOutput({
    status: 'stream',
    result: null,
    newSessionId: sessionId,
    streamEvent: {
      eventType: 'init',
      turnId,
      sessionId,
      messageCursor,
    },
  });
}

function forceExitWithSafetyNet(code: number): never {
  log(`Exiting with code ${code}, SIGKILL safety net in 5s`);
  setTimeout(() => {
    console.error(
      '[agent-runner] process.exit() did not terminate, forcing SIGKILL',
    );
    process.kill(process.pid, 'SIGKILL');
  }, 5000);
  process.exit(code);
}

function buildVisibleRuntimeErrorOutput(
  errorMessage: string,
  sessionId?: string,
): AgentProcessOutput {
  const friendlyError = formatOpenAiRuntimeError(errorMessage);
  return {
    status: 'error',
    result: friendlyError,
    error: friendlyError,
    alreadyStreamedError: true,
    finalizationReason: 'error',
    ...(sessionId ? { newSessionId: sessionId } : {}),
  };
}

async function main(): Promise<void> {
  let agentInput: AgentProcessInput;

  try {
    const stdinData = await readStdin();
    agentInput = JSON.parse(stdinData) as AgentProcessInput;
    activeRuntimeIdentity = buildOpenAiRuntimeIdentity({
      model: agentInput.model ?? null,
      reasoningEffort: agentInput.reasoningEffort ?? null,
      speedTier: agentInput.speedTier ?? null,
    });
    log(
      `Received input for group: ${agentInput.groupFolder}, chatJid: ${agentInput.chatJid}, agentType: openai, session: ${agentInput.sessionId || 'new'}, runnerPid: ${process.pid}`,
    );
  } catch (err) {
    writeOutput(
      buildVisibleRuntimeErrorOutput(
        `Failed to parse input: ${serializeErrorForOutput(err)}`,
      ),
    );
    process.exit(1);
  }

  latestSessionId = agentInput.sessionId;
  log(`Selected runner: openai, runnerPid: ${process.pid}`);
  await runOpenAiAgentLoop(agentInput, {
    workspaceGroup: WORKSPACE_GROUP,
    workspaceIpc: WORKSPACE_IPC,
    ipcInputDir: IPC_INPUT_DIR,
    ipcInputCloseSentinel: IPC_INPUT_CLOSE_SENTINEL,
    ipcInputInterruptSentinel: IPC_INPUT_INTERRUPT_SENTINEL,
    writeOutput,
    log,
    normalizeHomeFlags,
    cleanupStartupInterruptSentinel,
    clearInterruptRequested,
    shouldClose,
    shouldDrain,
    shouldInterrupt,
    drainIpcInput,
    waitForIpcMessage,
    generateTurnId,
    emitTurnInitEvent,
    setLatestSessionId: (nextSessionId) => {
      latestSessionId = nextSessionId;
    },
  });
  forceExitWithSafetyNet(0);
}

(process.stdout as NodeJS.WriteStream & NodeJS.EventEmitter).on(
  'error',
  (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
  },
);
(process.stderr as NodeJS.WriteStream & NodeJS.EventEmitter).on(
  'error',
  (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
  },
);

process.on('SIGTERM', () => {
  log('Received SIGTERM, exiting gracefully');
  if (latestSessionId) {
    try {
      writeOutput({
        status: 'success',
        result: null,
        newSessionId: latestSessionId,
      });
    } catch {
      /* stdout may be closed */
    }
  }
  forceExitWithSafetyNet(0);
});

process.on('SIGINT', () => {
  log('Received SIGINT, exiting gracefully');
  forceExitWithSafetyNet(0);
});

process.on('uncaughtException', (err: unknown) => {
  const errno = err as NodeJS.ErrnoException;
  if (errno?.code === 'EPIPE') {
    process.exit(0);
  }
  if (isWithinInterruptGraceWindow() && isInterruptRelatedError(err)) {
    console.error('Suppressing interrupt-related uncaught exception:', err);
    process.exit(0);
  }
  console.error('Uncaught exception:', err);
  try {
    writeOutput(
      buildVisibleRuntimeErrorOutput(
        serializeErrorForOutput(err),
        latestSessionId,
      ),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const errno = reason as NodeJS.ErrnoException;
  if (errno?.code === 'EPIPE') {
    process.exit(0);
  }
  if (isWithinInterruptGraceWindow()) {
    console.error('Unhandled rejection during interrupt (non-fatal):', reason);
    return;
  }
  console.error('Unhandled rejection:', reason);
  try {
    writeOutput(
      buildVisibleRuntimeErrorOutput(
        serializeErrorForOutput(reason),
        latestSessionId,
      ),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});

main().catch((err) => {
  console.error('Fatal error in main():', err);
  try {
    writeOutput(
      buildVisibleRuntimeErrorOutput(
        serializeErrorForOutput(err),
        latestSessionId,
      ),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
