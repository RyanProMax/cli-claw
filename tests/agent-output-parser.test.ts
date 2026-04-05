import { describe, expect, test } from 'vitest';

import { formatUserFacingRuntimeError } from '../src/agent-output-parser.ts';

describe('formatUserFacingRuntimeError', () => {
  test('formats Codex usage-limit errors into a user-facing retry message', () => {
    const stderr = `
      Host agent exited with code 1:
      visit https://chatgpt.com/codex/settings/usage to purchase more credits
      or try again at 1:41 AM. Some(UsageLimitExceeded)
    `;

    expect(formatUserFacingRuntimeError(stderr)).toBe(
      'Codex CLI 用量已用尽。请前往 https://chatgpt.com/codex/settings/usage 购买额度，或在 1:41 AM 后重试。',
    );
  });

  test('formats Codex login errors into a user-facing login hint', () => {
    const stderr = 'codex error: auth_required, please login before continuing';

    expect(formatUserFacingRuntimeError(stderr)).toBe(
      'Codex CLI 未登录。请先在服务器上执行：codex login',
    );
  });
});
