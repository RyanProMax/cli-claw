import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  buildMinimalNecessaryReplyGuidelines,
  buildMinimalNecessaryReplyPolicyBlock,
  MINIMAL_NECESSARY_REPLY_POLICY,
  wrapCodexPromptWithReplyPolicy,
} from '../container/agent-runner/src/reply-policy.ts';

describe('minimal necessary reply policy', () => {
  test('defines a concise default for user-visible replies', () => {
    expect(MINIMAL_NECESSARY_REPLY_POLICY.defaultRule).toContain(
      '最小必要原则',
    );
    expect(MINIMAL_NECESSARY_REPLY_POLICY.include).toContain('验证结果');
    expect(MINIMAL_NECESSARY_REPLY_POLICY.exclude).toContain('过程性叙述');
    expect(MINIMAL_NECESSARY_REPLY_POLICY.exceptions).toContain('用户明确要求');
  });

  test('renders prompt text with include, exclude, and exception clauses', () => {
    const guidelines = buildMinimalNecessaryReplyGuidelines();

    expect(guidelines).toContain('## 最小必要回复策略');
    expect(guidelines).toContain('只输出影响用户决策');
    expect(guidelines).toContain('不要把过程性叙述');
    expect(guidelines).toContain('用户明确要求详细解释');
  });

  test('renders a shared reply-policy block for Claude and Codex prompt injection', () => {
    expect(buildMinimalNecessaryReplyPolicyBlock()).toBe(
      `<reply-policy>\n${buildMinimalNecessaryReplyGuidelines()}\n</reply-policy>`,
    );
  });

  test('wraps Codex ACP prompts with the shared reply policy without mutating the user message', () => {
    const prompt = '继续任务\n\n请只说下一步。';
    const wrapped = wrapCodexPromptWithReplyPolicy(prompt);

    expect(wrapped).toContain(buildMinimalNecessaryReplyPolicyBlock());
    expect(wrapped).toContain('<user-message>');
    expect(wrapped).toContain(prompt);
    expect(wrapped).not.toBe(prompt);
  });

  test('uses the shared reply-policy block in both Claude and Codex runner paths', () => {
    const runnerSource = fs.readFileSync(
      new URL('../container/agent-runner/src/index.ts', import.meta.url),
      'utf8',
    );

    expect(runnerSource).toContain('buildMinimalNecessaryReplyPolicyBlock()');
    expect(runnerSource).toContain('wrapCodexPromptWithReplyPolicy(prompt)');
  });
});
