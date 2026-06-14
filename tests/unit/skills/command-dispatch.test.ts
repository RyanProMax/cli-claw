import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  discoverSkillCommands,
  executeDiscoveredSkillCommand,
  executeDiscoveredSkillCommandResult,
  formatSkillCommandHelpLines,
  resolveSkillCommandRoots,
} from '../../../src/skills/command-dispatch.ts';

function writeSkill(args: {
  rootDir: string;
  skillId: string;
  commands: Record<string, unknown>;
  enabled?: boolean;
  files?: Record<string, string>;
}): string {
  const skillDir = path.join(args.rootDir, args.skillId);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(
      skillDir,
      args.enabled === false ? 'SKILL.md.disabled' : 'SKILL.md',
    ),
    [
      '---',
      `name: ${args.skillId}`,
      'description: test skill',
      '---',
      '',
      '# Skill',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(skillDir, 'commands.json'),
    JSON.stringify({ version: 1, commands: args.commands }, null, 2),
  );
  for (const [relativePath, content] of Object.entries(args.files ?? {})) {
    const filePath = path.join(skillDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return skillDir;
}

describe('skill command dispatch', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('honors earlier command roots over later fallback roots', async () => {
    const primaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-primary-'),
    );
    const fallbackRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-fallback-'),
    );
    tempDirs.push(primaryRoot, fallbackRoot);

    writeSkill({
      rootDir: fallbackRoot,
      skillId: 'fallback-stock-skill',
      commands: {
        hkipo: {
          description: 'fallback description',
          entrypoints: ['im', 'web'],
          executor: { command: process.execPath, args: ['reply.js'] },
        },
      },
    });

    writeSkill({
      rootDir: primaryRoot,
      skillId: 'primary-stock-skill',
      commands: {
        hkipo: {
          description: 'primary description',
          entrypoints: ['im', 'web'],
          executor: { command: process.execPath, args: ['reply.js'] },
        },
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [primaryRoot, fallbackRoot],
    });

    expect(discovered.commands).toHaveLength(1);
    expect(discovered.commands[0]).toMatchObject({
      name: 'hkipo',
      description: 'primary description',
      skillId: 'primary-stock-skill',
    });
  });

  test('uses repository-inline .agents skills for workspace commands', async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-agents-'),
    );
    tempDirs.push(workspaceRoot);

    const roots = resolveSkillCommandRoots({
      workspaceGroup: {
        name: 'Workspace',
        folder: 'workspace',
        added_at: '2026-05-16T00:00:00.000Z',
        customCwd: workspaceRoot,
      },
    });

    expect(roots[0]).toBe(path.join(workspaceRoot, '.agents', 'skills'));
    expect(roots).toHaveLength(1);

    writeSkill({
      rootDir: roots[0],
      skillId: 'inline-stock-skill',
      commands: {
        hkipo: {
          description: 'repo inline description',
          entrypoints: ['im'],
          executor: { command: process.execPath, args: ['reply.js'] },
        },
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots,
    });

    expect(discovered.commands).toHaveLength(1);
    expect(discovered.commands[0]).toMatchObject({
      name: 'hkipo',
      description: 'repo inline description',
      skillId: 'inline-stock-skill',
    });
  });

  test('returns a duplicate-command error when multiple enabled skills declare the same command at the same priority', async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-dup-'),
    );
    tempDirs.push(workspaceRoot);

    writeSkill({
      rootDir: workspaceRoot,
      skillId: 'stock-skill-a',
      commands: {
        hkipo: {
          description: 'a',
          entrypoints: ['im'],
          executor: { command: process.execPath, args: ['reply.js'] },
        },
      },
    });
    writeSkill({
      rootDir: workspaceRoot,
      skillId: 'stock-skill-b',
      commands: {
        hkipo: {
          description: 'b',
          entrypoints: ['im'],
          executor: { command: process.execPath, args: ['reply.js'] },
        },
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [workspaceRoot],
    });

    expect(discovered.errors).toEqual([
      '命令 /hkipo 同时由多个启用技能声明：stock-skill-a, stock-skill-b',
    ]);
  });

  test('renders declared command argument hints in help output', async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-help-'),
    );
    tempDirs.push(workspaceRoot);

    writeSkill({
      rootDir: workspaceRoot,
      skillId: 'stock-analysis-skill',
      commands: {
        research: {
          description: '生成单只股票深度研报',
          argumentHint: '<股票名称/代码>',
          entrypoints: ['im', 'web'],
          executor: { command: process.execPath, args: ['reply.js'] },
        },
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [workspaceRoot],
    });

    expect(formatSkillCommandHelpLines(discovered.commands)).toEqual([
      '- /research <股票名称/代码>：生成单只股票深度研报',
    ]);
  });

  test('executes a discovered skill command via stdin/stdout JSON contract', async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-run-'),
    );
    tempDirs.push(workspaceRoot);

    writeSkill({
      rootDir: workspaceRoot,
      skillId: 'stock-analysis-skill',
      commands: {
        hkipo: {
          description: '分析当前港股新股',
          entrypoints: ['im', 'web'],
          executor: {
            command: process.execPath,
            args: ['commands/reply.js'],
          },
        },
      },
      files: {
        'commands/reply.js': [
          "let data = '';",
          "process.stdin.setEncoding('utf8');",
          "process.stdin.on('data', (chunk) => { data += chunk; });",
          "process.stdin.on('end', () => {",
          '  const payload = JSON.parse(data);',
          "  process.stdout.write(JSON.stringify({ reply: { type: 'final_markdown', content: `handled ${payload.command} for ${payload.workspace.folder}` } }));",
          '});',
        ].join('\n'),
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [workspaceRoot],
    });

    const reply = await executeDiscoveredSkillCommand({
      commandName: 'hkipo',
      discovered,
      entrypoint: 'im',
      chatJid: 'feishu:chat-1',
      argsText: '',
      args: [],
      workspace: {
        jid: 'web:ipo',
        folder: 'ipo',
        name: 'IPO Workspace',
      },
    });

    expect(reply).toBe('handled hkipo for ipo');
  });

  test('passes only AGENT_FABRIC skill env vars to command executors', async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-env-contract-'),
    );
    tempDirs.push(workspaceRoot);

    writeSkill({
      rootDir: workspaceRoot,
      skillId: 'stock-analysis-skill',
      commands: {
        hkipo: {
          description: '分析当前港股新股',
          entrypoints: ['im', 'web'],
          executor: {
            command: process.execPath,
            args: ['commands/reply.js'],
          },
        },
      },
      files: {
        'commands/reply.js': [
          'process.stdin.resume();',
          "process.stdin.on('end', () => {",
          '  const legacyKeys = Object.keys(process.env).filter((key) => key.startsWith("OBSOLETE_AGENT_")).sort();',
          '  const content = JSON.stringify({',
          '    command: process.env.AGENT_FABRIC_COMMAND,',
          '    skillId: process.env.AGENT_FABRIC_SKILL_ID,',
          '    skillDir: process.env.AGENT_FABRIC_SKILL_DIR,',
          '    legacyKeys,',
          '  });',
          "  process.stdout.write(JSON.stringify({ reply: { type: 'final_markdown', content } }));",
          '});',
        ].join('\n'),
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [workspaceRoot],
    });

    const reply = await executeDiscoveredSkillCommand({
      commandName: 'hkipo',
      discovered,
      entrypoint: 'im',
      chatJid: 'feishu:chat-1',
      argsText: '',
      args: [],
      workspace: {
        jid: 'web:ipo',
        folder: 'ipo',
        name: 'IPO Workspace',
      },
    });

    expect(JSON.parse(reply)).toMatchObject({
      command: 'hkipo',
      skillId: 'stock-analysis-skill',
      legacyKeys: [],
    });
  });

  test('prefers a skill-local venv python for bare python executors', async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-venv-'),
    );
    tempDirs.push(workspaceRoot);

    const skillDir = writeSkill({
      rootDir: workspaceRoot,
      skillId: 'stock-analysis-skill',
      commands: {
        research: {
          description: '生成研报',
          entrypoints: ['im', 'web'],
          executor: {
            command: 'python3',
            args: ['commands/reply.py'],
          },
        },
      },
    });
    const venvPython = path.join(
      skillDir,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    fs.mkdirSync(path.dirname(venvPython), { recursive: true });
    fs.writeFileSync(
      venvPython,
      [
        '#!/usr/bin/env node',
        "let data = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { data += chunk; });",
        "process.stdin.on('end', () => {",
        '  const payload = JSON.parse(data);',
        "  process.stdout.write(JSON.stringify({ reply: { type: 'final_markdown', content: `venv python handled ${payload.command}` } }));",
        '});',
      ].join('\n'),
    );
    fs.chmodSync(venvPython, 0o755);

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [workspaceRoot],
    });

    const reply = await executeDiscoveredSkillCommand({
      commandName: 'research',
      discovered,
      entrypoint: 'im',
      chatJid: 'feishu:chat-1',
      argsText: 'MINIMAX',
      args: ['MINIMAX'],
      workspace: {
        jid: 'web:research',
        folder: 'research',
        name: 'Research',
      },
    });

    expect(reply).toBe('venv python handled research');
  });

  test('loads skill-local env file for command executors', async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-env-'),
    );
    tempDirs.push(workspaceRoot);

    writeSkill({
      rootDir: workspaceRoot,
      skillId: 'stock-analysis-skill',
      commands: {
        hkipo: {
          description: '分析当前港股新股',
          entrypoints: ['im', 'web'],
          executor: {
            command: process.execPath,
            args: ['commands/reply.js'],
          },
        },
      },
      files: {
        '.env': 'STOCK_ANALYSIS_API_ROOT="~/projects/stock-analysis-api"\n',
        'commands/reply.js': [
          'process.stdin.resume();',
          "process.stdin.on('end', () => {",
          "  process.stdout.write(JSON.stringify({ reply: { type: 'final_markdown', content: process.env.STOCK_ANALYSIS_API_ROOT || 'missing' } }));",
          '});',
        ].join('\n'),
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [workspaceRoot],
    });

    const reply = await executeDiscoveredSkillCommand({
      commandName: 'hkipo',
      discovered,
      entrypoint: 'im',
      chatJid: 'feishu:chat-1',
      argsText: '',
      args: [],
      workspace: {
        jid: 'web:ipo',
        folder: 'ipo',
        name: 'IPO Workspace',
      },
    });

    expect(reply).toBe('~/projects/stock-analysis-api');
  });

  test('supports assistant_prompt replies for command-driven agent rewrites', async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-prompt-'),
    );
    tempDirs.push(workspaceRoot);

    writeSkill({
      rootDir: workspaceRoot,
      skillId: 'stock-analysis-skill',
      commands: {
        hkipo: {
          description: '分析当前港股新股',
          entrypoints: ['im', 'web'],
          executor: {
            command: process.execPath,
            args: ['commands/reply.js'],
          },
        },
      },
      files: {
        'commands/reply.js': [
          "let data = '';",
          "process.stdin.setEncoding('utf8');",
          "process.stdin.on('data', (chunk) => { data += chunk; });",
          "process.stdin.on('end', () => {",
          '  const payload = JSON.parse(data);',
          "  process.stdout.write(JSON.stringify({ reply: { type: 'assistant_prompt', content: `prompt for ${payload.command}`, ack: '已开始分析' } }));",
          '});',
        ].join('\n'),
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [workspaceRoot],
    });

    await expect(
      executeDiscoveredSkillCommandResult({
        commandName: 'hkipo',
        discovered,
        entrypoint: 'im',
        chatJid: 'feishu:chat-1',
        argsText: '',
        args: [],
        workspace: {
          jid: 'web:ipo',
          folder: 'ipo',
          name: 'IPO Workspace',
        },
      }),
    ).resolves.toEqual({
      kind: 'assistant_prompt',
      prompt: 'prompt for hkipo',
      ack: '已开始分析',
    });
  });

  test('supports workflow replies for command-driven workflow triggers', async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-workflow-'),
    );
    tempDirs.push(workspaceRoot);

    writeSkill({
      rootDir: workspaceRoot,
      skillId: 'stock-analysis-skill',
      commands: {
        hkipo: {
          description: '分析当前港股新股',
          argumentHint: '[--all]',
          entrypoints: ['im', 'web'],
          executor: {
            command: process.execPath,
            args: ['commands/reply.js'],
          },
        },
      },
      files: {
        'commands/reply.js': [
          "let data = '';",
          "process.stdin.setEncoding('utf8');",
          "process.stdin.on('data', (chunk) => { data += chunk; });",
          "process.stdin.on('end', () => {",
          '  const payload = JSON.parse(data);',
          '  process.stdout.write(JSON.stringify({ reply: { type: "workflow", workflowId: "hkipo", prompt: "港股 IPO 打新分析", input: { includeClosed: payload.args.includes("--all") }, ack: "已启动港股 IPO 工作流" } }));',
          '});',
        ].join('\n'),
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [workspaceRoot],
    });

    await expect(
      executeDiscoveredSkillCommandResult({
        commandName: 'hkipo',
        discovered,
        entrypoint: 'im',
        chatJid: 'feishu:chat-1',
        argsText: '--all',
        args: ['--all'],
        workspace: {
          jid: 'web:ipo',
          folder: 'ipo',
          name: 'IPO Workspace',
        },
      }),
    ).resolves.toEqual({
      kind: 'workflow',
      workflowId: 'hkipo',
      prompt: '港股 IPO 打新分析',
      input: { includeClosed: true },
      ack: '已启动港股 IPO 工作流',
    });
  });
});
