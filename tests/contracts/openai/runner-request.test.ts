import { createServer, type IncomingMessage } from 'node:http';
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
): Promise<T> {
  const captured: CapturedRequest[] = [];
  const server = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    captured.push({ method: req.method, url: req.url, body });
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
});
