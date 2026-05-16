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
      normalizeHomeFlags: () => ({ isHome: true, isAdminHome: true }),
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

function writeSuccessfulResponsesStream(
  res: ServerResponse,
  finalText: string,
): void {
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
        id: 'msg_1',
        type: 'message',
        status: 'in_progress',
        role: 'assistant',
        content: [],
      },
    }),
  );
  res.write(
    sse('response.content_part.added', {
      type: 'response.content_part.added',
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    }),
  );
  res.write(
    sse('response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      delta: finalText,
    }),
  );
  res.write(
    sse('response.completed', {
      type: 'response.completed',
      response: responseSnapshot(finalText, 'completed'),
    }),
  );
  res.end('data: [DONE]\n\n');
}

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
});
