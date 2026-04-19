import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-recovery-'));
  tempHomes.push(dir);
  return dir;
}

async function loadIndexModule() {
  const home = createTempHome();
  vi.stubEnv('HOME', home);
  return import('../src/index.ts');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('restart recovery cursor handling', () => {
  test('normalizes main-conversation shutdown keys onto sibling web chats', async () => {
    const { buildStreamingShutdownKey } = await loadIndexModule();

    expect(
      buildStreamingShutdownKey('feishu:chat-1', ['feishu:chat-1', 'web:main']),
    ).toBe('web:main');
  });

  test('keeps agent shutdown keys distinct per agent while still normalizing to web chat', async () => {
    const { buildStreamingShutdownKey } = await loadIndexModule();

    expect(
      buildStreamingShutdownKey(
        'feishu:chat-1',
        ['feishu:chat-1', 'web:main'],
        'agent-42',
      ),
    ).toBe('web:main#agent:agent-42');
  });

  test('advances the committed cursor for the real chat when shutdown text is saved under the normalized streaming key', async () => {
    const { applyStreamingShutdownCommittedCursor } = await loadIndexModule();

    const next = applyStreamingShutdownCommittedCursor(
      {
        'feishu:chat-1': {
          timestamp: '2026-04-19T09:00:00.000Z',
          id: 'msg-1',
        },
      },
      'web:main',
      new Map([
        [
          'web:main',
          {
            commitJid: 'feishu:chat-1',
            cursor: {
              timestamp: '2026-04-19T09:05:00.000Z',
              id: 'msg-2',
            },
          },
        ],
      ]),
    );

    expect(next).toEqual({
      'feishu:chat-1': {
        timestamp: '2026-04-19T09:05:00.000Z',
        id: 'msg-2',
      },
    });
  });

  test('does not regress a newer committed cursor when a stale shutdown target is applied', async () => {
    const { applyStreamingShutdownCommittedCursor } = await loadIndexModule();
    const committed = {
      'feishu:chat-1': {
        timestamp: '2026-04-19T09:10:00.000Z',
        id: 'msg-3',
      },
    };

    const next = applyStreamingShutdownCommittedCursor(
      committed,
      'web:main',
      new Map([
        [
          'web:main',
          {
            commitJid: 'feishu:chat-1',
            cursor: {
              timestamp: '2026-04-19T09:05:00.000Z',
              id: 'msg-2',
            },
          },
        ],
      ]),
    );

    expect(next).toBe(committed);
  });
});
