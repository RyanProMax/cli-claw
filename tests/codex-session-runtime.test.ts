import { describe, expect, test } from 'vitest';

import {
  appendCodexFinalTurnChunk,
  appendCodexTurnChunk,
  buildCodexAcpConfigOverrides,
  buildCodexAcpLaunchArgs,
  formatCodexRuntimeError,
  isCodexContextWindowError,
  stripCodexRuntimeDiagnosticPrefix,
} from '../container/agent-runner/src/codex-session-runtime.ts';

describe('codex ACP runtime overrides', () => {
  test('builds startup config overrides from requested model and reasoning', () => {
    expect(
      buildCodexAcpConfigOverrides({
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
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
        },
      }),
    ).toEqual([
      '-y',
      '@zed-industries/codex-acp',
      '-c',
      'model="gpt-5.4"',
      '-c',
      'model_reasoning_effort="medium"',
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
