# Feishu Restart Card Residue Fix

## Goal

- Find and fix the root cause of Feishu cards showing previous-turn content after self-restart.
- Prove the fix with a regression that models restart residue before the first Feishu-origin turn.
- Distinguish prompt/context injection from stale streaming card presentation state.

## Done when

- Startup recovery discards stale streaming buffers and `active_streaming_turns` without persisting partial assistant text or committing the user cursor.
- The first Feishu-origin message after restart creates/updates a fresh card whose prompt, card text, persisted reply, and committed cursor belong only to the current turn.
- Regression tests fail on the old behavior and pass after the fix.
- Validation, review, and commit pass; service restart is left manual because the user may have active work running.

## Milestones

### Milestone 54

Objective:
- Fix Feishu first-message-after-restart card residue and cover it with a real-enough startup recovery regression.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/ARCHITECTURE.md`
- `docs/MEMORY.md`
- `docs/RUNTIME.md`
- `container/agent-runner/src/index.ts`
- `src/group-queue.ts`
- `src/index.ts`
- `src/web.ts`
- `tests/group-queue.test.ts`
- `tests/restart-recovery.test.ts`
- `tests/feishu-e2e.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/stream-presentation.test.ts`
- `tests/streaming-turn-boundary.test.ts`

Validation:
- `npm test -- --run tests/feishu-e2e.test.ts tests/restart-recovery.test.ts tests/feishu-streaming-card.test.ts tests/streaming-turn-boundary.test.ts tests/stream-presentation.test.ts tests/reply-visibility.test.ts tests/group-queue.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed 2026-04-29:
  - `npm test -- --run tests/feishu-e2e.test.ts tests/restart-recovery.test.ts tests/feishu-streaming-card.test.ts tests/streaming-turn-boundary.test.ts tests/stream-presentation.test.ts tests/reply-visibility.test.ts tests/group-queue.test.ts` (124 tests)
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed:
  - Subagent review confirmed no blocking stale-card or in-flight message loss issue after the fix.
  - Follow-up test gaps from review were addressed: current cursor-less `text_delta`, plus restart residue seeded into real Feishu card payload assertions.
  - Manual semantic review of queue/runtime/card boundaries completed after validation.

Risks / Notes / Handoff:
- The latest observed screenshot points to stale Feishu card/streaming presentation residue, not necessarily agent prompt DB-history injection.
- Root cause: in-flight IPC could inject a new user message into the same runtime query while old stream events were still arriving, so Feishu routing/card state switched to the new message and then rendered old stream output.
- Fix summary: new messages queue behind an active query; IPC is consumed only between queries; stream/card state is bounded by `messageCursor.id`; startup recovery discards stale streaming buffer/active-turn state without persisting partial output or advancing cursors.
- No service restart performed in this milestone because the user previously asked not to auto-restart while tasks may be running.
