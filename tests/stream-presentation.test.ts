import { describe, expect, test, vi } from 'vitest';

import {
  feedStreamEventToCard,
  shouldRebuildStreamingSessionBeforeEvent,
  syncTerminalPresentationTextToCard,
} from '../src/index.ts';
import {
  appendStreamPresentationText,
  createEmptyStreamPresentationTextState,
} from '../shared/stream-presentation.ts';

describe('stream presentation', () => {
  test('keeps a fresh idle Feishu streaming card session instead of rebuilding it before the first visible event', () => {
    const idleSession = {
      currentState: 'idle',
      isActive: () => false,
    };
    const streamingSession = {
      currentState: 'streaming',
      isActive: () => true,
    };
    const completedSession = {
      currentState: 'completed',
      isActive: () => false,
    };

    expect(shouldRebuildStreamingSessionBeforeEvent(undefined)).toBe(false);
    expect(shouldRebuildStreamingSessionBeforeEvent(idleSession)).toBe(false);
    expect(shouldRebuildStreamingSessionBeforeEvent(streamingSession)).toBe(
      false,
    );
    expect(shouldRebuildStreamingSessionBeforeEvent(completedSession)).toBe(
      true,
    );
  });

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

  test('waits for terminal raw final before writing any Codex text_delta into Feishu cards', () => {
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
    expect(session.append).not.toHaveBeenCalled();
  });

  test('never streams stale Codex presentation answerText into Feishu cards', () => {
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
        text: '当前增量',
        messageUuid: 'msg-current',
        runtimeIdentity: {
          agentType: 'codex',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      } as any,
      {
        answerText: '<messages>旧历史上下文</messages>\n当前增量',
        commentaryText: '',
        streamText: '<messages>旧历史上下文</messages>\n当前增量',
      },
    );

    expect(session.append).not.toHaveBeenCalled();
  });

  test('does not stream a Codex process preamble as the live answer before an answer boundary appears', () => {
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
        text: '我会先检查卡片实现',
        messageUuid: 'msg-preamble',
        runtimeIdentity: {
          agentType: 'codex',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      } as any,
      {
        answerText: '我会先检查卡片实现',
        commentaryText: '',
        streamText: '我会先检查卡片实现',
      },
    );

    expect(session.append).not.toHaveBeenCalled();
  });

  test('does not stream an ambiguous one-character Codex preamble prefix into Feishu cards', () => {
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
        text: '我',
        messageUuid: 'msg-preamble',
        runtimeIdentity: {
          agentType: 'codex',
          model: 'gpt-5.5',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      } as any,
      {
        answerText: '我',
        commentaryText: '',
        streamText: '我',
      },
    );

    expect(session.append).not.toHaveBeenCalled();
  });

  test('does not sync presentation commentary to terminal Feishu cards by default', () => {
    const session = {
      appendCommentary: vi.fn(),
    } as any;

    syncTerminalPresentationTextToCard(session, {
      answerText: '最终结论',
      commentaryText: '先收集上下文',
    });

    expect(session.appendCommentary).not.toHaveBeenCalled();
  });

  test('syncs explicit visible commentary to terminal Feishu cards', () => {
    const session = {
      appendCommentary: vi.fn(),
    } as any;

    syncTerminalPresentationTextToCard(
      session,
      {
        answerText: '最终结论',
        commentaryText: '旧过程',
      },
      '当前终态 commentary',
    );

    expect(session.appendCommentary).toHaveBeenCalledWith(
      '当前终态 commentary',
    );
  });
});
