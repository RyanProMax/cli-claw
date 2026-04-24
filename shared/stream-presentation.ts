import {
  appendStreamTextDelta,
  type StreamEvent,
  type StreamRuntimeIdentity,
} from './stream-event.js';

export type StreamPresentationTextChannel = 'answer' | 'commentary';

export interface StreamPresentationTextState {
  answerText: string;
  commentaryText: string;
  lastAnswerMessageUuid?: string;
  lastCommentaryMessageUuid?: string;
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
  event: Pick<StreamEvent, 'eventType'>,
  runtimeIdentity?: StreamRuntimeIdentity | null,
): StreamPresentationTextChannel | null {
  if (event.eventType !== 'text_delta') return null;
  void runtimeIdentity;
  return 'answer';
}

function appendCodexPresentationText(
  current: StreamPresentationTextState,
  event: Pick<StreamEvent, 'text' | 'messageUuid'>,
): StreamPresentationTextState {
  const incomingMessageUuid = event.messageUuid || current.lastAnswerMessageUuid;
  const crossedMessageBoundary =
    !!current.answerText &&
    !!current.lastAnswerMessageUuid &&
    !!event.messageUuid &&
    current.lastAnswerMessageUuid !== event.messageUuid;

  if (crossedMessageBoundary) {
    const commentaryAppended = appendStreamTextDelta(
      current.commentaryText,
      {
        text: current.answerText,
        messageUuid: current.lastAnswerMessageUuid,
      },
      current.lastCommentaryMessageUuid,
    );
    const answerAppended = appendStreamTextDelta(
      '',
      event,
      undefined,
    );
    return {
      ...current,
      answerText: answerAppended.text,
      commentaryText: commentaryAppended.text,
      lastAnswerMessageUuid:
        answerAppended.lastMessageUuid || incomingMessageUuid || undefined,
      lastCommentaryMessageUuid: commentaryAppended.lastMessageUuid,
    };
  }

  const answerAppended = appendStreamTextDelta(
    current.answerText,
    event,
    current.lastAnswerMessageUuid,
  );
  return {
    ...current,
    answerText: answerAppended.text,
    lastAnswerMessageUuid:
      answerAppended.lastMessageUuid || incomingMessageUuid || undefined,
  };
}

export function appendStreamPresentationText(
  current: StreamPresentationTextState,
  event: Pick<StreamEvent, 'eventType' | 'text' | 'messageUuid' | 'runtimeIdentity'>,
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

  if (resolvedRuntimeIdentity?.agentType === 'codex') {
    return appendCodexPresentationText(current, event);
  }

  if (channel === 'commentary') {
    const appended = appendStreamTextDelta(
      current.commentaryText,
      event,
      current.lastCommentaryMessageUuid,
    );
    return {
      ...current,
      commentaryText: appended.text,
      lastCommentaryMessageUuid: appended.lastMessageUuid,
    };
  }

  const appended = appendStreamTextDelta(
    current.answerText,
    event,
    current.lastAnswerMessageUuid,
  );
  return {
    ...current,
    answerText: appended.text,
    lastAnswerMessageUuid: appended.lastMessageUuid,
  };
}
