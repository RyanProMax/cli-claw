import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const tempHomes: string[] = [];

function createTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-claw-turn-boundary-'));
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

describe('applyStreamingTurnBoundary', () => {
  test('tracks the first observed turn id without clearing the current buffer', async () => {
    const { applyStreamingTurnBoundary } = await loadIndexModule();

    const result = applyStreamingTurnBoundary(
      {
        turnId: undefined,
        presentationText: {
          answerText: '',
          commentaryText: 'collecting tools',
        },
        thinkingText: '',
        interrupted: false,
      },
      { turnId: 'turn-1' },
    );

    expect(result.turnChanged).toBe(false);
    expect(result.nextState).toMatchObject({
      turnId: 'turn-1',
      presentationText: {
        answerText: '',
        commentaryText: 'collecting tools',
      },
      thinkingText: '',
      interrupted: false,
    });
  });

  test('clears stale commentary, thinking, and interrupted state when a new turn starts', async () => {
    const { applyStreamingTurnBoundary } = await loadIndexModule();

    const result = applyStreamingTurnBoundary(
      {
        turnId: 'turn-old',
        presentationText: {
          answerText: '',
          commentaryText: 'old commentary from the previous question',
          lastCommentaryMessageUuid: 'msg-old',
        },
        thinkingText: 'old thinking',
        interrupted: true,
      },
      { turnId: 'turn-new' },
    );

    expect(result.turnChanged).toBe(true);
    expect(result.nextState).toEqual({
      turnId: 'turn-new',
      presentationText: {
        answerText: '',
        commentaryText: '',
      },
      thinkingText: '',
      interrupted: false,
    });
  });
});
