# Feishu Message Reliability Control Plane

## Goal

- Start implementing P0 `RM-2026-04-25-01` one small reliability fix at a time.
- Prevent stale live Feishu WS messages from poisoning startup backfill dedupe, so restart-window messages can still be recovered and queued.
- Record durable operator-visible evidence when a Feishu-origin message exhausts queue retries.

## Done when

- A regression test proves a stale live WS delivery before `ignoreMessagesBefore` does not suppress the same message when it is later recovered by startup backfill.
- `src/feishu.ts` only records inbound Feishu messages in the dedupe cache after the message passes the stale-window filter.
- Feishu inbound messages write durable lifecycle events that can be queried by chat/message id.
- `/status` formatting has a compact section for recent Feishu lifecycle evidence.
- Queue max-retry exhaustion records `dead_lettered` lifecycle events for pending Feishu-origin messages.
- `PLANS/ROADMAP.md` records the milestone progress.
- Validation and review gate pass.

## Milestones

### Milestone 1

Objective:
- Fix stale WS dedupe poisoning startup backfill.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/feishu.ts`
- `tests/feishu-connection.test.ts`

Validation:
- `npm test -- --run tests/feishu-connection.test.ts`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`
- Manual review against `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- This milestone intentionally handles only the first RM-2026-04-25-01 reliability defect; queue dead-letter, delivery/cursor commit, readiness gating, and observability stay in the roadmap.
- TDD red observed before the fix: `npm test -- --run tests/feishu-connection.test.ts` failed because `storeMessageDirect` was called 0 times for the stale-WS/backfill overlap case.
- Fix applied: `markSeen(messageId)` now runs only after the stale-window filter passes.
- Validation passed:
  - `npm test -- --run tests/feishu-connection.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - Existing live-WS/backfill dedupe behavior remains covered by the adjacent overlap test.
  - No unrelated refactor or launch contract change was included.
- Runtime code changes affect the running Cli Claw service; after commit, use the documented safe restart path.

### Milestone 2

Objective:
- Add a durable Feishu inbound lifecycle ledger and compact status formatting so real-world "no reply" cases have evidence beyond mock tests.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/types.ts`
- `src/db.ts`
- `src/feishu.ts`
- `src/im-command-utils.ts`
- `src/index.ts`
- `tests/im-message-lifecycle.test.ts`
- `tests/feishu-connection.test.ts`
- `tests/im-command-utils.test.ts`

Validation:
- `npm test -- --run tests/im-message-lifecycle.test.ts`
- `npm test -- --run tests/feishu-connection.test.ts`
- `npm test -- --run tests/im-command-utils.test.ts`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`
- Manual review against `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- This is observability-first: it should not change queue, runner, delivery, or cursor semantics yet.
- TDD red observed before the DB API existed: `npm test -- --run tests/im-message-lifecycle.test.ts` failed with `recordImMessageLifecycleEvent is not a function`.
- TDD red observed before Feishu instrumentation existed: `npm test -- --run tests/feishu-connection.test.ts` failed because no lifecycle events were recorded.
- TDD red observed before status formatting existed: `npm test -- --run tests/im-command-utils.test.ts` failed because `formatImLifecycleStatus` was not exported.
- Implemented durable `im_message_lifecycle_events` rows and query helpers keyed by provider/chat/message id.
- Feishu accepted inbound messages now record `received -> stored -> notified`; duplicate, stale, empty, and mention-gated messages record `skipped` with a reason.
- `/status` on Feishu appends one compact lifecycle line with at most three recent events.
- Validation passed:
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm test -- --run tests/feishu-connection.test.ts`
  - `npm test -- --run tests/im-command-utils.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - Lifecycle write failures are isolated and do not block Feishu message handling.
  - No queue, runner, delivery, or cursor semantics changed in this milestone.

### Milestone 3

Objective:
- Wire post-store lifecycle events for Feishu-origin messages when they are queued or injected into an agent, delivered back to IM, and committed by cursor.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `src/im-message-lifecycle.ts`
- `tests/im-message-lifecycle.test.ts`

Validation:
- `npm test -- --run tests/im-message-lifecycle.test.ts`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`
- Manual review against `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep this milestone observability-only: do not change queue, runner, retry, delivery, or cursor semantics.
- Added `recordLifecycleForMessages()` so Feishu-origin routed messages can safely emit later lifecycle evidence while web-origin messages are ignored.
- Main message loop now records `queued` when Feishu-origin messages are IPC-injected into an active runner or queued for a fresh run.
- Conversation agent runs now record `runner_started`, `finalized`, `im_delivered`, and one `cursor_committed` event for Feishu-origin pending messages.
- Deferred `stream_started`; `dead_lettered` landed separately in Milestone 4.
- TDD red observed before the helper existed: `npm test -- --run tests/im-message-lifecycle.test.ts` failed with missing `src/im-message-lifecycle.ts`.
- Validation passed:
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change is observability-only and does not alter queue, retry, delivery, or cursor semantics.
  - Lifecycle write failures remain isolated from message handling.

### Milestone 4

Objective:
- Record durable `dead_lettered` lifecycle evidence for Feishu-origin pending messages when queue max retries are exhausted.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `src/im-message-lifecycle.ts`
- `tests/im-message-lifecycle.test.ts`

Validation:
- `npm test -- --run tests/im-message-lifecycle.test.ts`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`
- Manual review against `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep this milestone observability-only: do not change retry count, cursor commit, delivery, or queue scheduling semantics.
- Lifecycle write failures must remain isolated from message handling.
- TDD red observed after fixing the fixture setup: `npm test -- --run tests/im-message-lifecycle.test.ts` failed with `recordDeadLetteredLifecycleForPendingMessages is not a function`.
- Added `recordDeadLetteredLifecycleForPendingMessages()` so pending messages after the processing cursor can emit `dead_lettered` lifecycle rows for Feishu-origin work while ignoring web-only rows.
- Queue max-retry exhaustion now calls the helper and logs the number of recorded dead-letter lifecycle rows before sending the existing system failure message.
- Validation passed:
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change is observability-only and does not alter queue, retry, delivery, or cursor semantics.
  - The directly related lifecycle test covers Feishu-origin routed work and ignores web-origin work.

### Milestone 5

Objective:
- Prevent main-session Feishu routed replies from committing the message cursor when the static IM delivery path fails after retries.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `tests/restart-recovery.test.ts`

Validation:
- `npm test -- --run tests/restart-recovery.test.ts`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`
- Manual review against `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep this milestone scoped to the main-session routed static IM path. Conversation-agent routed delivery, Feishu channel readiness gating, and backfill ownership coverage stay in `PLANS/ROADMAP.md`.
- TDD red observed before the helper existed: `npm test -- --run tests/restart-recovery.test.ts` failed with `shouldCommitCursorAfterRoutedImDelivery is not a function`.
- Added a cursor-commit policy helper and wired `processGroupMessages` so main-session routed static IM delivery is awaited, records `im_delivered` lifecycle evidence, and blocks cursor commit when delivery fails after retries.
- When the cursor gate is blocked, `processGroupMessages` returns `false` from post-run commit points so `GroupQueue` keeps the work retryable instead of treating the turn as successfully drained.
- Validation passed:
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change targets only main-session routed static IM delivery.
  - The remaining conversation-agent routed delivery, readiness gating, and backfill ownership fixes remain in `PLANS/ROADMAP.md`.

### Milestone 6

Objective:
- Prevent conversation-agent Feishu routed replies from committing the virtual message cursor when the static IM delivery path fails after retries.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `tests/restart-recovery.test.ts`

Validation:
- `npm test -- --run tests/restart-recovery.test.ts`
- `npm test -- --run tests/im-message-lifecycle.test.ts`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`
- Manual review against `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep this milestone scoped to conversation-agent static IM delivery after an agent final reply. Streaming-card delivery, interrupt partial delivery, readiness gating, and backfill ownership coverage stay in `PLANS/ROADMAP.md`.
- Follow TDD: add the missing cursor-commit policy test first, observe the expected red, then wire the policy into `processAgentConversation`.
- TDD red observed before the helper existed: `npm test -- --run tests/restart-recovery.test.ts` failed with `shouldCommitAgentConversationCursorAfterImDelivery is not a function`.
- TDD red observed for the duplicate-partial guard: `npm test -- --run tests/restart-recovery.test.ts` failed with `shouldSaveAgentConversationPartialReply is not a function`.
- Added a conversation-agent cursor commit block so Feishu-origin static IM reply failure after retries keeps the virtual cursor uncommitted instead of treating the turn as drained.
- Added a partial-save guard so a final reply that already exists does not get duplicated as `interrupt_partial` merely because the cursor was intentionally left uncommitted.
- Validation passed:
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change targets only conversation-agent routed static IM delivery after a final reply.
- Remaining startup readiness, backfill ownership, interrupted partial, and other direct/mirror delivery fixes remain in `PLANS/ROADMAP.md`.

### Milestone 7

Objective:
- Prevent Feishu-origin interrupted partial replies from committing the cursor when no streaming card handled IM delivery and the static IM partial delivery fails after retries.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `tests/restart-recovery.test.ts`

Validation:
- `npm test -- --run tests/restart-recovery.test.ts`
- `npm test -- --run tests/im-message-lifecycle.test.ts`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`
- Manual review against `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep this milestone scoped to interrupted partial delivery gating. Startup readiness, backfill ownership coverage, and mirror/direct file delivery remain in `PLANS/ROADMAP.md`.
- Follow TDD: add the missing cursor-commit policy test first, observe the expected red, then wire the policy into main and conversation-agent interrupted partial paths.
- TDD red observed before the helper existed: `npm test -- --run tests/restart-recovery.test.ts` failed with `shouldCommitCursorAfterInterruptedPartialDelivery is not a function`.
- Added `shouldCommitCursorAfterInterruptedPartialDelivery()` and wired interrupted partial handling so Feishu-origin partials only commit the cursor when an IM target is not required, a streaming card actually handled delivery, or static IM partial delivery succeeds.
- Main-session and conversation-agent interrupted partial paths now record `im_delivered` lifecycle success/failure for static partial delivery and block cursor commit on `send_failed_after_retries`.
- Conversation-agent partial fallback now avoids duplicating a partial reply in the same cleanup pass after a status-event partial was already saved.
- First review helper run failed Prettier formatting for `src/index.ts`; formatting was fixed and validation was rerun.
- Validation passed:
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change targets only interrupted partial delivery/cursor semantics.
  - Remaining startup readiness, backfill ownership, and mirror/direct file delivery fixes remain in `PLANS/ROADMAP.md`.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 7

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/types.ts`
- `src/db.ts`
- `src/feishu.ts`
- `src/im-command-utils.ts`
- `src/index.ts`
- `src/im-message-lifecycle.ts`
- `tests/im-message-lifecycle.test.ts`
- `tests/feishu-connection.test.ts`
- `tests/im-command-utils.test.ts`
- `tests/restart-recovery.test.ts`

Last failure summary:
- Expected TDD reds:
  - Missing lifecycle DB API.
  - Missing Feishu lifecycle instrumentation.
  - Missing compact lifecycle status formatter.
  - Missing post-store lifecycle helper for Feishu-origin routed messages.
  - Missing dead-letter lifecycle helper for pending Feishu-origin messages.
  - Missing routed IM cursor commit policy helper.

Suspected cause:
- The prior system had only scattered logs and no durable, message-keyed lifecycle ledger for real Feishu diagnostics.

Next step:
- Continue RM-2026-04-25-01 with the next smallest reliability fix: startup recovery readiness, Feishu backfill ownership coverage, or remaining mirror/direct delivery cursor semantics.
