import { describe, expect, test } from 'vitest';

import {
  createStderrState,
  createStdoutParserState,
  formatUserFacingRuntimeError,
  handleNonZeroExit,
} from '../../../../src/agent/runner/output-parser.ts';

describe('formatUserFacingRuntimeError', () => {
  test('formats OpenAI usage-limit errors into a user-facing retry message', () => {
    const stderr = `
      Agent process exited with code 1:
      OpenAI API error: insufficient_quota; try again at 1:41 AM.
    `;

    expect(formatUserFacingRuntimeError(stderr)).toBe(
      'OpenAI API 用量或频率限制已触发，请在 1:41 AM 后重试。',
    );
  });

  test('formats OpenAI login errors into a user-facing login hint', () => {
    const stderr =
      'Codex CLI login is required. Run `codex login`, then retry.';

    expect(formatUserFacingRuntimeError(stderr)).toBe(
      'Codex CLI 登录态缺失或已过期。请执行 `codex login` 后重试。',
    );
  });

  test('formats OpenAI remote compact parameter errors without raw JSON', () => {
    const stderr = `
      {"message":"Internal error","code":-32603,"data":{"message":"Error running remote compact task: { \\"error\\": { \\"message\\": \\"Unknown parameter: 'safety_identifier'.\\", \\"type\\": \\"invalid_request_error\\", \\"param\\": \\"safety_identifier\\", \\"code\\": \\"unknown_parameter\\" } }"}}
    `;

    expect(formatUserFacingRuntimeError(stderr)).toBe(
      'OpenAI 上下文压缩失败：当前 OpenAI 运行时向远端 compact 接口发送了不兼容参数 safety_identifier。任务已中断；请升级或重启 OpenAI runtime 后重试，必要时发送 /clear 清除当前会话上下文。',
    );
  });

  test('formats Codex backend bare 400 errors without raw JSON', () => {
    const stderr = `{ "name": "Error", "message": "400 status code (no body)", "status": 400, "headers": {}, "requestID": null }`;

    const formatted = formatUserFacingRuntimeError(stderr);

    expect(formatted).toBe(
      'OpenAI runtime 请求被 Codex 后端拒绝（400）。请查看最新进程日志中的 request id，更新并重启 cli-claw 后重试。',
    );
    expect(formatted).not.toContain('"headers"');
    expect(formatted).not.toContain('"requestID"');
  });

  test('preserves an already-streamed error result on non-zero exit', async () => {
    const stdoutState = createStdoutParserState();
    stdoutState.lastErrorOutput = {
      status: 'error',
      result: 'OpenAI CLI 用量已用尽。请稍后重试。',
      error: 'OpenAI CLI 用量已用尽。请稍后重试。',
      finalizationReason: 'error',
    };

    let resolved: any = null;

    const handled = handleNonZeroExit(
      {
        groupName: 'main',
        label: 'Agent Process',
        filePrefix: 'agent',
        identifier: '123',
        logsDir: '/tmp',
        input: {
          prompt: 'hello',
          isHome: true,
          isAdminHome: true,
        },
        stdoutState,
        stderrState: createStderrState(),
        onOutput: async () => {},
        resolvePromise: (output) => {
          resolved = output;
        },
        startTime: Date.now(),
        timeoutMs: 30_000,
      },
      1,
      null,
      50,
      '/tmp/agent.log',
    );

    expect(handled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolved).toMatchObject({
      status: 'error',
      result: 'OpenAI CLI 用量已用尽。请稍后重试。',
      alreadyStreamedError: true,
      finalizationReason: 'error',
    });
  });
});
