import { describe, expect, test } from 'vitest';

import {
  BLOCKED_AGENT_SAFE_RESTART_MESSAGE,
  BLOCKED_AGENT_FABRIC_SERVICE_CONTROL_MESSAGE,
  detectAgentRunnerAgentFabricServiceControl,
  detectUnsafeAgentFabricServiceControl,
  resolveManagedSelfRestartCommand,
} from '../../../shared/service-restart-guard.ts';

describe('resolveManagedSelfRestartCommand', () => {
  test('recognizes explicit restart-only operator phrases', () => {
    expect(resolveManagedSelfRestartCommand('重启服务')).toBe('self-restart');
    expect(resolveManagedSelfRestartCommand('请把 agent-fabric 重启一下')).toBe(
      'self-restart',
    );
  });

  test('does not recognize obsolete-agent restart phrases', () => {
    expect(resolveManagedSelfRestartCommand('请把 legacy-agent 重启一下')).toBeNull();
    expect(resolveManagedSelfRestartCommand('请把 obsoleteagent 重启一下')).toBeNull();
  });

  test('does not rewrite broader task prompts that merely mention restarting', () => {
    expect(
      resolveManagedSelfRestartCommand(
        '提交并重启，记住每次完成任务自动提交，如果任务涉及agentfabric服务变更自动重启',
      ),
    ).toBeNull();
  });
});

describe('detectAgentRunnerAgentFabricServiceControl', () => {
  test('blocks mocked Feishu continuation turns from shell-triggering safe restart', () => {
    expect(
      detectAgentRunnerAgentFabricServiceControl(
        'cd /Users/ryan/projects/agent-fabric && agent-fabric restart',
        'feishu:oc_98f0bb60f284627bf20f9386704f8c82',
        {
          backendPid: 78587,
          launchdServiceName: 'gui/501/com.ryan.agent-fabric',
        },
      ),
    ).toMatchObject({
      reason: 'agent-initiated agent-fabric safe restart command',
      message: BLOCKED_AGENT_SAFE_RESTART_MESSAGE,
    });
  });

  test('preserves Web-origin safe restart escape hatch', () => {
    expect(
      detectAgentRunnerAgentFabricServiceControl(
        'agent-fabric restart',
        'web:main',
        {
          backendPid: 78587,
          launchdServiceName: 'gui/501/com.ryan.agent-fabric',
        },
      ),
    ).toBeNull();
  });
});

describe('detectUnsafeAgentFabricServiceControl', () => {
  test('blocks direct kills of the current backend pid', () => {
    expect(
      detectUnsafeAgentFabricServiceControl('kill 69981', {
        backendPid: 69981,
        launchdServiceName: 'gui/501/com.ryan.agent-fabric',
      }),
    ).toMatchObject({
      message: BLOCKED_AGENT_FABRIC_SERVICE_CONTROL_MESSAGE,
    });
  });

  test('blocks direct launchctl control of the managed launch agent', () => {
    expect(
      detectUnsafeAgentFabricServiceControl(
        'launchctl bootout gui/501/com.ryan.agent-fabric',
        {
          backendPid: 69981,
          launchdServiceName: 'gui/501/com.ryan.agent-fabric',
        },
      ),
    ).toMatchObject({
      message: BLOCKED_AGENT_FABRIC_SERVICE_CONTROL_MESSAGE,
    });
  });

  test('allows the explicit safe restart command', () => {
    expect(
      detectUnsafeAgentFabricServiceControl('agent-fabric restart', {
        backendPid: 69981,
        launchdServiceName: 'gui/501/com.ryan.agent-fabric',
      }),
    ).toBeNull();
  });

  test('blocks safe restart commands when agent-runner policy disallows them', () => {
    expect(
      detectUnsafeAgentFabricServiceControl('agent-fabric restart', {
        backendPid: 69981,
        launchdServiceName: 'gui/501/com.ryan.agent-fabric',
        allowSafeRestartCommand: false,
      }),
    ).toMatchObject({
      reason: 'agent-initiated agent-fabric safe restart command',
      message: BLOCKED_AGENT_SAFE_RESTART_MESSAGE,
    });

    expect(
      detectUnsafeAgentFabricServiceControl('bun src/cli.ts restart', {
        backendPid: 69981,
        launchdServiceName: 'gui/501/com.ryan.agent-fabric',
        allowSafeRestartCommand: false,
      }),
    ).toMatchObject({
      reason: 'agent-initiated agent-fabric safe restart command',
      message: BLOCKED_AGENT_SAFE_RESTART_MESSAGE,
    });
  });

  test('does not treat obsolete-agent restart as an Agent Fabric safe restart alias', () => {
    expect(
      detectUnsafeAgentFabricServiceControl('legacy-agent restart', {
        backendPid: 69981,
        launchdServiceName: 'gui/501/com.ryan.agent-fabric',
        allowSafeRestartCommand: false,
      }),
    ).toBeNull();
  });
});
