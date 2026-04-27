import { describe, expect, test, vi } from 'vitest';

import {
  feedStreamEventToCard,
  syncTerminalPresentationTextToCard,
} from '../src/index.ts';
import {
  appendStreamPresentationText,
  createEmptyStreamPresentationTextState,
} from '../shared/stream-presentation.ts';

describe('stream presentation', () => {
  test('keeps the latest Codex assistant message in answerText and moves older messages into commentaryText', () => {
    const first = appendStreamPresentationText(
      createEmptyStreamPresentationTextState(),
      {
        eventType: 'text_delta',
        text: '先收集上下文',
        messageUuid: 'msg-1',
        runtimeIdentity: {
          agentType: 'codex',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      },
      {
        agentType: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        supportsReasoningEffort: true,
      },
    );

    const second = appendStreamPresentationText(
      first,
      {
        eventType: 'text_delta',
        text: '最终结论',
        messageUuid: 'msg-2',
        runtimeIdentity: {
          agentType: 'codex',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      },
      {
        agentType: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        supportsReasoningEffort: true,
      },
    );

    const third = appendStreamPresentationText(
      second,
      {
        eventType: 'text_delta',
        text: '\n\n- 已完成',
        messageUuid: 'msg-2',
        runtimeIdentity: {
          agentType: 'codex',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      },
      {
        agentType: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        supportsReasoningEffort: true,
      },
    );

    expect(first).toMatchObject({
      answerText: '先收集上下文',
      commentaryText: '',
      lastAnswerMessageUuid: 'msg-1',
    });
    expect(second).toMatchObject({
      answerText: '最终结论',
      commentaryText: '先收集上下文',
      lastAnswerMessageUuid: 'msg-2',
      lastCommentaryMessageUuid: 'msg-1',
    });
    expect(third).toMatchObject({
      answerText: '最终结论\n\n- 已完成',
      commentaryText: '先收集上下文',
      streamText: '先收集上下文\n\n最终结论\n\n- 已完成',
      lastAnswerMessageUuid: 'msg-2',
      lastCommentaryMessageUuid: 'msg-1',
    });
  });

  test('feeds only latest Codex answer text during Feishu streaming', () => {
    const session = {
      setRuntimeIdentity: vi.fn(),
      appendCommentary: vi.fn(),
      append: vi.fn(),
      appendThinking: vi.fn(),
      setThinking: vi.fn(),
      startTool: vi.fn(),
      updateToolSummary: vi.fn(),
      endTool: vi.fn(),
      setSystemStatus: vi.fn(),
      setHook: vi.fn(),
      setTodos: vi.fn(),
      pushRecentEvent: vi.fn(),
    } as any;

    feedStreamEventToCard(
      session,
      {
        eventType: 'text_delta',
        text: '最终结论',
        messageUuid: 'msg-2',
        runtimeIdentity: {
          agentType: 'codex',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      } as any,
      {
        answerText: '最终结论',
        commentaryText: '先收集上下文',
        streamText: '先收集上下文\n\n最终结论',
      },
    );

    expect(session.setRuntimeIdentity).toHaveBeenCalledWith({
      agentType: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    });
    expect(session.appendCommentary).not.toHaveBeenCalled();
    expect(session.append).toHaveBeenCalledWith('最终结论');
  });

  test('syncs Codex commentary to Feishu cards only at terminal state', () => {
    const session = {
      appendCommentary: vi.fn(),
    } as any;

    syncTerminalPresentationTextToCard(session, {
      answerText: '最终结论',
      commentaryText: '先收集上下文',
    });

    expect(session.appendCommentary).toHaveBeenCalledWith('先收集上下文');
  });
});
