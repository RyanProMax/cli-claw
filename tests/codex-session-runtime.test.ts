import { describe, expect, test } from 'vitest';

import {
  appendCodexTurnChunk,
  buildCodexAcpConfigOverrides,
  buildCodexAcpLaunchArgs,
} from '../container/agent-runner/src/codex-session-runtime.ts';

describe('codex ACP runtime overrides', () => {
  test('builds startup config overrides from requested model and reasoning', () => {
    expect(
      buildCodexAcpConfigOverrides({
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      }),
    ).toEqual([
      'model="gpt-5.4"',
      'model_reasoning_effort="medium"',
    ]);
  });

  test('normalizes slash-suffixed values before building overrides', () => {
    expect(
      buildCodexAcpConfigOverrides({
        model: 'gpt-5.4/xhigh',
        reasoningEffort: 'reasoning/medium',
      }),
    ).toEqual([
      'model="gpt-5.4"',
      'model_reasoning_effort="medium"',
    ]);
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
    ).toEqual(['-c', 'model="gpt-5.4"', '-c', 'model_reasoning_effort="medium"']);
  });

  test('preserves blank-line boundaries between same-turn Codex assistant messages', () => {
    const first = appendCodexTurnChunk('', {
      text: '我先核对当前计划和服务进程状态。',
      messageUuid: 'msg-1',
    });
    const second = appendCodexTurnChunk(first.text, {
      text: '然后我会直接把重启和效果验证补完。',
      messageUuid: 'msg-2',
    }, first.lastMessageUuid);

    expect(second).toEqual({
      text:
        '我先核对当前计划和服务进程状态。\n\n然后我会直接把重启和效果验证补完。',
      lastMessageUuid: 'msg-2',
    });
  });
});
