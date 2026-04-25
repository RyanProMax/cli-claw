import { describe, expect, test } from 'vitest';

import {
  buildMinimalNecessaryReplyGuidelines,
  MINIMAL_NECESSARY_REPLY_POLICY,
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
});
