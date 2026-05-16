import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test, vi } from 'vitest';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function walkFiles(root: string): string[] {
  const result: string[] = [];
  const absoluteRoot = path.join(repoRoot, root);
  if (!fs.existsSync(absoluteRoot)) return result;
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === '.git'
    ) {
      continue;
    }
    const fullPath = path.join(absoluteRoot, entry.name);
    const relativePath = path.relative(repoRoot, fullPath);
    if (entry.isDirectory()) {
      result.push(...walkFiles(relativePath));
      continue;
    }
    if (/\.(ts|tsx|js|jsx|json|md)$/.test(entry.name)) {
      result.push(relativePath);
    }
  }
  return result;
}

describe('no cli-claw context injection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('agent runner does not inject managed memory, heartbeat, or reply-policy wrappers', () => {
    const runnerSource = readRepoFile('container/agent-runner/src/index.ts');

    expect(runnerSource).not.toContain('HEARTBEAT.md');
    expect(runnerSource).not.toContain('<recent-work>');
    expect(runnerSource).not.toContain('<user-profile>');
    expect(runnerSource).not.toContain('<memory-system>');
    expect(runnerSource).not.toContain('buildMemoryRecallPrompt');
    expect(runnerSource).not.toContain('wrapOpenAIPromptWithReplyPolicy');
    expect(runnerSource).not.toContain('autoContinuePrompt');
    expect(runnerSource).not.toContain('flushPrompt');
  });

  test('legacy reply policy module has been removed', () => {
    expect(
      fs.existsSync(
        new URL(
          '../container/agent-runner/src/reply-policy.ts',
          import.meta.url,
        ),
      ),
    ).toBe(false);
  });

  test('runner does not expose cli-claw memory tools or transcript archives', () => {
    const toolSource = readRepoFile('container/agent-runner/src/mcp-tools.ts');
    const runnerSource = readRepoFile('container/agent-runner/src/index.ts');

    expect(toolSource).not.toContain('memory_append');
    expect(toolSource).not.toContain('memory_search');
    expect(toolSource).not.toContain('memory_get');
    expect(runnerSource).not.toContain('conversationsDir');
    expect(runnerSource).not.toContain('formatTranscriptMarkdown');
  });

  test('production files do not retain cli-claw context injection surfaces', () => {
    const files = [
      ...walkFiles('src'),
      ...walkFiles('shared'),
      ...walkFiles('container/agent-runner/src'),
      ...walkFiles('web/src'),
      ...walkFiles('config'),
      'README.md',
      'docs/ARCHITECTURE.md',
      'docs/COMMAND.md',
      'docs/MEMORY.md',
      'docs/MODULE.md',
      'docs/RUNTIME.md',
    ];

    const banned: RegExp[] = [
      /workspace-autopilot/i,
      /\/recall\b|name:\s*['"]recall|formatContextMessages|getConversationContext/i,
      /active-plan-progress|appendActivePlanProgress/i,
      /Memory(Global|File|Source|SearchHit)|memory_(append|search|get)|daily-summary|project-memory|routes\/memory|MemoryPage/i,
      /HEARTBEAT\.md|<recent-work>|<memory-system>|<reply-policy>|global-agents-md|wrapOpenAIPromptWithReplyPolicy|buildMemoryRecallPrompt|formatTranscriptMarkdown|conversationsDir|transcript_archive/i,
      /CLAUDE\.md|\.claude\/rules|settingSources:\s*\[\s*['"]project/i,
    ];

    const violations: string[] = [];
    for (const file of files) {
      if (file === 'src/reply-visibility.ts') {
        continue;
      }
      const content = readRepoFile(file);
      for (const pattern of banned) {
        if (pattern.test(content)) {
          violations.push(`${file}: ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('sdk send_message visible path uses the same visibility guard as final replies', () => {
    const indexSource = readRepoFile('src/index.ts');
    const start = indexSource.indexOf("if (data.type === 'message'");
    const end = indexSource.indexOf('} else if (', start);
    const messageIpcPath = indexSource.slice(start, end);

    expect(messageIpcPath).toContain('resolveVisibleReplyParts');
    expect(messageIpcPath).not.toMatch(/sendImWithFailTracking\([^,]+,\s*data\.text/);
    expect(messageIpcPath).not.toMatch(/broadcastToOwnerIMChannels[\s\S]*data\.text/);
  });

  test('session settings MCP sync removes servers that are no longer configured', async () => {
    vi.stubEnv('WEB_SESSION_SECRET', 'test-secret');
    const { ensureSettingsJson } = (await import(
      '../src/container-runner.js'
    )) as unknown as {
      ensureSettingsJson: (
        settingsFile: string,
        mcpServers?: Record<string, Record<string, unknown>>,
      ) => void;
    };
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-mcp-settings-'),
    );
    const settingsFile = path.join(tempDir, 'settings.json');
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          env: { KEEP_ME: '1' },
          mcpServers: {
            staleMemory: { command: 'old-memory-server' },
            keepButReplace: { command: 'old-safe-server' },
          },
        },
        null,
        2,
      ),
    );

    ensureSettingsJson(settingsFile, {
      keepButReplace: { command: 'new-safe-server', args: ['--fresh'] },
    });

    const synced = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(synced.mcpServers).toEqual({
      keepButReplace: { command: 'new-safe-server', args: ['--fresh'] },
    });

    ensureSettingsJson(settingsFile, {});

    const cleared = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(cleared).not.toHaveProperty('mcpServers');
  });

  test('agent runner filters context-like MCP servers by id and connection strings', () => {
    const runnerSource = readRepoFile('container/agent-runner/src/index.ts');
    const start = runnerSource.indexOf('function isContextLikeMcpServer');
    const end = runnerSource.indexOf('function loadUserMcpServers', start);
    const filterSource = runnerSource.slice(start, end);

    expect(filterSource).toContain('command');
    expect(filterSource).toContain('url');
    expect(filterSource).toContain('args');
    expect(filterSource).toContain('env');
  });

  test('agent runner does not load MCP servers from workspace claude settings', () => {
    const runnerSource = readRepoFile('container/agent-runner/src/index.ts');

    expect(runnerSource).not.toContain('loadWorkspaceMcpServers');
    expect(runnerSource).not.toContain(
      "path.join(WORKSPACE_GROUP, '.claude', 'settings.json')",
    );
  });
});
