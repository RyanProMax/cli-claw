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

  test('keeps the latest OpenAI assistant message as the answer candidate and demotes earlier messages to Thinking', () => {
    const first = appendStreamPresentationText(
      createEmptyStreamPresentationTextState(),
      {
        eventType: 'text_delta',
        text: '先收集上下文',
        messageUuid: 'msg-1',
        assistantMessagePhase: 'commentary',
        runtimeIdentity: {
          agentType: 'openai',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      },
      {
        agentType: 'openai',
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
        assistantMessagePhase: 'final_answer',
        runtimeIdentity: {
          agentType: 'openai',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      },
      {
        agentType: 'openai',
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
        assistantMessagePhase: 'final_answer',
        runtimeIdentity: {
          agentType: 'openai',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      },
      {
        agentType: 'openai',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        supportsReasoningEffort: true,
      },
    );

    expect(first).toMatchObject({
      answerText: '',
      commentaryText: '先收集上下文',
      lastCommentaryMessageUuid: 'msg-1',
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

  test('classifies OpenAI commentary phase as Thinking even without a message boundary', () => {
    const state = appendStreamPresentationText(
      createEmptyStreamPresentationTextState(),
      {
        eventType: 'text_delta',
        text: '这是一段没有固定前缀的中间状态。',
        messageUuid: 'msg-progress',
        assistantMessagePhase: 'commentary',
        runtimeIdentity: {
          agentType: 'openai',
          model: 'gpt-5.5',
          reasoningEffort: 'xhigh',
          supportsReasoningEffort: true,
        },
      },
      {
        agentType: 'openai',
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        supportsReasoningEffort: true,
      },
    );

    expect(state).toMatchObject({
      answerText: '',
      commentaryText: '这是一段没有固定前缀的中间状态。',
      streamText: '这是一段没有固定前缀的中间状态。',
      lastCommentaryMessageUuid: 'msg-progress',
    });
  });

  test('classifies OpenAI final-answer phase as body even when the text looks like progress', () => {
    const state = appendStreamPresentationText(
      createEmptyStreamPresentationTextState(),
      {
        eventType: 'text_delta',
        text: '我会先给出结论：已完成。',
        messageUuid: 'msg-final',
        assistantMessagePhase: 'final_answer',
        runtimeIdentity: {
          agentType: 'openai',
          model: 'gpt-5.5',
          reasoningEffort: 'xhigh',
          supportsReasoningEffort: true,
        },
      },
      {
        agentType: 'openai',
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        supportsReasoningEffort: true,
      },
    );

    expect(state).toMatchObject({
      answerText: '我会先给出结论：已完成。',
      commentaryText: '',
      streamText: '我会先给出结论：已完成。',
      lastAnswerMessageUuid: 'msg-final',
    });
  });

  test('streams the latest OpenAI assistant message to Feishu body and older messages to Thinking', () => {
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
        assistantMessagePhase: 'final_answer',
        runtimeIdentity: {
          agentType: 'openai',
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
      agentType: 'openai',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      supportsReasoningEffort: true,
    });
    expect(session.appendCommentary).toHaveBeenCalledWith('先收集上下文');
    expect(session.append).toHaveBeenCalledWith('最终结论');
  });

  test('does not stream phase-less OpenAI text into Feishu cards', () => {
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
          agentType: 'openai',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      } as any,
      {
        answerText: '',
        commentaryText: '<messages>旧历史上下文</messages>\n当前增量',
        streamText: '<messages>旧历史上下文</messages>\n当前增量',
      },
    );

    expect(session.append).not.toHaveBeenCalled();
    expect(session.appendCommentary).not.toHaveBeenCalled();
  });

  test('streams a single OpenAI commentary phase into Thinking instead of the main body', () => {
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
        text: '没有固定前缀的中间状态',
        messageUuid: 'msg-preamble',
        assistantMessagePhase: 'commentary',
        runtimeIdentity: {
          agentType: 'openai',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      } as any,
      {
        answerText: '',
        commentaryText: '没有固定前缀的中间状态',
        streamText: '没有固定前缀的中间状态',
      },
    );

    expect(session.append).not.toHaveBeenCalled();
    expect(session.appendCommentary).toHaveBeenCalledWith(
      '没有固定前缀的中间状态',
    );
  });

  test('ignores phase-less OpenAI text until the final-answer phase is known', () => {
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
          agentType: 'openai',
          model: 'gpt-5.5',
          reasoningEffort: 'high',
          supportsReasoningEffort: true,
        },
      } as any,
      {
        answerText: '',
        commentaryText: '',
        streamText: '我',
      },
    );

    expect(session.append).not.toHaveBeenCalled();
    expect(session.appendCommentary).not.toHaveBeenCalled();
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

  test('clears duplicate OpenAI Thinking commentary when terminal visibility has no commentary', () => {
    const session = {
      appendCommentary: vi.fn(),
      appendThinking: vi.fn(),
    } as any;

    syncTerminalPresentationTextToCard(
      session,
      {
        answerText: '',
        commentaryText: 'terminal final duplicated in streaming commentary',
      },
      '',
    );

    expect(session.appendCommentary).toHaveBeenCalledWith('');
    expect(session.appendThinking).not.toHaveBeenCalled();
  });

  test('syncs explicit visible commentary to terminal Feishu Thinking lane', () => {
    const session = {
      appendCommentary: vi.fn(),
      appendThinking: vi.fn(),
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
    expect(session.appendThinking).not.toHaveBeenCalled();
  });
});
