import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  createStderrState,
  createStdoutParserState,
  writeRunLog,
} from '../../../../src/agent/runner/output-parser.js';

describe('writeRunLog', () => {
  test('includes agent identity and build metadata in summary', () => {
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-run-log-'));
    const stdoutState = createStdoutParserState();
    const stderrState = createStderrState();
    stderrState.stderr = '[agent-runner] sample stderr';
    stdoutState.stdout = '{"status":"success"}';

    const logFile = writeRunLog(
      {
        groupName: 'Main',
        label: 'Agent Process',
        filePrefix: 'agent',
        identifier: 'agent-main-1',
        logsDir,
        input: {
          prompt: 'hello',
          sessionId: 'session-1',
          isHome: true,
          isAdminHome: true,
        },
        stdoutState,
        stderrState,
        resolvePromise: () => {},
        startTime: Date.now(),
        timeoutMs: 60_000,
        agentIdentity: {
          chatJid: 'web:main',
          groupFolder: 'main',
          agentType: 'openai',
          selectedRunner: 'openai',
        },
        runtimeBuildInfo: {
          backendPid: 1234,
          backendStartedAt: '2026-04-04T10:00:00.000Z',
          backendBuildLoaded: 'backend-loaded',
          backendBuildCurrent: 'backend-current',
          backendBuildStale: true,
          agentRunnerBuildLoaded: 'runner-loaded',
          agentRunnerBuildCurrent: 'runner-current',
          agentRunnerBuildStale: false,
        },
      } as any,
      0,
      1200,
    );

    const content = fs.readFileSync(logFile, 'utf8');
    expect(content).toContain('Chat JID: web:main');
    expect(content).toContain('Agent Type: openai');
    expect(content).not.toContain('Execution Mode:');
    expect(content).toContain('Selected Runner: openai');
    expect(content).toContain('Backend PID: 1234');
    expect(content).toContain('Backend Build Loaded: backend-loaded');
    expect(content).toContain('Agent Runner Build Current: runner-current');
  });
});
