# Feishu Agent Streaming Cleanup Parity

## Goal

- Fix Feishu cleanup gaps that still exist on conversation-agent streaming paths.
- Old agent-scoped streaming cards must leave `Working on it` when a new message arrives in the same chat.
- Request-message `OnIt` reactions must clear when a streaming card reaches terminal state, even when the reply is handled by the Feishu streaming card instead of normal `sendMessage()`.

## Done when

- A new inbound Feishu message aborts both the main-session streaming card and any agent-scoped streaming cards for the same IM chat.
- Feishu streaming cards clear pending ack reactions on terminal transitions without relying on the caller to remember an extra cleanup step.
- Focused regression tests cover both behaviors and pass.

## Milestones

### Milestone 1

Objective:
- Reproduce the remaining agent-path cleanup gaps with failing tests before changing production code.

Allowed scope:
- `PLANS/ACTIVE.md`
- `tests/feishu-connection.test.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- tests/feishu-streaming-card.test.ts`
- `npm test -- tests/feishu-connection.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Root cause hypothesis 1: Feishu receive path only aborts the exact `chatJid` session, but conversation-agent cards are registered under scoped keys like `${chatJid}#agent:${agentId}`.
- Root cause hypothesis 2: ack reaction cleanup depends on the caller invoking `clearAckReaction()`, so conversation-agent streaming completion can miss cleanup entirely.
- Reproduced via focused red tests:
  - `tests/feishu-connection.test.ts` shows inbound Feishu messages never trigger scoped-session cleanup for the same base chat.
  - `tests/feishu-streaming-card.test.ts` shows the controller never fires a terminal cleanup hook on `complete()`.

### Milestone 2

Objective:
- Implement the agent-path cleanup fix and verify the repaired state transitions.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/feishu-streaming-card.ts`
- `src/feishu.ts`
- `src/im-channel.ts`
- `tests/feishu-connection.test.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- tests/feishu-streaming-card.test.ts`
- `npm test -- tests/feishu-connection.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep the fix local to Feishu streaming session lifecycle unless tests show an index-level caller contract is still required.
- Implemented locally in Feishu streaming/session adapters; no index-level caller changes were needed.

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
- `src/feishu-streaming-card.ts`
- `src/feishu.ts`
- `src/im-channel.ts`
- `tests/feishu-connection.test.ts`
- `tests/feishu-streaming-card.test.ts`

Last failure summary:
- Resolved. Focused validation now passes:
  - `npm test -- tests/feishu-connection.test.ts`
  - `npm test -- tests/feishu-streaming-card.test.ts`
  - `git diff --check`
  - `./scripts/review.sh` + semantic review checklist in `RUNBOOKS/Review.md`

Suspected cause:
- Confirmed: agent-scoped Feishu streaming sessions were keyed differently from the base chat JID, and terminal ack cleanup was not owned by the streaming controller itself.

Next step:
- Commit the fix, then apply it through the safe restart path so the running service picks up the updated Feishu cleanup behavior.
