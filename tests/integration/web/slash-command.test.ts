import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  discoverSkillCommands,
  formatSkillCommandHelpLines,
} from '../../../src/skills/command-dispatch.ts';

describe('web skill command filtering', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('includes only commands exposed to the current entrypoint in appended help output', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cmd-help-'));
    tempDirs.push(workspaceRoot);

    const skillDir = path.join(workspaceRoot, 'stock-analysis-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      ['---', 'name: stock-analysis-skill', 'description: test', '---'].join('\n'),
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
});
