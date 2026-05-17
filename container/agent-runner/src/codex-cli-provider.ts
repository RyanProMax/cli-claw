import {
  OpenAIResponsesModel,
  setDefaultModelProvider,
  type AgentOutputItem,
  type Model,
  type ModelProvider,
  type ModelRequest,
  type StreamEvent,
} from '@openai/agents';
import { OpenAI, type ClientOptions } from 'openai/index.js';
import { ProxyAgent, type Dispatcher } from 'undici';

const CODEX_BACKEND_BASE_URL =
  process.env.CLI_CLAW_CODEX_BASE_URL ||
  'https://chatgpt.com/backend-api/codex';

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function envValue(env: NodeJS.ProcessEnv, ...names: string[]): string | null {
  for (const name of names) {
    const value = normalizeText(env[name]);
    if (value) return value;
  }
  return null;
}

function parseNoProxyEntry(
  value: string,
): { hostname: string; port: number | null } | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === '*') return { hostname: '*', port: null };
  const match = trimmed.match(/^(.+):(\d+)$/);
  return {
    hostname: match ? match[1]! : trimmed,
    port: match ? Number.parseInt(match[2]!, 10) : null,
  };
}

function noProxyMatches(
  hostname: string,
  port: number,
  entry: string,
): boolean {
  const parsed = parseNoProxyEntry(entry);
  if (!parsed) return false;
  if (parsed.hostname === '*') return true;
  if (parsed.port !== null && parsed.port !== port) return false;

  const rule = parsed.hostname.replace(/^\[|\]$/g, '');
  if (rule.startsWith('*')) {
    return hostname.endsWith(rule.slice(1));
  }
  if (rule.startsWith('.')) {
    return hostname === rule.slice(1) || hostname.endsWith(rule);
  }
  return hostname === rule || hostname.endsWith(`.${rule}`);
}

function shouldBypassProxy(targetUrl: URL, env: NodeJS.ProcessEnv): boolean {
  const noProxy = envValue(env, 'NO_PROXY', 'no_proxy');
  if (!noProxy) return false;
  const hostname = targetUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port =
    Number.parseInt(targetUrl.port, 10) ||
    (targetUrl.protocol === 'https:' ? 443 : 80);
  return noProxy
    .split(/[,\s]+/)
    .some((entry) => noProxyMatches(hostname, port, entry));
}

export function resolveCodexProxyUrl(
  baseUrl = CODEX_BACKEND_BASE_URL,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  let targetUrl: URL;
  try {
    targetUrl = new URL(baseUrl);
  } catch {
    return null;
  }
  if (shouldBypassProxy(targetUrl, env)) return null;
  if (targetUrl.protocol === 'https:') {
    return envValue(
      env,
      'HTTPS_PROXY',
      'https_proxy',
      'ALL_PROXY',
      'all_proxy',
    );
  }
  if (targetUrl.protocol === 'http:') {
    return envValue(env, 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy');
  }
  return null;
}

export function buildCodexCliFetchOptions(
  baseUrl = CODEX_BACKEND_BASE_URL,
  env: NodeJS.ProcessEnv = process.env,
): { dispatcher: Dispatcher } | undefined {
  const proxyUrl = resolveCodexProxyUrl(baseUrl, env);
  if (!proxyUrl) return undefined;
  return { dispatcher: new ProxyAgent(proxyUrl) };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function convertMessageContentItem(
  item: Record<string, unknown>,
): Record<string, unknown> | null {
  const type = item.type;
  if (type === 'output_text' && typeof item.text === 'string') {
    return { type, text: item.text };
  }
  if (type === 'refusal' && typeof item.refusal === 'string') {
    return { type, refusal: item.refusal };
  }
  return null;
}

function convertCodexStreamOutputItem(item: unknown): AgentOutputItem | null {
  const record = asRecord(item);
  if (!record || typeof record.type !== 'string') return null;

  if (record.type === 'message') {
    const content = Array.isArray(record.content)
      ? record.content
          .map((entry) =>
            asRecord(entry)
              ? convertMessageContentItem(asRecord(entry)!)
              : null,
          )
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      : [];
    if (content.length === 0) return null;
    return {
      id: typeof record.id === 'string' ? record.id : undefined,
      type: 'message',
      role: record.role === 'assistant' ? 'assistant' : 'assistant',
      status:
        record.status === 'completed' ||
        record.status === 'in_progress' ||
        record.status === 'incomplete'
          ? record.status
          : 'completed',
      content,
      providerData: {
        ...(record.phase ? { phase: record.phase } : {}),
      },
    } as AgentOutputItem;
  }

  if (record.type === 'function_call') {
    const callId =
      typeof record.call_id === 'string'
        ? record.call_id
        : typeof record.callId === 'string'
          ? record.callId
          : null;
    const name = typeof record.name === 'string' ? record.name : null;
    const args = typeof record.arguments === 'string' ? record.arguments : '{}';
    if (!callId || !name) return null;
    return {
      id: typeof record.id === 'string' ? record.id : undefined,
      type: 'function_call',
      callId,
      name,
      arguments: args,
      status:
        record.status === 'completed' ||
        record.status === 'in_progress' ||
        record.status === 'incomplete'
          ? record.status
          : 'completed',
      providerData: {},
    } as AgentOutputItem;
  }

  if (record.type === 'reasoning') {
    const summary = Array.isArray(record.summary) ? record.summary : [];
    return {
      id: typeof record.id === 'string' ? record.id : undefined,
      type: 'reasoning',
      content: summary
        .map((entry) => {
          const summaryEntry = asRecord(entry);
          const text = summaryEntry?.text;
          return typeof text === 'string' ? { type: 'input_text', text } : null;
        })
        .filter((entry): entry is { type: 'input_text'; text: string } =>
          Boolean(entry),
        ),
      providerData: {},
    } as AgentOutputItem;
  }

  return null;
}

function collectCompletedOutputItem(
  event: StreamEvent,
  completedItems: AgentOutputItem[],
): void {
  if (event.type !== 'model') return;
  const rawEvent = asRecord(event.event);
  if (rawEvent?.type !== 'response.output_item.done') return;
  const outputItem = convertCodexStreamOutputItem(rawEvent.item);
  if (outputItem) completedItems.push(outputItem);
}

function withCodexCompletedOutputFallback(
  event: StreamEvent,
  completedItems: AgentOutputItem[],
): StreamEvent {
  if (
    event.type !== 'response_done' ||
    event.response.output.length > 0 ||
    completedItems.length === 0
  ) {
    return event;
  }
  return {
    ...event,
    response: {
      ...event.response,
      output: [...completedItems] as typeof event.response.output,
    },
  };
}

class CodexResponsesModel extends OpenAIResponsesModel {
  override async *getStreamedResponse(
    request: ModelRequest,
  ): AsyncIterable<StreamEvent> {
    const completedItems: AgentOutputItem[] = [];
    for await (const event of super.getStreamedResponse(request)) {
      collectCompletedOutputItem(event, completedItems);
      yield withCodexCompletedOutputFallback(event, completedItems);
    }
  }
}

class CodexCliOpenAiProvider implements ModelProvider {
  private readonly modelCache = new Map<string, Model>();

  constructor(private readonly client: OpenAI) {}

  getModel(modelName?: string): Model {
    const model = normalizeText(modelName) ?? 'gpt-5.4';
    const cached = this.modelCache.get(model);
    if (cached) return cached;
    const next = new CodexResponsesModel(this.client, model);
    this.modelCache.set(model, next);
    return next;
  }
}

function base64UrlDecode(value: string): string {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '=',
  );
  return Buffer.from(
    padded.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf8');
}

export function getChatGptAccountIdFromToken(
  accessToken: string,
): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(base64UrlDecode(payload)) as Record<
      string,
      unknown
    >;
    const authClaim = claims['https://api.openai.com/auth'];
    if (!authClaim || typeof authClaim !== 'object') return null;
    return normalizeText(
      (authClaim as Record<string, unknown>).chatgpt_account_id as
        | string
        | undefined,
    );
  } catch {
    return null;
  }
}

export function buildCodexCliHeaders(
  accessToken: string,
): Record<string, string> {
  const accountId =
    normalizeText(process.env.CLI_CLAW_CODEX_ACCOUNT_ID) ??
    getChatGptAccountIdFromToken(accessToken);
  return {
    'User-Agent': 'codex_cli_rs/0.0.0 (Cli Claw)',
    originator: 'codex_cli_rs',
    ...(accountId ? { 'ChatGPT-Account-ID': accountId } : {}),
  };
}

export function configureCodexCliOpenAiProvider(): ModelProvider {
  const accessToken = normalizeText(process.env.CLI_CLAW_CODEX_ACCESS_TOKEN);
  if (!accessToken) {
    throw new Error(
      'Codex CLI login is required. Run `codex login`, then retry.',
    );
  }

  const fetchOptions = buildCodexCliFetchOptions(CODEX_BACKEND_BASE_URL);
  const client = new OpenAI({
    apiKey: accessToken,
    baseURL: CODEX_BACKEND_BASE_URL,
    defaultHeaders: buildCodexCliHeaders(accessToken),
    ...(fetchOptions
      ? {
          fetchOptions:
            fetchOptions as unknown as ClientOptions['fetchOptions'],
        }
      : {}),
  });

  const provider = new CodexCliOpenAiProvider(client);
  setDefaultModelProvider(provider);
  return provider;
}
