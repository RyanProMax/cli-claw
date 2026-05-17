import fs from 'node:fs';
import {
  Agent,
  Runner,
  setTracingDisabled,
  type AgentInputItem,
  type ModelProvider,
  type ModelSettings,
} from '@openai/agents';
import type {
  AgentProcessInput,
  AgentProcessOutput,
  ImageMediaType,
  StreamEvent,
} from './types.js';
import { configureCodexCliOpenAiProvider } from './codex-cli-provider.js';
import { createOpenAiAgentSession } from './openai-agent-session.js';
import {
  OpenAiAgentStreamMapper,
  type RuntimeIdentityState,
} from './openai-agent-stream.js';
import { createOpenAiAgentTools } from './openai-agent-tools.js';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const OPENAI_REASONING_EFFORT =
  process.env.OPENAI_REASONING_EFFORT ||
  process.env.REASONING_EFFORT ||
  'medium';
const OPENAI_SERVICE_TIER =
  process.env.OPENAI_SERVICE_TIER || process.env.SERVICE_TIER || '';
const OPENAI_INTERRUPT_POLL_MS = 250;
type OpenAiSpeedTier = 'standard' | 'fast';

export interface IpcDrainResult {
  messages: Array<{
    text: string;
    images?: Array<{ data: string; mimeType?: string }>;
  }>;
  cursor?: { timestamp: string; id?: string };
}

export interface IpcMessage {
  text: string;
  images?: Array<{ data: string; mimeType?: string }>;
  cursor?: { timestamp: string; id?: string };
}

export interface OpenAiAgentRuntimeDeps {
  workspaceGroup: string;
  workspaceIpc: string;
  ipcInputDir: string;
  ipcInputCloseSentinel: string;
  ipcInputInterruptSentinel: string;
  writeOutput: (output: AgentProcessOutput) => void;
  log: (message: string) => void;
  normalizeHomeFlags: (input: AgentProcessInput) => {
    isHome: boolean;
    isAdminHome: boolean;
  };
  cleanupStartupInterruptSentinel: () => void;
  clearInterruptRequested: () => void;
  shouldClose: () => boolean;
  shouldDrain: () => boolean;
  shouldInterrupt: () => boolean;
  drainIpcInput: () => IpcDrainResult;
  waitForIpcMessage: () => Promise<IpcMessage | null>;
  generateTurnId: () => string;
  emitTurnInitEvent: (
    sessionId: string | undefined,
    turnId: string | undefined,
    messageCursor?: { timestamp: string; id?: string },
  ) => void;
  setLatestSessionId: (sessionId: string | undefined) => void;
}

function normalizeRuntimeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOpenAiSpeedTier(
  value: string | null | undefined,
): OpenAiSpeedTier | null {
  const normalized = normalizeRuntimeText(value)?.toLowerCase();
  if (normalized === 'fast' || normalized === 'standard') return normalized;
  if (normalized === 'priority') return 'fast';
  return null;
}

function resolveOpenAiSpeedTier(
  value: string | null | undefined,
): OpenAiSpeedTier {
  return normalizeOpenAiSpeedTier(value) ?? 'standard';
}

export function resolveCodexServiceTier(
  speedTier: string | null | undefined,
): string | null {
  const normalized = resolveOpenAiSpeedTier(speedTier);
  return normalized === 'fast' ? 'priority' : null;
}

export function buildOpenAiRuntimeIdentity(
  requestedRuntime?: Pick<
    AgentProcessInput,
    'model' | 'reasoningEffort' | 'speedTier'
  >,
): RuntimeIdentityState {
  return {
    agentType: 'openai',
    model:
      normalizeRuntimeText(requestedRuntime?.model ?? undefined) ??
      normalizeRuntimeText(OPENAI_MODEL),
    reasoningEffort:
      normalizeRuntimeText(requestedRuntime?.reasoningEffort ?? undefined) ??
      normalizeRuntimeText(OPENAI_REASONING_EFFORT),
    speedTier: resolveOpenAiSpeedTier(
      normalizeRuntimeText(requestedRuntime?.speedTier ?? undefined) ??
        normalizeRuntimeText(OPENAI_SERVICE_TIER),
    ),
    supportsReasoningEffort: true,
  };
}

function buildInputItems(
  prompt: string,
  images?: Array<{ data: string; mimeType?: string }>,
): string | AgentInputItem[] {
  if (!images?.length) return prompt;
  const content: Array<Record<string, unknown>> = [
    { type: 'input_text', text: prompt },
  ];
  for (const image of images) {
    const mimeType = (image.mimeType || 'image/png') as ImageMediaType;
    content.push({
      type: 'input_image',
      image: `data:${mimeType};base64,${image.data}`,
      detail: 'auto',
    });
  }
  return [{ role: 'user', content } as AgentInputItem];
}

export function buildModelSettings(input: AgentProcessInput): ModelSettings {
  const reasoningEffort =
    normalizeRuntimeText(input.reasoningEffort ?? undefined) ??
    normalizeRuntimeText(OPENAI_REASONING_EFFORT);
  const speedTier =
    normalizeRuntimeText(input.speedTier ?? undefined) ??
    normalizeRuntimeText(OPENAI_SERVICE_TIER);
  const serviceTier = resolveCodexServiceTier(speedTier);
  return {
    parallelToolCalls: false,
    store: false,
    reasoning: {
      effort: reasoningEffort as ModelSettings['reasoning'] extends {
        effort?: infer Effort;
      }
        ? Effort
        : never,
      summary: 'auto',
    },
    ...(serviceTier ? { providerData: { service_tier: serviceTier } } : {}),
  };
}

function scheduledTaskPrompt(prompt: string): string {
  return [
    '[Scheduled task - this content was sent by the system, not by a direct user or group message.]',
    '',
    'You are running in scheduled task mode. Your final output is not automatically sent to the user.',
    'Use the send_message tool exactly once at the end if the user or group should receive the result.',
    '',
    prompt,
  ].join('\n');
}

function decorateStreamEvent(
  event: StreamEvent,
  sessionId: string | undefined,
  input: AgentProcessInput,
): StreamEvent {
  return {
    ...event,
    turnId: input.turnId,
    sessionId,
    ...(input.messageCursor ? { messageCursor: input.messageCursor } : {}),
  };
}

async function runOpenAiTurn(
  agent: Agent,
  input: AgentProcessInput,
  prompt: string,
  images: Array<{ data: string; mimeType?: string }> | undefined,
  sessionId: string | undefined,
  modelProvider: ModelProvider,
  deps: OpenAiAgentRuntimeDeps,
): Promise<{
  sessionId: string;
  interrupted: boolean;
  closed: boolean;
  finalText: string | null;
}> {
  process.env.OPENAI_AGENTS_DISABLE_TRACING ??= '1';
  setTracingDisabled(true);
  const session = createOpenAiAgentSession(sessionId);
  const currentSessionId = await session.getSessionId();
  deps.setLatestSessionId(currentSessionId);

  const abortController = new AbortController();
  const runner = new Runner({ modelProvider, tracingDisabled: true });
  let interrupted = false;
  let closed = false;
  const cancelWatcher = setInterval(() => {
    if (deps.shouldClose() || deps.shouldDrain()) {
      closed = true;
      abortController.abort();
      return;
    }
    if (deps.shouldInterrupt()) {
      interrupted = true;
      abortController.abort();
    }
  }, OPENAI_INTERRUPT_POLL_MS);

  const startedAt = Date.now();
  const mapper = new OpenAiAgentStreamMapper(deps.writeOutput, (event) =>
    decorateStreamEvent(event, currentSessionId, input),
  );

  try {
    const result = await runner.run(agent, buildInputItems(prompt, images), {
      stream: true,
      session,
      signal: abortController.signal,
      maxTurns: 20,
    });
    for await (const event of result) {
      mapper.process(event);
    }
    await result.completed;
    mapper.cleanup();
    const finalOutput =
      typeof result.finalOutput === 'string'
        ? result.finalOutput
        : mapper.getFinalText();
    const finalText = finalOutput || mapper.getFinalText() || null;
    deps.writeOutput({
      status: 'success',
      result: finalText,
      newSessionId: currentSessionId,
      turnId: input.turnId,
      sessionId: currentSessionId,
      sourceKind: 'sdk_final',
      finalizationReason: 'completed',
    });
    mapper.emitUsageFromResult(
      result,
      Date.now() - startedAt,
      String(agent.model),
    );
    return { sessionId: currentSessionId, interrupted, closed, finalText };
  } catch (err) {
    mapper.cleanup();
    if (interrupted || closed || abortController.signal.aborted) {
      return {
        sessionId: currentSessionId,
        interrupted,
        closed,
        finalText: null,
      };
    }
    throw err;
  } finally {
    clearInterval(cancelWatcher);
  }
}

export async function runOpenAiAgentLoop(
  agentInput: AgentProcessInput,
  deps: OpenAiAgentRuntimeDeps,
): Promise<void> {
  const modelProvider = configureCodexCliOpenAiProvider();

  let sessionId = agentInput.sessionId;
  deps.setLatestSessionId(sessionId);

  fs.mkdirSync(deps.ipcInputDir, { recursive: true });
  try {
    fs.unlinkSync(deps.ipcInputCloseSentinel);
  } catch {
    /* ignore */
  }
  deps.cleanupStartupInterruptSentinel();

  const { isHome, isAdminHome } = deps.normalizeHomeFlags(agentInput);
  const model = agentInput.model || OPENAI_MODEL;
  const agent = new Agent({
    name: agentInput.agentName || 'Cli Claw OpenAI Agent',
    model,
    modelSettings: buildModelSettings(agentInput),
    instructions: [
      'You are running inside cli-claw as the OpenAI agent runtime.',
      'Use available tools for messaging, files, skills, groups, and scheduled task operations.',
      'Do not assume prior conversation context unless it is present in the persisted session.',
    ].join('\n'),
    tools: createOpenAiAgentTools({
      chatJid: agentInput.chatJid,
      groupFolder: agentInput.groupFolder,
      isHome,
      isAdminHome,
      isScheduledTask: agentInput.isScheduledTask || false,
      workspaceIpc: deps.workspaceIpc,
      workspaceGroup: deps.workspaceGroup,
    }),
  });

  let prompt = agentInput.isScheduledTask
    ? scheduledTaskPrompt(agentInput.prompt)
    : agentInput.prompt;
  let promptImages = agentInput.images;
  const pendingDrain = deps.drainIpcInput();
  if (pendingDrain.messages.length > 0) {
    deps.log(
      `Draining ${pendingDrain.messages.length} pending IPC messages into initial OpenAI prompt`,
    );
    prompt +=
      '\n' + pendingDrain.messages.map((message) => message.text).join('\n');
    const pendingImages = pendingDrain.messages.flatMap(
      (message) => message.images || [],
    );
    if (pendingImages.length > 0) {
      promptImages = [...(promptImages || []), ...pendingImages];
    }
  }

  while (true) {
    try {
      fs.unlinkSync(deps.ipcInputInterruptSentinel);
    } catch {
      /* ignore */
    }
    deps.clearInterruptRequested();
    deps.emitTurnInitEvent(
      sessionId,
      agentInput.turnId,
      agentInput.messageCursor,
    );

    const turnResult = await runOpenAiTurn(
      agent,
      agentInput,
      prompt,
      promptImages,
      sessionId,
      modelProvider,
      deps,
    );
    sessionId = turnResult.sessionId;
    deps.setLatestSessionId(sessionId);
    agentInput.messageCursor = undefined;

    if (turnResult.closed) {
      deps.writeOutput({
        status: 'closed',
        result: null,
        newSessionId: sessionId,
      });
      break;
    }

    if (turnResult.interrupted) {
      deps.writeOutput({
        status: 'stream',
        result: null,
        streamEvent: decorateStreamEvent(
          { eventType: 'status', statusText: 'interrupted' },
          sessionId,
          agentInput,
        ),
        newSessionId: sessionId,
      });
    } else {
      deps.writeOutput({
        status: 'success',
        result: null,
        newSessionId: sessionId,
      });
    }

    const nextMessage = await deps.waitForIpcMessage();
    if (nextMessage === null) break;
    prompt = nextMessage.text;
    promptImages = nextMessage.images;
    agentInput.turnId = deps.generateTurnId();
    agentInput.messageCursor = nextMessage.cursor;
  }
}
