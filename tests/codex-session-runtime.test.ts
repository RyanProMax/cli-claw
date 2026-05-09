import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  appendCodexFinalTurnChunk,
  appendCodexTurnChunk,
  createCodexTranscriptCheckpoint,
  buildCodexTranscriptTurnResolution,
  buildCodexAcpConfigOverrides,
  buildCodexAcpLaunchArgs,
  extractCodexTranscriptPhaseMessagesFromJsonl,
  extractCodexAssistantMessagePhase,
  formatCodexRuntimeError,
  isCodexContextWindowError,
  isCodexRemoteCompactParameterError,
  mergeRuntimeIdentityState,
  normalizeCodexAssistantMessagePhase,
  resolveCodexTranscriptTurn,
  shouldEmitCodexSessionUpdate,
  stripCodexRuntimeDiagnosticPrefix,
} from '../container/agent-runner/src/codex-session-runtime.ts';

describe('codex ACP runtime overrides', () => {
  test('builds startup config overrides from requested model and reasoning', () => {
    expect(
      buildCodexAcpConfigOverrides({
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
        speedTier: 'fast',
      }),
    ).toEqual([
      'model="gpt-5.4"',
      'model_reasoning_effort="medium"',
      'service_tier="fast"',
    ]);
  });

  test('omits service_tier override for standard speed', () => {
    expect(
      buildCodexAcpConfigOverrides({
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
        speedTier: 'standard',
      }),
    ).toEqual(['model="gpt-5.4"', 'model_reasoning_effort="medium"']);
  });

  test('normalizes slash-suffixed values before building overrides', () => {
    expect(
      buildCodexAcpConfigOverrides({
        model: 'gpt-5.4/xhigh',
        reasoningEffort: 'reasoning/medium',
      }),
    ).toEqual(['model="gpt-5.4"', 'model_reasoning_effort="medium"']);
  });

  test('adds config overrides to npx launches without mutating direct binaries', () => {
    expect(
      buildCodexAcpLaunchArgs({
        acpCommand: 'npx',
        requestedRuntime: {
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
          speedTier: 'fast',
        },
      }),
    ).toEqual([
      '-y',
      '@zed-industries/codex-acp',
      '-c',
      'model="gpt-5.4"',
      '-c',
      'model_reasoning_effort="medium"',
      '-c',
      'service_tier="fast"',
    ]);

    expect(
      buildCodexAcpLaunchArgs({
        acpCommand:
          '/Users/ryan/.npm/_npx/e3854e347c184741/node_modules/@zed-industries/codex-acp-darwin-arm64/bin/codex-acp',
        requestedRuntime: {
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
      }),
    ).toEqual([
      '-c',
      'model="gpt-5.4"',
      '-c',
      'model_reasoning_effort="medium"',
    ]);
  });

  test('keeps ACP session recovery updates private until a live prompt is active', () => {
    expect(
      shouldEmitCodexSessionUpdate({
        livePromptActive: false,
      }),
    ).toBe(false);

    expect(
      shouldEmitCodexSessionUpdate({
        livePromptActive: true,
      }),
    ).toBe(true);
  });

  test('preserves requested speed when ACP session metadata omits service tier', () => {
    expect(
      mergeRuntimeIdentityState(
        {
          agentType: 'codex',
          model: 'gpt-5.5',
          reasoningEffort: 'xhigh',
          speedTier: 'fast',
          supportsReasoningEffort: true,
        },
        {
          agentType: 'codex',
          model: 'gpt-5.5',
          reasoningEffort: 'xhigh',
          speedTier: null,
          supportsReasoningEffort: true,
        },
      ),
    ).toEqual({
      agentType: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
      supportsReasoningEffort: true,
    });
  });

  test('preserves blank-line boundaries between same-turn Codex assistant messages', () => {
    const first = appendCodexTurnChunk('', {
      text: '我先核对当前计划和服务进程状态。',
      messageUuid: 'msg-1',
    });
    const second = appendCodexTurnChunk(
      first.text,
      {
        text: '然后我会直接把重启和效果验证补完。',
        messageUuid: 'msg-2',
      },
      first.lastMessageUuid,
    );

    expect(second).toEqual({
      text: '我先核对当前计划和服务进程状态。\n\n然后我会直接把重启和效果验证补完。',
      lastMessageUuid: 'msg-2',
    });
  });

  test('keeps only the latest Codex assistant message for final output', () => {
    const replayed = appendCodexFinalTurnChunk('', {
      text: '旧回复第一段。',
      messageUuid: 'old-msg',
    });
    const current = appendCodexFinalTurnChunk(
      replayed.text,
      {
        text: '当前回复。',
        messageUuid: 'new-msg',
      },
      replayed.lastMessageUuid,
    );

    expect(current).toEqual({
      text: '当前回复。',
      lastMessageUuid: 'new-msg',
    });
  });

  test('continues accumulating chunks from the same Codex final message', () => {
    const first = appendCodexFinalTurnChunk('', {
      text: '当前',
      messageUuid: 'msg-1',
    });
    const second = appendCodexFinalTurnChunk(
      first.text,
      {
        text: '回复。',
        messageUuid: 'msg-1',
      },
      first.lastMessageUuid,
    );

    expect(second).toEqual({
      text: '当前回复。',
      lastMessageUuid: 'msg-1',
    });
  });

  test('does not accumulate Codex commentary phase into terminal final output', () => {
    const commentary = appendCodexFinalTurnChunk('', {
      text: '我会先检查当前链路。',
      messageUuid: 'msg-commentary',
      assistantMessagePhase: 'commentary',
    });
    const final = appendCodexFinalTurnChunk(
      commentary.text,
      {
        text: '最终结论。',
        messageUuid: 'msg-final',
        assistantMessagePhase: 'final_answer',
      },
      commentary.lastMessageUuid,
    );

    expect(commentary).toEqual({
      text: '',
      lastMessageUuid: undefined,
    });
    expect(final).toEqual({
      text: '最终结论。',
      lastMessageUuid: 'msg-final',
    });
  });

  test('extracts Codex assistant phase from ACP update metadata fields', () => {
    expect(normalizeCodexAssistantMessagePhase('commentary')).toBe(
      'commentary',
    );
    expect(normalizeCodexAssistantMessagePhase('final_answer')).toBe(
      'final_answer',
    );
    expect(normalizeCodexAssistantMessagePhase('answer')).toBeUndefined();
    expect(extractCodexAssistantMessagePhase({ phase: 'commentary' })).toBe(
      'commentary',
    );
    expect(
      extractCodexAssistantMessagePhase({
        content: { _meta: { phase: 'final_answer' } },
      }),
    ).toBe('final_answer');
    expect(
      extractCodexAssistantMessagePhase({
        content: { type: 'text', text: '我会先检查当前链路。' },
      }),
    ).toBeUndefined();
  });

  test('extracts native Codex transcript phase messages without response-item duplicates', () => {
    const jsonl = [
      JSON.stringify({
        timestamp: '2026-05-09T07:34:07.443Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: '没有固定前缀的中间状态。',
          phase: 'commentary',
        },
      }),
      JSON.stringify({
        timestamp: '2026-05-09T07:34:07.444Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '重复副本。' }],
          phase: 'commentary',
        },
      }),
      JSON.stringify({
        timestamp: '2026-05-09T07:34:44.211Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: '最终结论。',
          phase: 'final_answer',
        },
      }),
    ].join('\n');

    const messages = extractCodexTranscriptPhaseMessagesFromJsonl(jsonl, {
      startedAtIso: '2026-05-09T07:34:00.000Z',
    });
    const resolution = buildCodexTranscriptTurnResolution(
      messages,
      '/tmp/session.jsonl',
    );

    expect(messages).toEqual([
      {
        phase: 'commentary',
        text: '没有固定前缀的中间状态。',
        timestamp: '2026-05-09T07:34:07.443Z',
      },
      {
        phase: 'final_answer',
        text: '最终结论。',
        timestamp: '2026-05-09T07:34:44.211Z',
      },
    ]);
    expect(resolution).toEqual({
      transcriptPath: '/tmp/session.jsonl',
      messages,
      commentaryText: '没有固定前缀的中间状态。',
      finalAnswerText: '最终结论。',
    });
  });

  test('resolves native Codex transcript phases after the prompt checkpoint only', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sessions-'));
    try {
      const sessionId = 'test-session-123';
      const transcriptDir = path.join(tempDir, '2026', '05', '09');
      fs.mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = path.join(
        transcriptDir,
        `rollout-2026-05-09T07-30-00-${sessionId}.jsonl`,
      );
      fs.writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          timestamp: '2026-05-09T07:29:59.000Z',
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            phase: 'final_answer',
            message: '旧轮次正文。',
          },
        })}\n`,
      );

      const checkpoint = createCodexTranscriptCheckpoint(sessionId, {
        now: new Date('2026-05-09T07:30:00.000Z'),
        sessionsDir: tempDir,
      });

      fs.appendFileSync(
        transcriptPath,
        [
          JSON.stringify({
            timestamp: '2026-05-09T07:30:01.000Z',
            type: 'event_msg',
            payload: {
              type: 'agent_message',
              phase: 'commentary',
              message: '本轮过程。',
            },
          }),
          JSON.stringify({
            timestamp: '2026-05-09T07:30:02.000Z',
            type: 'event_msg',
            payload: {
              type: 'agent_message',
              phase: 'final_answer',
              message: '本轮正文。',
            },
          }),
        ].join('\n') + '\n',
      );

      expect(resolveCodexTranscriptTurn(checkpoint)).toMatchObject({
        transcriptPath,
        commentaryText: '本轮过程。',
        finalAnswerText: '本轮正文。',
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('strips Codex model metadata diagnostics from assistant chunks', () => {
    expect(
      stripCodexRuntimeDiagnosticPrefix(
        'Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.',
      ),
    ).toBe('');

    expect(
      stripCodexRuntimeDiagnosticPrefix(
        'Model metadata for gpt-5.5 not found. Defaulting to fallback metadata; this can degrade performance and cause issues.我看一下当前状态。',
      ),
    ).toBe('我看一下当前状态。');

    expect(stripCodexRuntimeDiagnosticPrefix('正常回答')).toBe('正常回答');
  });

  test('strips Codex transport fallback diagnostics from assistant chunks', () => {
    expect(
      stripCodexRuntimeDiagnosticPrefix(
        'Falling back from WebSockets to HTTPS transport. stream disconnected before completion: tls handshake eof收到新消息，我先暂停重启动作。',
      ),
    ).toBe('收到新消息，我先暂停重启动作。');

    expect(
      stripCodexRuntimeDiagnosticPrefix(
        'Falling back from WebSockets to HTTPS transport. stream disconnected before completion: The model `gpt-5.5` does not exist or you do not have access to it.\n\n---\n*⚠️ 已中断*',
      ),
    ).toBe('---\n*⚠️ 已中断*');
  });

  test('keeps diagnostics out of final Codex turn accumulation', () => {
    const cleaned = stripCodexRuntimeDiagnosticPrefix(
      'Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.我看一下当前状态。',
    );
    const appended = appendCodexTurnChunk('', {
      text: cleaned,
      messageUuid: 'msg-1',
    });

    expect(appended).toEqual({
      text: '我看一下当前状态。',
      lastMessageUuid: 'msg-1',
    });
  });

  test('formats Codex context-window JSON-RPC errors into a clear recovery hint', () => {
    const error = JSON.stringify(
      {
        message: 'Internal error',
        code: -32603,
        data: {
          message:
            "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
          codex_error_info: 'context_window_exceeded',
        },
      },
      null,
      2,
    );

    expect(isCodexContextWindowError(error)).toBe(true);
    const formatted = formatCodexRuntimeError(error, { isCodexRuntime: true });
    expect(formatted).toBe(
      'Codex 上下文窗口已满，当前会话历史太长，无法继续。请发送 /clear 清除当前会话上下文后重试，或在新会话里重新描述需求。',
    );
    expect(formatted).not.toContain('Internal error');
    expect(formatted).not.toContain('context_window_exceeded');
  });

  test('formats Codex remote compact parameter errors without leaking raw JSON', () => {
    const error = JSON.stringify(
      {
        message: 'Internal error',
        code: -32603,
        data: {
          message:
            'Error running remote compact task: { "error": { "message": "Unknown parameter: \'safety_identifier\'.", "type": "invalid_request_error", "param": "safety_identifier", "code": "unknown_parameter" } }',
          codex_error_info: 'other',
        },
      },
      null,
      2,
    );

    const formatted = formatCodexRuntimeError(error, { isCodexRuntime: true });
    expect(isCodexRemoteCompactParameterError(error)).toBe(true);
    expect(formatted).toBe(
      'Codex 上下文压缩失败：当前 Codex 运行时向远端 compact 接口发送了不兼容参数 safety_identifier。任务已中断；请升级或重启 Codex runtime 后重试，必要时发送 /clear 清除当前会话上下文。',
    );
    expect(formatted).not.toContain('Internal error');
    expect(formatted).not.toContain('unknown_parameter');
    expect(formatted).not.toContain('{ "error"');
  });

  test('keeps Codex auth and quota errors user-facing after formatting', () => {
    expect(
      formatCodexRuntimeError(
        'codex error: auth_required, please login before continuing',
      ),
    ).toBe('Codex CLI 未登录。请先在服务器上执行：codex login');

    expect(
      formatCodexRuntimeError(`
        visit https://chatgpt.com/codex/settings/usage to purchase more credits
        or try again at 1:41 AM. Some(UsageLimitExceeded)
      `),
    ).toBe(
      'Codex CLI 用量已用尽。请前往 https://chatgpt.com/codex/settings/usage 购买额度，或在 1:41 AM 后重试。',
    );
  });
});
