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
  test('clears presentation state when a new same-source user input arrives', async () => {
    const { resetStreamingTurnBoundaryForNewInput } = await loadIndexModule();

    const result = resetStreamingTurnBoundaryForNewInput({
      turnId: 'turn-old',
      presentationText: {
        answerText: '旧正文',
        commentaryText: '旧过程',
        lastAnswerMessageUuid: 'msg-old',
      },
      thinkingText: '旧 thinking',
      interrupted: true,
    });

    expect(result).toEqual({
      turnId: undefined,
      presentationText: {
        answerText: '',
        commentaryText: '',
      },
      thinkingText: '',
      interrupted: false,
    });
  });

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

  test('clears stale state when init cursor changes even if turn id is reused', async () => {
    const { applyStreamingTurnBoundary } = await loadIndexModule();

    const result = applyStreamingTurnBoundary(
      {
        turnId: 'turn-reused',
        messageCursorId: 'old-cursor',
        presentationText: {
          answerText: '旧正文',
          commentaryText: '旧过程',
        },
        thinkingText: '旧 thinking',
        interrupted: true,
      },
      {
        turnId: 'turn-reused',
        messageCursor: {
          timestamp: '2026-04-29T04:00:00.000Z',
          id: 'new-cursor',
        },
      },
    );

    expect(result.turnChanged).toBe(true);
    expect(result.nextState).toEqual({
      turnId: 'turn-reused',
      messageCursorId: 'new-cursor',
      presentationText: {
        answerText: '',
        commentaryText: '',
      },
      thinkingText: '',
      interrupted: false,
    });
  });
});
