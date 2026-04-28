import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

describe('no cli-claw context injection', () => {
  test('agent runner does not inject managed memory, heartbeat, or reply-policy wrappers', () => {
    const runnerSource = fs.readFileSync(
      new URL('../container/agent-runner/src/index.ts', import.meta.url),
      'utf8',
    );

    expect(runnerSource).not.toContain('HEARTBEAT.md');
    expect(runnerSource).not.toContain('<recent-work>');
    expect(runnerSource).not.toContain('<user-profile>');
    expect(runnerSource).not.toContain('<memory-system>');
    expect(runnerSource).not.toContain('buildMemoryRecallPrompt');
    expect(runnerSource).not.toContain('wrapCodexPromptWithReplyPolicy');
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
    const toolSource = fs.readFileSync(
      new URL('../container/agent-runner/src/mcp-tools.ts', import.meta.url),
      'utf8',
    );
    const runnerSource = fs.readFileSync(
      new URL('../container/agent-runner/src/index.ts', import.meta.url),
      'utf8',
    );

    expect(toolSource).not.toContain('memory_append');
    expect(toolSource).not.toContain('memory_search');
    expect(toolSource).not.toContain('memory_get');
    expect(runnerSource).not.toContain('conversationsDir');
    expect(runnerSource).not.toContain('formatTranscriptMarkdown');
  });
});
