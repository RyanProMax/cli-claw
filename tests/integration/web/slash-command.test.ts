import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

import { afterEach, describe, expect, test, vi } from 'vitest';

describe('web skill command filtering', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('includes only commands exposed to the current entrypoint in appended help output', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-web-help-'));
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skill-cmd-help-'),
    );
    tempDirs.push(home, workspaceRoot);
    vi.stubEnv('HOME', home);
    vi.resetModules();
    const { discoverSkillCommands, formatSkillCommandHelpLines } =
      await import('../../../src/skills/command-dispatch.ts');

    const skillDir = path.join(workspaceRoot, 'stock-analysis-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      ['---', 'name: stock-analysis-skill', 'description: test', '---'].join(
        '\n',
      ),
    );
    fs.writeFileSync(
      path.join(skillDir, 'commands.json'),
      JSON.stringify(
        {
          version: 1,
          commands: {
            hkipo: {
              description: 'web + im',
              argumentHint: '[YYYY-MM-DD]',
              entrypoints: ['im', 'web'],
              executor: { command: process.execPath, args: ['reply.js'] },
            },
            hiddenim: {
              description: 'im only',
              entrypoints: ['im'],
              executor: { command: process.execPath, args: ['reply.js'] },
            },
          },
        },
        null,
        2,
      ),
    );

    const discovered = await discoverSkillCommands({
      entrypoint: 'web',
      roots: [workspaceRoot],
    });

    expect(formatSkillCommandHelpLines(discovered.commands)).toEqual([
      '- /hkipo [YYYY-MM-DD]：web + im',
    ]);
  });

  test('handles /workflow through the web slash command path without enqueueing the main session', async () => {
    const home = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-web-workflow-'),
    );
    tempDirs.push(home);
    vi.stubEnv('HOME', home);

    const { initDatabase, setRegisteredGroup, getMessagesPage, closeDatabase } =
      await import('../../../src/storage/db.ts');
    const { handleWebUserMessageForTests, setWebDepsForTests } =
      await import('../../../src/web/app.ts');
    const chatJid = 'web:workflow';
    const group = {
      name: 'Workflow Workspace',
      folder: 'workflow',
      added_at: '2026-05-17T10:00:00.000Z',
      is_home: true,
    };
    const handleWorkflowCommand = vi
      .fn()
      .mockResolvedValue('工作流 投研工作流 (research) 完成：\n投研结论完成');
    const enqueueMessageCheck = vi.fn();

    initDatabase();
    setRegisteredGroup(chatJid, group);
    setWebDepsForTests({
      queue: { enqueueMessageCheck },
      getRegisteredGroups: () => ({ [chatJid]: group }),
      getSessions: () => ({}),
      processGroupMessages: vi.fn(),
      formatMessages: vi.fn(),
      getLastAgentTimestamp: () => ({}),
      advanceAcceptedCursor: vi.fn(),
      setLastAgentTimestamp: vi.fn(),
      advanceGlobalCursor: vi.fn(),
      handleWorkflowCommand,
    } as any);

    const result = await handleWebUserMessageForTests(
      chatJid,
      '/workflow research 分析英伟达',
      undefined,
      'user-1',
      'User',
    );

    expect(result.ok).toBe(true);
    expect(handleWorkflowCommand).toHaveBeenCalledWith(
      chatJid,
      'research 分析英伟达',
      'user-1',
      undefined,
      expect.objectContaining({ background: true }),
    );
    expect(enqueueMessageCheck).not.toHaveBeenCalled();
    expect(getMessagesPage(chatJid).map((message) => message.content)).toEqual([
      '工作流 投研工作流 (research) 完成：\n投研结论完成',
      '/workflow research 分析英伟达',
    ]);

    closeDatabase();
  });

  test('routes /hkipo skill workflow replies into the workflow handler without enqueueing the main session', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-web-hkipo-'));
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-web-hkipo-workspace-'),
    );
    tempDirs.push(home, workspaceRoot);
    vi.stubEnv('HOME', home);

    const skillDir = path.join(
      workspaceRoot,
      '.agents',
      'skills',
      'stock-analysis-skill',
    );
    fs.mkdirSync(path.join(skillDir, 'commands'), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      ['---', 'name: stock-analysis-skill', 'description: test', '---'].join(
        '\n',
      ),
    );
    fs.writeFileSync(
      path.join(skillDir, 'commands.json'),
      JSON.stringify(
        {
          version: 1,
          commands: {
            hkipo: {
              description: '自动分析当前可认购港股 IPO 池',
              argumentHint: '[--all]',
              entrypoints: ['im', 'web'],
              executor: {
                command: process.execPath,
                args: ['commands/reply.js'],
              },
            },
          },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(skillDir, 'commands', 'reply.js'),
      [
        "let data = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { data += chunk; });",
        "process.stdin.on('end', () => {",
        '  const payload = JSON.parse(data);',
        '  process.stdout.write(JSON.stringify({ reply: { type: "workflow", workflowId: "hkipo", prompt: "港股 IPO 打新分析", input: { includeClosed: payload.args.includes("--all") }, ack: "已启动港股 IPO 工作流" } }));',
        '});',
      ].join('\n'),
    );

    const { initDatabase, setRegisteredGroup, getMessagesPage, closeDatabase } =
      await import('../../../src/storage/db.ts');
    const { handleWebUserMessageForTests, setWebDepsForTests } =
      await import('../../../src/web/app.ts');
    const chatJid = 'web:hkipo';
    const group = {
      name: 'HK IPO Workspace',
      folder: 'hkipo',
      added_at: '2026-05-17T10:00:00.000Z',
      is_home: true,
      customCwd: workspaceRoot,
    };
    const handleWorkflowCommand = vi
      .fn()
      .mockResolvedValue(
        '工作流 港股 IPO 打新工作流 (hkipo) 完成：\nIPO 报告完成',
      );
    const enqueueMessageCheck = vi.fn();

    initDatabase();
    setRegisteredGroup(chatJid, group);
    setWebDepsForTests({
      queue: { enqueueMessageCheck },
      getRegisteredGroups: () => ({ [chatJid]: group }),
      getSessions: () => ({}),
      processGroupMessages: vi.fn(),
      formatMessages: vi.fn(),
      getLastAgentTimestamp: () => ({}),
      advanceAcceptedCursor: vi.fn(),
      setLastAgentTimestamp: vi.fn(),
      advanceGlobalCursor: vi.fn(),
      handleWorkflowCommand,
    } as any);

    const result = await handleWebUserMessageForTests(
      chatJid,
      '/hkipo --all',
      undefined,
      'user-1',
      'User',
    );

    expect(result.ok).toBe(true);
    expect(handleWorkflowCommand).toHaveBeenCalledWith(
      chatJid,
      'hkipo 港股 IPO 打新分析',
      'user-1',
      {
        command: 'hkipo',
        argsText: '--all',
        input: { includeClosed: true },
      },
      expect.objectContaining({ background: true }),
    );
    expect(enqueueMessageCheck).not.toHaveBeenCalled();
    expect(getMessagesPage(chatJid).map((message) => message.content)).toEqual([
      '工作流 港股 IPO 打新工作流 (hkipo) 完成：\nIPO 报告完成',
      '/hkipo --all',
    ]);

    closeDatabase();
  });

  test('persists workflow start acknowledgement before async final result', async () => {
    const home = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-web-hkipo-ack-'),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cli-claw-web-hkipo-ack-workspace-'),
    );

    tempDirs.push(home, workspaceRoot);
    vi.stubEnv('HOME', home);
    const skillDir = path.join(
      workspaceRoot,
      '.agents',
      'skills',
      'stock-analysis-skill',
    );
    fs.mkdirSync(path.join(skillDir, 'commands'), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      ['---', 'name: stock-analysis-skill', 'description: test', '---'].join(
        '\n',
      ),
    );
    fs.writeFileSync(
      path.join(skillDir, 'commands.json'),
      JSON.stringify(
        {
          version: 1,
          commands: {
            hkipo: {
              description: '自动分析当前可认购港股 IPO 池',
              argumentHint: '[--all]',
              entrypoints: ['im', 'web'],
              executor: {
                command: process.execPath,
                args: ['commands/reply.js'],
              },
            },
          },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(skillDir, 'commands', 'reply.js'),
      [
        "let data = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { data += chunk; });",
        "process.stdin.on('end', () => {",
        '  const payload = JSON.parse(data);',
        '  process.stdout.write(JSON.stringify({ reply: { type: "workflow", workflowId: "hkipo", prompt: "港股 IPO 打新分析", input: { includeClosed: payload.args.includes("--all") } } }));',
        '});',
      ].join('\n'),
    );

    const { initDatabase, setRegisteredGroup, getMessagesPage, closeDatabase } =
      await import('../../../src/storage/db.ts');
    const { handleWebUserMessageForTests, setWebDepsForTests } =
      await import('../../../src/web/app.ts');
    const chatJid = `web:hkipo-ack-${crypto.randomUUID()}`;
    const group = {
      name: 'HK IPO Workspace',
      folder: 'hkipo-ack',
      added_at: '2026-05-17T10:00:00.000Z',
      is_home: true,
      customCwd: workspaceRoot,
    };
    let capturedLifecycle:
      | {
          background?: boolean;
          onBackgroundResult?: (message: string) => Promise<void> | void;
        }
      | undefined;
    const handleWorkflowCommand = vi.fn(
      async (
        _chatJid: string,
        _argsText: string,
        _userId?: string | null,
        _initialInput?: Record<string, unknown>,
        lifecycle?: {
          background?: boolean;
          onBackgroundResult?: (message: string) => Promise<void> | void;
        },
      ) => {
        capturedLifecycle = lifecycle;
        return '🚀 已启动工作流 港股 IPO 打新工作流 (hkipo)\nRun: wfrun_test';
      },
    );
    const enqueueMessageCheck = vi.fn();

    initDatabase();
    setRegisteredGroup(chatJid, group);
    setWebDepsForTests({
      queue: { enqueueMessageCheck },
      getRegisteredGroups: () => ({ [chatJid]: group }),
      getSessions: () => ({}),
      processGroupMessages: vi.fn(),
      formatMessages: vi.fn(),
      getLastAgentTimestamp: () => ({}),
      advanceAcceptedCursor: vi.fn(),
      setLastAgentTimestamp: vi.fn(),
      advanceGlobalCursor: vi.fn(),
      handleWorkflowCommand,
    } as any);

    const result = await handleWebUserMessageForTests(
      chatJid,
      '/hkipo --all',
      undefined,
      'user-1',
      'User',
    );

    expect(result.ok).toBe(true);
    expect(handleWorkflowCommand).toHaveBeenCalledWith(
      chatJid,
      'hkipo 港股 IPO 打新分析',
      'user-1',
      {
        command: 'hkipo',
        argsText: '--all',
        input: { includeClosed: true },
      },
      expect.objectContaining({ background: true }),
    );
    expect(getMessagesPage(chatJid).map((message) => message.content)).toEqual([
      '🚀 已启动工作流 港股 IPO 打新工作流 (hkipo)\nRun: wfrun_test',
      '/hkipo --all',
    ]);

    await capturedLifecycle?.onBackgroundResult?.(
      '✅ 工作流 港股 IPO 打新工作流 (hkipo) 完成：\nIPO 报告完成',
    );
    expect(getMessagesPage(chatJid).map((message) => message.content)).toEqual([
      '✅ 工作流 港股 IPO 打新工作流 (hkipo) 完成：\nIPO 报告完成',
      '🚀 已启动工作流 港股 IPO 打新工作流 (hkipo)\nRun: wfrun_test',
      '/hkipo --all',
    ]);
    expect(enqueueMessageCheck).not.toHaveBeenCalled();

    closeDatabase();
  });
});
