import { describe, expect, test } from 'vitest';

import {
  BLOCKED_AGENT_SAFE_RESTART_MESSAGE,
  BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE,
  detectUnsafeCliClawServiceControl,
  resolveManagedSelfRestartCommand,
} from '../shared/service-restart-guard.ts';

describe('resolveManagedSelfRestartCommand', () => {
  test('recognizes explicit restart-only operator phrases', () => {
    expect(resolveManagedSelfRestartCommand('重启服务')).toBe('self-restart');
    expect(resolveManagedSelfRestartCommand('请把 cli-claw 重启一下')).toBe(
      'self-restart',
    );
  });

  test('does not rewrite broader task prompts that merely mention restarting', () => {
    expect(
      resolveManagedSelfRestartCommand(
        '提交并重启，记住每次完成任务自动提交，如果任务涉及cliclaw服务变更自动重启',
      ),
    ).toBeNull();
  });
});

describe('detectUnsafeCliClawServiceControl', () => {
  test('blocks direct kills of the current backend pid', () => {
    expect(
      detectUnsafeCliClawServiceControl('kill 69981', {
        backendPid: 69981,
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
      }),
    ).toMatchObject({
      message: BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE,
    });
  });

  test('blocks direct launchctl control of the managed launch agent', () => {
    expect(
      detectUnsafeCliClawServiceControl(
        'launchctl bootout gui/501/com.ryan.cli-claw',
        {
          backendPid: 69981,
          launchdServiceName: 'gui/501/com.ryan.cli-claw',
        },
      ),
    ).toMatchObject({
      message: BLOCKED_CLI_CLAW_SERVICE_CONTROL_MESSAGE,
    });
  });

  test('allows the explicit safe restart command', () => {
    expect(
      detectUnsafeCliClawServiceControl('cli-claw restart', {
        backendPid: 69981,
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
      }),
    ).toBeNull();
  });

  test('blocks safe restart commands when agent-runner policy disallows them', () => {
    expect(
      detectUnsafeCliClawServiceControl('cli-claw restart', {
        backendPid: 69981,
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
        allowSafeRestartCommand: false,
      }),
    ).toMatchObject({
      reason: 'agent-initiated cli-claw safe restart command',
      message: BLOCKED_AGENT_SAFE_RESTART_MESSAGE,
    });

    expect(
      detectUnsafeCliClawServiceControl('bun src/cli.ts restart', {
        backendPid: 69981,
        launchdServiceName: 'gui/501/com.ryan.cli-claw',
        allowSafeRestartCommand: false,
      }),
    ).toMatchObject({
      reason: 'agent-initiated cli-claw safe restart command',
      message: BLOCKED_AGENT_SAFE_RESTART_MESSAGE,
    });
  });
});
