# Feishu Streaming State Cleanup

## Goal

- Fix Feishu reply-state cleanup when the same chat sends consecutive requests.
- Old streaming cards must leave `Working on it`, and request-message `OnIt` reactions must not linger after the reply finishes.

## Done when

- A new inbound Feishu message in the same chat proactively aborts any active streaming card from the superseded reply.
- Pending Feishu `OnIt` reactions are cleaned up correctly even when multiple requests arrive in the same chat before earlier cleanup runs.
- Focused regression tests cover both behaviors and pass.

## Milestones

### Milestone 1

Objective:
- Reproduce the two Feishu state bugs with failing tests before changing production code.

Allowed scope:
- `PLANS/ACTIVE.md`
- `tests/feishu-connection.test.ts`

Validation:
- `npm test -- tests/feishu-connection.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Root cause hypothesis 1: `ackReactionByChat` is keyed only by `chatId`, so a later request overwrites the earlier pending reaction entry and cleanup only removes the newest one.
- Root cause hypothesis 2: a new inbound message does not proactively abort the previous active streaming card early enough in the Feishu receive path, so the old card can remain in streaming UI state.

### Milestone 2

Objective:
- Implement the Feishu cleanup fix and verify the repaired state transitions.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/feishu.ts`
- `tests/feishu-connection.test.ts`

Validation:
- `npm test -- tests/feishu-connection.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep the fix local to Feishu state handling unless failing tests prove a broader streaming-session lifecycle bug in `src/index.ts`.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- None

Current status:
- completed

Changed files:
- `PLANS/ACTIVE.md`
- `src/feishu.ts`
- `tests/feishu-connection.test.ts`

Last failure summary:
- `tests/feishu-connection.test.ts` reproduced both bugs: the Feishu receive path never touched the existing streaming session on a follow-up message, and ack cleanup only deleted the most recent `OnIt` reaction for a chat.

Suspected cause:
- Feishu kept only one pending reaction handle per chat, and accepted follow-up messages did not proactively abort the previous active streaming card.

Next step:
- Commit the Feishu cleanup fix; then apply it through the safe restart path so the running service picks up the new receive/cleanup behavior.
