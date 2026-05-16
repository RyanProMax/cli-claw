import { describe, expect, test } from 'vitest';

import {
  SELF_RESTART_REQUEST_CHAT_JID_ENV,
  writeSelfRestartRequestChatJidToEnv,
} from '../../../../src/core/self/self-restart.js';

describe('host restart context env', () => {
  test('stores direct IM chat jids for external restart callbacks', () => {
    const env: NodeJS.ProcessEnv = {};
    writeSelfRestartRequestChatJidToEnv(env, 'feishu:chat-1');
    expect(env[SELF_RESTART_REQUEST_CHAT_JID_ENV]).toBe('feishu:chat-1');
  });

  test('skips non-IM chat jids when preparing external restart callbacks', () => {
    const env: NodeJS.ProcessEnv = {};
    writeSelfRestartRequestChatJidToEnv(env, 'web:main');
    expect(env[SELF_RESTART_REQUEST_CHAT_JID_ENV]).toBeUndefined();
  });
});
