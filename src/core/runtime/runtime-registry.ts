import type { RuntimeId, AgentRuntime } from './agent-runtime.js';
import { openaiRuntime } from './openai-runtime.js';

const runtimeRegistry = new Map<RuntimeId, AgentRuntime>([
  [openaiRuntime.id, openaiRuntime],
]);

export function normalizeRuntimeId(raw: unknown): RuntimeId {
  if (typeof raw !== 'string') return 'openai';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'openai') return 'openai';
  // Historical aliases and removed runtimes all collapse to Codex/OpenAI.
  return 'openai';
}

export function getAgentRuntime(raw?: unknown): AgentRuntime {
  const runtimeId = normalizeRuntimeId(raw);
  const runtime = runtimeRegistry.get(runtimeId);
  if (!runtime) return openaiRuntime;
  return runtime;
}

export function getRegisteredAgentRuntimes(): AgentRuntime[] {
  return [...runtimeRegistry.values()];
}

export function getDefaultAgentRuntime(): AgentRuntime {
  return openaiRuntime;
}
