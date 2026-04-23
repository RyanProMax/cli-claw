import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  discoverSkillCommands,
  executeDiscoveredSkillCommand,
  executeDiscoveredSkillCommandResult,
} from '../src/skill-command-dispatch.ts';

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
    path.join(skillDir, args.enabled === false ? 'SKILL.md.disabled' : 'SKILL.md'),
    ['---', `name: ${args.skillId}`, 'description: test skill', '---', '', '# Skill'].join('\n'),
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

  test('discovers workspace skill commands before user-level ones', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cmd-ws-'));
    const userRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cmd-user-'));
    tempDirs.push(workspaceRoot, userRoot);

    writeSkill({
      rootDir: userRoot,
      skillId: 'user-stock-skill',
      commands: {
        hkipo: {
          description: 'user level description',
          entrypoints: ['im', 'web'],
          executor: { command: process.execPath, args: ['reply.js'] },
        },
      },
    });

    writeSkill({
      rootDir: workspaceRoot,
      skillId: 'workspace-stock-skill',
      commands: {
        hkipo: {
          description: 'workspace level description',
          entrypoints: ['im', 'web'],
          executor: { command: process.execPath, args: ['reply.js'] },
        },
      },
    });

    const discovered = await discoverSkillCommands({
      entrypoint: 'im',
      roots: [workspaceRoot, userRoot],
    });

    expect(discovered.commands).toHaveLength(1);
    expect(discovered.commands[0]).toMatchObject({
      name: 'hkipo',
      description: 'workspace level description',
      skillId: 'workspace-stock-skill',
    });
  });

  test('returns a duplicate-command error when multiple enabled skills declare the same command at the same priority', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cmd-dup-'));
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

  test('executes a discovered skill command via stdin/stdout JSON contract', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cmd-run-'));
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

  test('supports assistant_prompt replies for command-driven agent rewrites', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cmd-prompt-'));
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
});
