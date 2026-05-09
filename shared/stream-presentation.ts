import {
  appendStreamTextDelta,
  type StreamEvent,
  type StreamRuntimeIdentity,
} from './stream-event.js';

export type StreamPresentationTextChannel = 'answer' | 'commentary';

export interface StreamPresentationTextState {
  answerText: string;
  commentaryText: string;
  streamText?: string;
  lastAnswerMessageUuid?: string;
  lastCommentaryMessageUuid?: string;
  lastStreamMessageUuid?: string;
}

export function createEmptyStreamPresentationTextState(): StreamPresentationTextState {
  return {
    answerText: '',
    commentaryText: '',
  };
}

export function resolveStreamPresentationRuntimeIdentity(
  event: Pick<StreamEvent, 'runtimeIdentity'>,
  fallback?: StreamRuntimeIdentity | null,
): StreamRuntimeIdentity | null {
  return event.runtimeIdentity ?? fallback ?? null;
}

export function classifyStreamPresentationTextChannel(
  event: Pick<StreamEvent, 'eventType' | 'text'>,
  runtimeIdentity?: StreamRuntimeIdentity | null,
): StreamPresentationTextChannel | null {
  if (event.eventType !== 'text_delta') return null;
  if (
    runtimeIdentity?.agentType === 'codex' &&
    looksLikeCodexProgressPreamble(event.text)
  ) {
    return 'commentary';
  }
  return 'answer';
}

function looksLikeCodexProgressPreamble(
  value: string | null | undefined,
): boolean {
  const normalized =
    typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
  if (!normalized) return false;
  if (/^Context compacted\b/i.test(normalized)) return true;

  return /^(?:我(?:会先|先|继续|再|正在|把)|先(?:把|读|看|检查|跑|补|按|收集|确认|整理)|接下来|现在(?:我|先|开始|跑|补|做|按)|当前(?:我|先|正在)|红测|绿测|测试|验证|回归|最终(?:回归|验证|检查)|文档.*(?:同步|补齐).*现在)/u.test(
    normalized,
  );
}

function appendCodexAssistantMessageText(
  current: StreamPresentationTextState,
  event: Pick<
    StreamEvent,
    'eventType' | 'text' | 'messageUuid' | 'runtimeIdentity'
  >,
): StreamPresentationTextState {
  const streamAppended = appendStreamTextDelta(
    current.streamText || '',
    event,
    current.lastStreamMessageUuid,
  );
  let next: StreamPresentationTextState = {
    ...current,
    streamText: streamAppended.text,
    lastStreamMessageUuid: streamAppended.lastMessageUuid,
  };

  const nextMessageUuid = event.messageUuid;
  const previousAnswerMessageUuid = next.lastAnswerMessageUuid;
  const startsNewAssistantMessage = Boolean(
    nextMessageUuid &&
    previousAnswerMessageUuid &&
    nextMessageUuid !== previousAnswerMessageUuid,
  );

  if (startsNewAssistantMessage && next.answerText.trim()) {
    const demoted = appendStreamTextDelta(
      next.commentaryText,
      {
        ...event,
        text: next.answerText,
        messageUuid: previousAnswerMessageUuid,
      },
      next.lastCommentaryMessageUuid,
    );
    next = {
      ...next,
      answerText: '',
      lastAnswerMessageUuid: undefined,
      commentaryText: demoted.text,
      lastCommentaryMessageUuid: demoted.lastMessageUuid,
    };
  }

  const answerAppended = appendStreamTextDelta(
    next.answerText,
    event,
    next.lastAnswerMessageUuid,
  );
  return {
    ...next,
    answerText: answerAppended.text,
    lastAnswerMessageUuid: answerAppended.lastMessageUuid,
  };
}

export function appendStreamPresentationText(
  current: StreamPresentationTextState,
  event: Pick<
    StreamEvent,
    'eventType' | 'text' | 'messageUuid' | 'runtimeIdentity'
  >,
  runtimeIdentity?: StreamRuntimeIdentity | null,
): StreamPresentationTextState {
  const resolvedRuntimeIdentity = resolveStreamPresentationRuntimeIdentity(
    event,
    runtimeIdentity,
  );
  const channel = classifyStreamPresentationTextChannel(
    event,
    resolvedRuntimeIdentity,
  );
  if (!channel || !event.text) {
    return current;
  }

  if (channel === 'answer' && resolvedRuntimeIdentity?.agentType === 'codex') {
    return appendCodexAssistantMessageText(current, event);
  }

  const streamAppended = appendStreamTextDelta(
    current.streamText || '',
    event,
    current.lastStreamMessageUuid,
  );
  const currentWithStreamText = {
    ...current,
    streamText: streamAppended.text,
    lastStreamMessageUuid: streamAppended.lastMessageUuid,
  };

  if (channel === 'commentary') {
    const appended = appendStreamTextDelta(
      currentWithStreamText.commentaryText,
      event,
      currentWithStreamText.lastCommentaryMessageUuid,
    );
    return {
      ...currentWithStreamText,
      commentaryText: appended.text,
      lastCommentaryMessageUuid: appended.lastMessageUuid,
    };
  }

  const appended = appendStreamTextDelta(
    currentWithStreamText.answerText,
    event,
    currentWithStreamText.lastAnswerMessageUuid,
  );
  return {
    ...currentWithStreamText,
    answerText: appended.text,
    lastAnswerMessageUuid: appended.lastMessageUuid,
  };
}
