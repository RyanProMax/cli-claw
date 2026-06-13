import { describe, expect, test } from 'vitest';

import {
  buildOpenAiInstructions,
  buildModelSettings,
  buildOpenAiRuntimeIdentity,
  resolveCodexServiceTier,
} from '../../../container/agent-runner/src/openai-agent-runtime.ts';
import { createOpenAiAgentTools } from '../../../container/agent-runner/src/openai-agent-tools.ts';
import { formatOpenAiRuntimeError } from '../../../container/agent-runner/src/openai-agent-stream.ts';

describe('OpenAI agent model settings', () => {
  test('maps UI fast speed to Codex priority service tier', () => {
    expect(resolveCodexServiceTier('fast')).toBe('priority');
    expect(resolveCodexServiceTier(' FAST ')).toBe('priority');
    expect(resolveCodexServiceTier('priority')).toBe('priority');
  });

  test('omits Codex service tier for standard or unknown speeds', () => {
    expect(resolveCodexServiceTier('standard')).toBeNull();
    expect(resolveCodexServiceTier('turbo')).toBeNull();
    expect(resolveCodexServiceTier(null)).toBeNull();
  });

  test('builds model settings with priority service tier for fast requests', () => {
    const settings = buildModelSettings({
      prompt: '',
      groupFolder: 'main',
      chatJid: 'test',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
    });

    expect(settings.reasoning).toEqual({
      effort: 'xhigh',
      summary: 'auto',
    });
    expect(settings.store).toBe(false);
    expect(settings.providerData).toEqual({ service_tier: 'priority' });
  });

  test('builds model settings without service tier for standard requests', () => {
    const settings = buildModelSettings({
      prompt: '',
      groupFolder: 'main',
      chatJid: 'test',
      reasoningEffort: 'high',
      speedTier: 'standard',
    });

    expect(settings.reasoning).toEqual({
      effort: 'high',
      summary: 'auto',
    });
    expect(settings.store).toBe(false);
    expect(settings.providerData).toBeUndefined();
  });

  test('keeps fast in runtime identity for footer and UI state', () => {
    expect(
      buildOpenAiRuntimeIdentity({
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        speedTier: 'fast',
      }),
    ).toMatchObject({
      agentType: 'openai',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
    });
  });

  test('formats bare Codex backend 400 errors without raw SDK JSON', () => {
    const formatted = formatOpenAiRuntimeError(
      '{ "name": "Error", "message": "400 status code (no body)", "status": 400, "headers": {}, "requestID": null }',
    );

    expect(formatted).toBe(
      'OpenAI runtime request was rejected by Codex backend (400). Check the latest process log for the request id, update and restart agent-fabric, then retry.',
    );
    expect(formatted).not.toContain('"headers"');
    expect(formatted).not.toContain('"requestID"');
  });

  test('formats non-persisted Responses item errors without raw SDK JSON', () => {
    const formatted = formatOpenAiRuntimeError(
      `{ "name": "Error", "message": "404 Item with id 'rs_0049910cf1452a4f016a1ffc6bc25481938b1fce5d233c81d3' not found. Items are not persisted when store is set to false. Try again with store set to true, or remove this item from your input.", "status": 404, "type": "invalid_request_error", "headers": {}, "requestID": null, "error": { "param": "input" } }`,
    );

    expect(formatted).toBe(
      'OpenAI runtime request referenced non-persisted response state while store is false. Retry this turn; if it repeats, clear the OpenAI runtime session and retry.',
    );
    expect(formatted).not.toContain('rs_0049910');
    expect(formatted).not.toContain('"headers"');
    expect(formatted).not.toContain('"requestID"');
  });

  test('adds workflow and role metadata to OpenAI runtime instructions', () => {
    const instructions = buildOpenAiInstructions({
      prompt: '',
      groupFolder: 'workspace-a',
      chatJid: 'web:workspace-a',
      workflow: {
        id: 'investment-research',
        name: '投研工作流',
        contextId: 'wfctx_1',
        runId: 'wfrun_1',
        threadId: 'wfctx_1',
        nodeId: 'research',
        nodeType: 'role_task',
      },
      role: {
        id: 'analyst',
        name: '投研分析师',
        description: '整理公开信息并形成观点',
        instructions: '只输出可溯源的投研结论。',
        skillIds: ['stock-analysis-skill'],
        permissionMode: 'readonly',
        allowedTools: ['send_message'],
      },
    });

    expect(instructions).toContain(
      'Workflow: 投研工作流 (investment-research)',
    );
    expect(instructions).toContain('Workflow Context: wfctx_1');
    expect(instructions).toContain('Role: 投研分析师 (analyst)');
    expect(instructions).toContain('Permission Mode: readonly');
    expect(instructions).toContain('只输出可溯源的投研结论。');
  });

  test('hard-filters OpenAI tools by workflow role allowlist', () => {
    const tools = createOpenAiAgentTools({
      chatJid: 'web:workspace-a',
      groupFolder: 'workspace-a',
      isHome: true,
      isMainWorkspace: true,
      workspaceIpc: '/tmp/ipc',
      workspaceGroup: '/tmp/workspace',
      allowedTools: ['send_message', 'list_tasks'],
    });
    const names = tools.map((tool) => String((tool as { name?: string }).name));

    expect(names).toEqual(['send_message', 'list_tasks']);
    expect(names).not.toContain('schedule_task');
    expect(
      createOpenAiAgentTools({
        chatJid: 'web:workspace-a',
        groupFolder: 'workspace-a',
        isHome: true,
        isMainWorkspace: true,
        workspaceIpc: '/tmp/ipc',
        workspaceGroup: '/tmp/workspace',
        allowedTools: [],
      }),
    ).toEqual([]);
  });
});
