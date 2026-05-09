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
  event: Pick<StreamEvent, 'eventType' | 'assistantMessagePhase'>,
  runtimeIdentity?: StreamRuntimeIdentity | null,
): StreamPresentationTextChannel | null {
  if (event.eventType !== 'text_delta') return null;
  if (runtimeIdentity?.agentType === 'codex') {
    if (event.assistantMessagePhase === 'commentary') return 'commentary';
    if (event.assistantMessagePhase === 'final_answer') return 'answer';
  }
  return 'answer';
}

function appendCodexAssistantMessageText(
  current: StreamPresentationTextState,
  event: Pick<
    StreamEvent,
    | 'eventType'
    | 'text'
    | 'messageUuid'
    | 'runtimeIdentity'
    | 'assistantMessagePhase'
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
    | 'eventType'
    | 'text'
    | 'messageUuid'
    | 'runtimeIdentity'
    | 'assistantMessagePhase'
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
