import { describe, expect, test } from 'vitest';

import {
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
});
