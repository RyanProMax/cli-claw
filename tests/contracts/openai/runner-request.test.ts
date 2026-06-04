import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  body: Record<string, unknown>;
}

type CaptureResponder = (
  req: IncomingMessage,
  res: ServerResponse,
  body: Record<string, unknown>,
) => void | Promise<void>;

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readRequestBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function withCaptureServer<T>(
  fn: (server: { baseUrl: string; captured: CapturedRequest[] }) => Promise<T>,
  respond?: CaptureResponder,
): Promise<T> {
  const captured: CapturedRequest[] = [];
  const server = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    captured.push({ method: req.method, url: req.url, body });
    if (respond) {
      await respond(req, res, body);
      return;
    }
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'captured request body' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  try {
    return await fn({
      baseUrl: `http://127.0.0.1:${port}`,
      captured,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function buildRunnerDeps(tempRoot: string) {
  const outputs: unknown[] = [];
  const ipcInputDir = path.join(tempRoot, 'ipc', 'input');
  return {
    outputs,
    deps: {
      workspaceGroup: path.join(tempRoot, 'group'),
      workspaceIpc: path.join(tempRoot, 'ipc'),
      ipcInputDir,
      ipcInputCloseSentinel: path.join(ipcInputDir, '_close'),
      ipcInputInterruptSentinel: path.join(ipcInputDir, '_interrupt'),
      writeOutput: (output: unknown) => {
        outputs.push(output);
      },
      log: () => {},
      normalizeHomeFlags: () => ({ isHome: true, isMainWorkspace: true }),
      cleanupStartupInterruptSentinel: () => {},
      clearInterruptRequested: () => {},
      shouldClose: () => false,
      shouldDrain: () => false,
      shouldInterrupt: () => false,
      drainIpcInput: () => ({ messages: [] }),
      waitForIpcMessage: async () => null,
      generateTurnId: () => 'turn-next',
      emitTurnInitEvent: () => {},
      setLatestSessionId: () => {},
    },
  };
}

async function captureOpenAiRunnerRequests(speedTiers: string[]) {
  return await withCaptureServer(async ({ baseUrl, captured }) => {
    const tempRoot = makeTempDir('cli-claw-p0-openai-runner-');
    vi.stubEnv('CLI_CLAW_CODEX_ACCESS_TOKEN', 'test-token');
    vi.stubEnv('CLI_CLAW_CODEX_BASE_URL', baseUrl);
    vi.stubEnv('CLI_CLAW_RUNTIME_SESSION_DIR', path.join(tempRoot, 'sessions'));
    vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
    vi.stubEnv('no_proxy', '127.0.0.1,localhost');

    const { runOpenAiAgentLoop } =
      await import('../../../container/agent-runner/src/openai-agent-runtime.ts');
    const { deps } = buildRunnerDeps(tempRoot);

    for (const speedTier of speedTiers) {
      await expect(
        runOpenAiAgentLoop(
          {
            prompt: `ping ${speedTier}`,
            groupFolder: 'main',
            chatJid: 'feishu:oc_p0',
            agentType: 'openai',
            model: 'gpt-5.5',
            reasoningEffort: 'xhigh',
            speedTier,
            turnId: `turn-p0-${speedTier}`,
            messageCursor: {
              timestamp: '1778920000000',
              id: `om_p0_${speedTier}`,
            },
          },
          deps,
        ),
      ).rejects.toThrow();
    }

    expect(captured).toHaveLength(speedTiers.length);
    return captured;
  });
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function responseOutput(text: string): Array<Record<string, unknown>> {
  return [
    {
      id: 'msg_1',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  ];
}

function responseSnapshot(text = '', status = 'in_progress') {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: 'gpt-5.5',
    output: text ? responseOutput(text) : [],
    usage: {
      input_tokens: 5,
      output_tokens: 2,
      total_tokens: 7,
    },
  };
}

function responseWithOutput(
  output: Array<Record<string, unknown>>,
  id = 'resp_1',
) {
  return {
    id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: 'gpt-5.5',
    output,
    usage: {
      input_tokens: 5,
      output_tokens: 2,
      total_tokens: 7,
    },
  };
}

function writeSuccessfulResponsesStream(
  res: ServerResponse,
  finalText: string,
  options: {
    emptyTerminalOutput?: boolean;
    malformedTerminalOutput?: boolean;
    messageId?: string;
    reasoningId?: string;
  } = {},
): void {
  const messageId = options.messageId ?? 'msg_1';
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(
    sse('response.created', {
      type: 'response.created',
      response: responseSnapshot(),
    }),
  );
  res.write(
    sse('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        id: messageId,
        type: 'message',
        status: 'in_progress',
        role: 'assistant',
        content: [],
      },
    }),
  );
  if (options.reasoningId) {
    res.write(
      sse('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          id: options.reasoningId,
          type: 'reasoning',
          summary: [],
        },
      }),
    );
  }
  res.write(
    sse('response.content_part.added', {
      type: 'response.content_part.added',
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    }),
  );
  res.write(
    sse('response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      delta: finalText,
    }),
  );
  res.write(
    sse('response.output_text.done', {
      type: 'response.output_text.done',
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      text: finalText,
    }),
  );
  res.write(
    sse('response.content_part.done', {
      type: 'response.content_part.done',
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: finalText, annotations: [] },
    }),
  );
  res.write(
    sse('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        id: messageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: finalText, annotations: [] }],
      },
    }),
  );
  res.write(
    sse('response.completed', {
      type: 'response.completed',
      response: options.malformedTerminalOutput
        ? {
            ...responseSnapshot('', 'completed'),
            output: [
              {
                id: options.reasoningId ?? 'rs_1',
                type: 'reasoning',
              },
              {
                id: messageId,
                type: 'message',
                status: 'completed',
                role: 'assistant',
              },
            ],
          }
        : responseSnapshot(
            options.emptyTerminalOutput ? '' : finalText,
            'completed',
          ),
    }),
  );
  res.end('data: [DONE]\n\n');
}

function writeToolCallResponsesStream(res: ServerResponse): void {
  const firstResponse = responseWithOutput(
    [
      {
        id: 'rs_tool_loop_leak',
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'Need to send a message.' }],
      },
      {
        id: 'fc_tool_loop_leak',
        type: 'function_call',
        status: 'completed',
        call_id: 'call_tool_loop',
        name: 'send_message',
        arguments: JSON.stringify({ text: 'tool hello' }),
      },
    ],
    'resp_tool_loop_first',
  );

  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(
    sse('response.created', {
      type: 'response.created',
      response: { ...firstResponse, output: [], status: 'in_progress' },
    }),
  );
  res.write(
    sse('response.completed', {
      type: 'response.completed',
      response: firstResponse,
    }),
  );
  res.end('data: [DONE]\n\n');
}

describe('Codex proxy-aware request transport', () => {
  test('uses HTTPS proxy env for the ChatGPT Codex backend', async () => {
    const { buildCodexCliFetchOptions, resolveCodexProxyUrl } =
      await import('../../../container/agent-runner/src/codex-cli-provider.ts');
    const env = {
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      NO_PROXY: 'localhost,127.0.0.1',
    };

    expect(
      resolveCodexProxyUrl('https://chatgpt.com/backend-api/codex', env),
    ).toBe('http://127.0.0.1:7897');
    expect(
      buildCodexCliFetchOptions('https://chatgpt.com/backend-api/codex', env)
        ?.dispatcher,
    ).toBeDefined();
  });

  test('honors NO_PROXY for local capture servers', async () => {
    const { buildCodexCliFetchOptions, resolveCodexProxyUrl } =
      await import('../../../container/agent-runner/src/codex-cli-provider.ts');
    const env = {
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      NO_PROXY: '127.0.0.1,localhost',
    };

    expect(resolveCodexProxyUrl('http://127.0.0.1:30123', env)).toBeNull();
    expect(buildCodexCliFetchOptions('http://127.0.0.1:30123', env)).toBe(
      undefined,
    );
  });
});

describe('P0 OpenAI runner request contract', () => {
  test('serializes fast and standard OpenAI runs through the real SDK request body', async () => {
    const [fastRequest, standardRequest] = await captureOpenAiRunnerRequests([
      'fast',
      'standard',
    ]);

    expect(fastRequest!.method).toBe('POST');
    expect(fastRequest!.url).toBe('/responses');
    expect(fastRequest!.body).toMatchObject({
      model: 'gpt-5.5',
      stream: true,
      store: false,
      service_tier: 'priority',
      reasoning: {
        effort: 'xhigh',
        summary: 'auto',
      },
    });
    expect(fastRequest!.body.service_tier).not.toBe('fast');
    expect(JSON.stringify(fastRequest!.body.input)).toContain('ping fast');
    expect(String(fastRequest!.body.instructions)).toContain('cli-claw');

    expect(standardRequest!.method).toBe('POST');
    expect(standardRequest!.url).toBe('/responses');
    expect(standardRequest!.body).toMatchObject({
      model: 'gpt-5.5',
      stream: true,
      store: false,
      reasoning: {
        effort: 'xhigh',
        summary: 'auto',
      },
    });
    expect(standardRequest!.body).not.toHaveProperty('service_tier');
  });

  test('sends the received prompt into the real OpenAI runner loop and emits CLI output', async () => {
    const finalText = 'CLI_E2E_OK';
    await withCaptureServer(
      async ({ baseUrl, captured }) => {
        const tempRoot = makeTempDir('cli-claw-p0-openai-loop-');
        vi.stubEnv('CLI_CLAW_CODEX_ACCESS_TOKEN', 'test-token');
        vi.stubEnv('CLI_CLAW_CODEX_BASE_URL', baseUrl);
        vi.stubEnv(
          'CLI_CLAW_RUNTIME_SESSION_DIR',
          path.join(tempRoot, 'sessions'),
        );
        vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
        vi.stubEnv('no_proxy', '127.0.0.1,localhost');

        const { runOpenAiAgentLoop } =
          await import('../../../container/agent-runner/src/openai-agent-runtime.ts');
        const { outputs, deps } = buildRunnerDeps(tempRoot);

        await runOpenAiAgentLoop(
          {
            prompt: "what's up from Feishu ingress",
            groupFolder: 'main',
            chatJid: 'feishu:oc_p0_cli_io',
            agentType: 'openai',
            model: 'gpt-5.5',
            reasoningEffort: 'xhigh',
            speedTier: 'fast',
            turnId: 'om_p0_cli_io',
            messageCursor: {
              timestamp: '1778939000000',
              id: 'om_p0_cli_io',
            },
          },
          deps,
        );

        expect(captured).toHaveLength(1);
        expect(JSON.stringify(captured[0]!.body.input)).toContain(
          "what's up from Feishu ingress",
        );
        expect(captured[0]!.body).toMatchObject({
          model: 'gpt-5.5',
          stream: true,
          store: false,
          service_tier: 'priority',
          reasoning: {
            effort: 'xhigh',
            summary: 'auto',
          },
        });

        expect(outputs).toContainEqual(
          expect.objectContaining({
            status: 'stream',
            streamEvent: expect.objectContaining({
              eventType: 'text_delta',
              text: finalText,
              turnId: 'om_p0_cli_io',
              messageCursor: {
                timestamp: '1778939000000',
                id: 'om_p0_cli_io',
              },
            }),
          }),
        );
        expect(outputs).toContainEqual(
          expect.objectContaining({
            status: 'success',
            result: finalText,
            sourceKind: 'sdk_final',
            finalizationReason: 'completed',
          }),
        );
      },
      (_req, res) => writeSuccessfulResponsesStream(res, finalText),
    );
  });

  test('serializes workflow role instructions and filtered tools into the real SDK request body', async () => {
    const finalText = 'WORKFLOW_RUNNER_OK';
    await withCaptureServer(
      async ({ baseUrl, captured }) => {
        const tempRoot = makeTempDir('cli-claw-workflow-openai-loop-');
        vi.stubEnv('CLI_CLAW_CODEX_ACCESS_TOKEN', 'test-token');
        vi.stubEnv('CLI_CLAW_CODEX_BASE_URL', baseUrl);
        vi.stubEnv(
          'CLI_CLAW_RUNTIME_SESSION_DIR',
          path.join(tempRoot, 'sessions'),
        );
        vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
        vi.stubEnv('no_proxy', '127.0.0.1,localhost');

        const { runOpenAiAgentLoop } =
          await import('../../../container/agent-runner/src/openai-agent-runtime.ts');
        const { deps } = buildRunnerDeps(tempRoot);

        await runOpenAiAgentLoop(
          {
            prompt: 'workflow prompt',
            groupFolder: 'workspace-a',
            chatJid: 'web:workspace-a',
            agentType: 'openai',
            model: 'gpt-5.5',
            reasoningEffort: 'xhigh',
            speedTier: 'standard',
            workflow: {
              id: 'investment-research',
              name: '投研工作流',
              contextId: 'wfctx_1',
              runId: 'wfrun_1',
              threadId: 'wfctx_1',
              nodeId: 'research',
              nodeType: 'role_task',
            },
            role: {
              id: 'analyst',
              name: '投研分析师',
              description: '整理公开信息并形成观点',
              instructions: '只输出可溯源的投研结论。',
              skillIds: ['stock-analysis-skill'],
              permissionMode: 'readonly',
              allowedTools: ['send_message'],
            },
          },
          deps,
        );

        expect(captured).toHaveLength(1);
        expect(String(captured[0]!.body.instructions)).toContain(
          'Workflow: 投研工作流 (investment-research)',
        );
        expect(String(captured[0]!.body.instructions)).toContain(
          'Role: 投研分析师 (analyst)',
        );
        expect(String(captured[0]!.body.instructions)).toContain(
          '只输出可溯源的投研结论。',
        );
        const serializedTools = JSON.stringify(captured[0]!.body.tools);
        expect(serializedTools).toContain('send_message');
        expect(serializedTools).not.toContain('schedule_task');
      },
      (_req, res) => writeSuccessfulResponsesStream(res, finalText),
    );
  });

  test('single-turn workflow role runs stop after the first model response', async () => {
    const finalText = 'WORKFLOW_SINGLE_TURN_OK';
    await withCaptureServer(
      async ({ baseUrl, captured }) => {
        const tempRoot = makeTempDir('cli-claw-workflow-single-turn-');
        vi.stubEnv('CLI_CLAW_CODEX_ACCESS_TOKEN', 'test-token');
        vi.stubEnv('CLI_CLAW_CODEX_BASE_URL', baseUrl);
        vi.stubEnv(
          'CLI_CLAW_RUNTIME_SESSION_DIR',
          path.join(tempRoot, 'sessions'),
        );
        vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
        vi.stubEnv('no_proxy', '127.0.0.1,localhost');

        const { runOpenAiAgentLoop } =
          await import('../../../container/agent-runner/src/openai-agent-runtime.ts');
        const { outputs, deps } = buildRunnerDeps(tempRoot);
        const waitForIpcMessage = vi.fn(async () => ({
          text: 'this message must not be consumed',
        }));

        await runOpenAiAgentLoop(
          {
            prompt: 'workflow prompt',
            groupFolder: 'workspace-a',
            chatJid: 'web:workspace-a',
            agentType: 'openai',
            model: 'gpt-5.5',
            reasoningEffort: 'medium',
            speedTier: 'standard',
            singleTurn: true,
            workflow: {
              id: 'hkipo',
              name: '港股 IPO 打新工作流',
              contextId: 'wfctx_1',
              runId: 'wfrun_1',
              threadId: 'wfctx_1',
              nodeId: 'pool_normalizer',
              nodeType: 'role_task',
            },
            role: {
              id: 'hkipo-pool-normalizer',
              name: 'HK IPO Pool Normalizer',
              description: 'Normalize IPO pool',
              instructions: 'Return JSON only.',
              skillIds: ['stock-analysis-skill'],
              permissionMode: 'readonly',
              allowedTools: [],
            },
          },
          {
            ...deps,
            waitForIpcMessage,
          },
        );

        expect(captured).toHaveLength(1);
        expect(waitForIpcMessage).not.toHaveBeenCalled();
        expect(outputs).toContainEqual(
          expect.objectContaining({
            status: 'success',
            result: finalText,
            finalizationReason: 'completed',
          }),
        );
        expect(
          outputs.filter(
            (output) =>
              (output as { status?: string; result?: unknown }).status ===
                'success' &&
              (output as { result?: unknown }).result === null,
          ),
        ).toEqual([]);
      },
      (_req, res) => writeSuccessfulResponsesStream(res, finalText),
    );
  });

  test('stops after one Codex stream when terminal response output is empty', async () => {
    const finalText = 'CODEX_STREAM_DONE_OK';
    await withCaptureServer(
      async ({ baseUrl, captured }) => {
        const tempRoot = makeTempDir('cli-claw-p0-openai-codex-empty-');
        vi.stubEnv('CLI_CLAW_CODEX_ACCESS_TOKEN', 'test-token');
        vi.stubEnv('CLI_CLAW_CODEX_BASE_URL', baseUrl);
        vi.stubEnv(
          'CLI_CLAW_RUNTIME_SESSION_DIR',
          path.join(tempRoot, 'sessions'),
        );
        vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
        vi.stubEnv('no_proxy', '127.0.0.1,localhost');

        const { runOpenAiAgentLoop } =
          await import('../../../container/agent-runner/src/openai-agent-runtime.ts');
        const { outputs, deps } = buildRunnerDeps(tempRoot);

        await runOpenAiAgentLoop(
          {
            prompt: "what's up from Codex backend",
            groupFolder: 'main',
            chatJid: 'feishu:oc_p0_codex_empty',
            agentType: 'openai',
            model: 'gpt-5.5',
            reasoningEffort: 'xhigh',
            speedTier: 'fast',
            turnId: 'om_p0_codex_empty',
            messageCursor: {
              timestamp: '1778941000000',
              id: 'om_p0_codex_empty',
            },
          },
          deps,
        );

        expect(captured).toHaveLength(1);
        expect(outputs).toContainEqual(
          expect.objectContaining({
            status: 'success',
            result: finalText,
            sourceKind: 'sdk_final',
            finalizationReason: 'completed',
          }),
        );
      },
      (_req, res) =>
        writeSuccessfulResponsesStream(res, finalText, {
          emptyTerminalOutput: true,
        }),
    );
  });

  test('normalizes malformed Codex terminal response output before SDK conversion', async () => {
    const finalText = 'CODEX_MALFORMED_TERMINAL_OK';
    await withCaptureServer(
      async ({ baseUrl }) => {
        const tempRoot = makeTempDir('cli-claw-p0-openai-codex-malformed-');
        vi.stubEnv('CLI_CLAW_CODEX_ACCESS_TOKEN', 'test-token');
        vi.stubEnv('CLI_CLAW_CODEX_BASE_URL', baseUrl);
        vi.stubEnv(
          'CLI_CLAW_RUNTIME_SESSION_DIR',
          path.join(tempRoot, 'sessions'),
        );
        vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
        vi.stubEnv('no_proxy', '127.0.0.1,localhost');

        const { runOpenAiAgentLoop } =
          await import('../../../container/agent-runner/src/openai-agent-runtime.ts');
        const { outputs, deps } = buildRunnerDeps(tempRoot);

        await runOpenAiAgentLoop(
          {
            prompt: 'handle malformed terminal response',
            groupFolder: 'main',
            chatJid: 'feishu:oc_p0_codex_malformed',
            agentType: 'openai',
            model: 'gpt-5.5',
            reasoningEffort: 'xhigh',
            speedTier: 'fast',
            turnId: 'om_p0_codex_malformed',
            messageCursor: {
              timestamp: '1778942000000',
              id: 'om_p0_codex_malformed',
            },
          },
          deps,
        );

        expect(outputs).toContainEqual(
          expect.objectContaining({
            status: 'success',
            result: finalText,
            sourceKind: 'sdk_final',
            finalizationReason: 'completed',
          }),
        );
      },
      (_req, res) =>
        writeSuccessfulResponsesStream(res, finalText, {
          malformedTerminalOutput: true,
        }),
    );
  });

  test('does not replay non-persisted Codex response item ids on the next session turn', async () => {
    await withCaptureServer(
      async ({ baseUrl, captured }) => {
        const tempRoot = makeTempDir('cli-claw-p0-openai-session-');
        vi.stubEnv('CLI_CLAW_CODEX_ACCESS_TOKEN', 'test-token');
        vi.stubEnv('CLI_CLAW_CODEX_BASE_URL', baseUrl);
        vi.stubEnv(
          'CLI_CLAW_RUNTIME_SESSION_DIR',
          path.join(tempRoot, 'sessions'),
        );
        vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
        vi.stubEnv('no_proxy', '127.0.0.1,localhost');

        const { runOpenAiAgentLoop } =
          await import('../../../container/agent-runner/src/openai-agent-runtime.ts');
        const { deps } = buildRunnerDeps(tempRoot);
        let nextMessageDelivered = false;

        await runOpenAiAgentLoop(
          {
            prompt: "what's up from Feishu",
            groupFolder: 'main',
            chatJid: 'feishu:oc_p0_session',
            agentType: 'openai',
            model: 'gpt-5.5',
            reasoningEffort: 'xhigh',
            speedTier: 'fast',
            turnId: 'om_p0_session_first',
            messageCursor: {
              timestamp: '1778942000000',
              id: 'om_p0_session_first',
            },
          },
          {
            ...deps,
            generateTurnId: () => 'om_p0_session_second',
            waitForIpcMessage: async () => {
              if (nextMessageDelivered) return null;
              nextMessageDelivered = true;
              return {
                text: '你记得当前线程我们说过些什么吗？总结下',
                cursor: {
                  timestamp: '1778942005000',
                  id: 'om_p0_session_second',
                },
              };
            },
          },
        );

        expect(captured).toHaveLength(2);
        const secondInput = JSON.stringify(captured[1]!.body.input);
        expect(secondInput).toContain("what's up from Feishu");
        expect(secondInput).toContain('你记得当前线程我们说过些什么吗？总结下');
        expect(secondInput).not.toContain('rs_session_leak');
        expect(secondInput).not.toContain('msg_session_leak');
      },
      (_req, res, _body) => {
        const isFirstTurn = _body.input
          ? JSON.stringify(_body.input).includes("what's up from Feishu")
          : false;
        writeSuccessfulResponsesStream(
          res,
          isFirstTurn ? 'first turn ok' : 'second turn ok',
          {
            emptyTerminalOutput: true,
            messageId: isFirstTurn ? 'msg_session_leak' : 'msg_second',
            reasoningId: isFirstTurn ? 'rs_session_leak' : undefined,
          },
        );
      },
    );
  });

  test('does not replay non-persisted Codex response item ids during tool continuation', async () => {
    const finalText = 'TOOL_LOOP_DONE_OK';
    await withCaptureServer(
      async ({ baseUrl, captured }) => {
        const tempRoot = makeTempDir('cli-claw-p0-openai-tool-loop-');
        vi.stubEnv('CLI_CLAW_CODEX_ACCESS_TOKEN', 'test-token');
        vi.stubEnv('CLI_CLAW_CODEX_BASE_URL', baseUrl);
        vi.stubEnv(
          'CLI_CLAW_RUNTIME_SESSION_DIR',
          path.join(tempRoot, 'sessions'),
        );
        vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
        vi.stubEnv('no_proxy', '127.0.0.1,localhost');

        const { runOpenAiAgentLoop } =
          await import('../../../container/agent-runner/src/openai-agent-runtime.ts');
        const { outputs, deps } = buildRunnerDeps(tempRoot);

        await runOpenAiAgentLoop(
          {
            prompt: 'send a progress note, then answer',
            groupFolder: 'main',
            chatJid: 'feishu:oc_p0_tool_loop',
            agentType: 'openai',
            model: 'gpt-5.5',
            reasoningEffort: 'xhigh',
            speedTier: 'standard',
            turnId: 'om_p0_tool_loop',
            messageCursor: {
              timestamp: '1778943000000',
              id: 'om_p0_tool_loop',
            },
          },
          deps,
        );

        expect(captured).toHaveLength(2);
        const secondInput = JSON.stringify(captured[1]!.body.input);
        expect(secondInput).toContain('function_call_output');
        expect(secondInput).toContain('call_tool_loop');
        expect(secondInput).not.toContain('rs_tool_loop_leak');
        expect(secondInput).not.toContain('fc_tool_loop_leak');
        expect(outputs).toContainEqual(
          expect.objectContaining({
            status: 'success',
            result: finalText,
            sourceKind: 'sdk_final',
            finalizationReason: 'completed',
          }),
        );
      },
      (_req, res, body) => {
        const isToolContinuation = JSON.stringify(body.input).includes(
          'function_call_output',
        );
        if (isToolContinuation) {
          writeSuccessfulResponsesStream(res, finalText);
          return;
        }
        writeToolCallResponsesStream(res);
      },
    );
  });
});
