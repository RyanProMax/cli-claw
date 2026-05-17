import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  discoverWorkflowConfigs,
  loadWorkflowDefinition,
} from '../../../../src/agent/workflow/config.ts';

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeWorkflow(
  workspaceRoot: string,
  id: string,
  definition: Record<string, unknown>,
): void {
  writeFile(
    path.join(workspaceRoot, '.agents', 'workflows', `${id}.json`),
    JSON.stringify(definition, null, 2),
  );
}

function writeRole(
  workspaceRoot: string,
  id: string,
  frontmatter: Record<string, string>,
  body: string,
): void {
  const lines = [
    '---',
    ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`),
    '---',
    '',
    body,
  ];
  writeFile(
    path.join(workspaceRoot, '.agents', 'agent-roles', `${id}.md`),
    lines.join('\n'),
  );
}

describe('workflow config discovery', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('loads workflow definitions and runtime role cards from .agents', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-config-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: '投研分析师',
        description: '整理公开信息并形成观点',
        allowedTools: 'send_message,list_tasks',
        skillIds: 'stock-kol-intel,stock-analysis-skill',
        permissionMode: 'standard',
      },
      '只输出可溯源的投研结论。',
    );
    writeWorkflow(workspaceRoot, 'investment-research', {
      id: 'investment-research',
      name: '投研工作流',
      description: '从用户问题触发投研 crew',
      roles: ['analyst'],
      start: 'research',
      nodes: [
        {
          id: 'research',
          type: 'role_task',
          roleId: 'analyst',
          prompt: '围绕用户问题做投研分析',
        },
      ],
      edges: [{ from: 'research', to: '__end__' }],
      maxRetries: 2,
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message', 'list_tasks', 'schedule_task'],
    });

    expect(discovered.errors).toEqual([]);
    expect(discovered.workflows).toHaveLength(1);
    expect(discovered.workflows[0]).toMatchObject({
      id: 'investment-research',
      name: '投研工作流',
      roles: ['analyst'],
      start: 'research',
      maxRetries: 2,
    });
    expect(discovered.roles.get('analyst')).toMatchObject({
      id: 'analyst',
      name: '投研分析师',
      allowedTools: ['send_message', 'list_tasks'],
      skillIds: ['stock-kol-intel', 'stock-analysis-skill'],
      permissionMode: 'standard',
      instructions: '只输出可溯源的投研结论。',
    });
  });

  test('rejects workflows that reference missing roles', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-missing-role-'),
    );
    tempDirs.push(workspaceRoot);

    writeWorkflow(workspaceRoot, 'broken', {
      id: 'broken',
      name: 'Broken',
      roles: ['missing'],
      start: 'research',
      nodes: [
        {
          id: 'research',
          type: 'role_task',
          roleId: 'missing',
          prompt: 'run',
        },
      ],
      edges: [{ from: 'research', to: '__end__' }],
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.workflows).toEqual([]);
    expect(discovered.errors).toEqual([
      'workflow broken references missing role missing',
    ]);
  });

  test('rejects role cards that request unknown tools', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-unknown-tool-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: 'Analyst',
        allowedTools: 'send_message,delete_everything',
      },
      'Stay focused.',
    );

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.roles.size).toBe(0);
    expect(discovered.errors).toEqual([
      'role analyst references unknown tool delete_everything',
    ]);
  });

  test('rejects workflows with invalid node definitions', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-invalid-node-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: 'Analyst',
        allowedTools: 'send_message',
      },
      'Stay focused.',
    );
    writeWorkflow(workspaceRoot, 'malformed', {
      id: 'malformed',
      roles: ['analyst'],
      start: 'research',
      nodes: [
        {
          id: 'research',
          type: 'role_task',
          roleId: 'analyst',
          prompt: 'run',
        },
        {
          id: 'native',
          type: 'native_graph',
        },
      ],
      edges: [{ from: 'research', to: '__end__' }],
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.workflows).toEqual([]);
    expect(discovered.errors).toContain(
      'workflow malformed contains invalid node at index 1',
    );
  });

  test('rejects workflows with malformed edges', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-invalid-edge-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: 'Analyst',
        allowedTools: 'send_message',
      },
      'Stay focused.',
    );
    writeWorkflow(workspaceRoot, 'malformed', {
      id: 'malformed',
      roles: ['analyst'],
      start: 'research',
      nodes: [
        {
          id: 'research',
          type: 'role_task',
          roleId: 'analyst',
          prompt: 'run',
        },
      ],
      edges: [{ from: 'research', to: '' }],
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.workflows).toEqual([]);
    expect(discovered.errors).toContain(
      'workflow malformed contains invalid edge at index 0',
    );
  });

  test('rejects workflow graphs with cycles or unreachable nodes', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-invalid-graph-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'analyst',
      {
        id: 'analyst',
        name: 'Analyst',
        allowedTools: 'send_message',
      },
      'Stay focused.',
    );
    writeWorkflow(workspaceRoot, 'cycle', {
      id: 'cycle',
      roles: ['analyst'],
      start: 'first',
      nodes: [
        { id: 'first', type: 'role_task', roleId: 'analyst' },
        { id: 'second', type: 'role_task', roleId: 'analyst' },
      ],
      edges: [
        { from: 'first', to: 'second' },
        { from: 'second', to: 'first' },
      ],
    });
    writeWorkflow(workspaceRoot, 'unreachable', {
      id: 'unreachable',
      roles: ['analyst'],
      start: 'first',
      nodes: [
        { id: 'first', type: 'role_task', roleId: 'analyst' },
        { id: 'orphan', type: 'role_task', roleId: 'analyst' },
      ],
      edges: [{ from: 'first', to: '__end__' }],
    });

    const discovered = discoverWorkflowConfigs({
      workspaceRoot,
      knownTools: ['send_message'],
    });

    expect(discovered.workflows).toEqual([]);
    expect(discovered.errors).toEqual([
      'workflow cycle contains a cycle',
      'workflow unreachable node orphan is unreachable',
    ]);
  });

  test('loads one workflow by id and reports a clear not-found error', () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-workflow-load-one-'),
    );
    tempDirs.push(workspaceRoot);

    writeRole(
      workspaceRoot,
      'qa',
      {
        id: 'qa',
        name: 'QA',
        allowedTools: 'send_message',
      },
      '验证结果是否满足要求。',
    );
    writeWorkflow(workspaceRoot, 'qa-review', {
      id: 'qa-review',
      name: 'QA Review',
      roles: ['qa'],
      start: 'review',
      nodes: [
        {
          id: 'review',
          type: 'role_task',
          roleId: 'qa',
          prompt: 'review',
        },
      ],
      edges: [{ from: 'review', to: '__end__' }],
    });

    expect(
      loadWorkflowDefinition({
        workspaceRoot,
        workflowId: 'qa-review',
        knownTools: ['send_message'],
      })?.workflow,
    ).toMatchObject({ id: 'qa-review', start: 'review' });
    expect(
      loadWorkflowDefinition({
        workspaceRoot,
        workflowId: 'missing',
        knownTools: ['send_message'],
      })?.errors,
    ).toEqual(['workflow missing not found']);
  });
});
