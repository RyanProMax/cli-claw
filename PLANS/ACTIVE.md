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
- Startup Feishu backfill includes Feishu chats that share a workspace/folder with the connecting user even when the Feishu row is ownerless or has a stale owner.
- Startup pending-message recovery and message loop start only after the IM connection phase has completed in normal service mode.
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

### Milestone 8

Objective:
- Include ownerless or stale-owner Feishu registered chats in a user's startup backfill set when they share a workspace/folder with that user's registered groups.

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
- Keep this milestone scoped to startup backfill chat-id selection only. Do not change Feishu connection timing, queue retry semantics, or delivery/cursor behavior here.
- Follow TDD: add the missing selection test first, observe the expected red, then wire `connectUserIMChannels()` to use the same selection contract.
- TDD red observed before the helper existed: `npm test -- --run tests/restart-recovery.test.ts` failed with `selectFeishuStartupBackfillChatIds is not a function`.
- Added `selectFeishuStartupBackfillChatIds()` so Feishu startup backfill includes chats in folders owned by the connecting user, including ownerless and stale-owner Feishu rows, while excluding other workspaces.
- `connectUserIMChannels()` now builds Feishu startup backfill chat ids from all registered groups through that helper instead of only `getGroupsByOwner(userId)`.
- Validation passed:
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change targets only startup Feishu backfill chat-id selection.
  - Remaining startup readiness and mirror/direct file delivery fixes remain in `PLANS/ROADMAP.md`.

### Milestone 9

Objective:
- Gate startup pending-message recovery and the message loop until after the IM connection phase finishes, so recovered Feishu-origin work does not attempt delivery before Feishu is connected.

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
- Keep this milestone scoped to startup ordering only. Do not change queue retry, cursor, delivery, or Feishu connection internals here.
- TDD red observed before the helper existed: `npm test -- --run tests/restart-recovery.test.ts` failed with `shouldStartStartupMessageRecovery is not a function`.
- Added `shouldStartStartupMessageRecovery()` and moved `recoverPendingMessages()`, `recoverConversationAgents()`, and `startMessageLoop()` until after the normal IM connection phase completes.
- `recoverStreamingBuffer()` can still run before IM readiness because it restores persisted streaming state, but pending-message recovery and message loop should wait until normal IM connection attempts finish.
- Validation passed:
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - Queue retry, cursor, delivery, and Feishu connection internals were not changed.
  - The startup pending recovery/message loop now run after the IM connection phase in normal service mode and do not run in self-check mode.

### Milestone 10

Objective:
- Record durable `stream_started` lifecycle evidence for Feishu-origin turns when the runner emits the first stream init event.

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
- Keep this milestone observability-only: do not change stream rendering, queue retry, delivery, or cursor commit semantics.
- Follow TDD: add a lifecycle helper regression first, observe the expected red, then wire the helper into main and conversation-agent stream init handling.
- TDD red observed before the helper existed: `npm test -- --run tests/im-message-lifecycle.test.ts` failed with `recordStreamStartedLifecycleForMessages is not a function`.
- Added `recordStreamStartedLifecycleForMessages()` so stream init events can write durable `stream_started` lifecycle rows only for Feishu-origin messages while ignoring web-only rows.
- Main-session and conversation-agent stream init handlers now record `stream_started` once per processed Feishu-origin turn with cursor, turn/session ids, route, and streaming target details.
- Validation passed:
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change is observability-only and does not alter stream rendering, queue retry, delivery, or cursor commit semantics.
  - Directly related lifecycle test uses the real DB helper path and confirms web-only rows are ignored.

### Milestone 11

Objective:
- Record durable `im_delivered` lifecycle evidence for Feishu-origin mirror reply sends that still use the fire-and-forget IM delivery path.

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
- Keep this milestone scoped to mirror reply observability. Mirror delivery remains secondary and must not block the source reply cursor.
- Follow TDD: add a fire-and-forget delivery lifecycle test first, observe the expected red, then wire mirror call sites to pass lifecycle context.
- TDD red observed before the wrapper supported lifecycle evidence: `npm test -- --run tests/restart-recovery.test.ts` failed with `sendImWithFailTracking is not a function`.
- `sendImWithFailTracking()` now returns a swallowed promise for testability and can record `im_delivered` lifecycle success/failure after the background IM retry finishes.
- Main-session and conversation-agent mirror reply paths now pass Feishu-origin turn messages into the fire-and-forget delivery wrapper, so mirror failures become durable lifecycle evidence without blocking the source cursor.
- Validation passed:
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - Mirror delivery remains secondary and non-blocking.
  - The new test exercises the actual fire-and-forget wrapper with injected retry/lifecycle dependencies.

### Milestone 12

Objective:
- Record durable `im_delivered` lifecycle evidence for Feishu-origin direct `send_image` and `send_file` IPC tool deliveries, including failure and skipped/no-route outcomes.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `src/im-message-lifecycle.ts`
- `tests/im-message-lifecycle.test.ts`

Validation:
- `npm test -- --run tests/im-message-lifecycle.test.ts`
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
- Keep this milestone scoped to lifecycle evidence for direct IPC image/file delivery. Do not change retry counts, cursor commit policy, or scheduled-task broadcast semantics here.
- Follow TDD: add a direct IPC delivery lifecycle helper regression first, observe the expected red, then wire `send_image` and `send_file` IPC paths to use the active Feishu-origin turn context.
- TDD red observed before the helper existed: `npm test -- --run tests/im-message-lifecycle.test.ts` failed with `recordDirectImDeliveryLifecycleForMessages is not a function`.
- Added `recordDirectImDeliveryLifecycleForMessages()` so direct IPC tool delivery can record `im_delivered` lifecycle events as `ok`, `error`, or `skipped`.
- Main and conversation-agent runs now publish the active Feishu-origin turn context for direct `send_image` / `send_file` IPC processing; web-origin route updates clear stale lifecycle context.
- Direct `send_image` and `send_file` IPC paths now record lifecycle evidence for retry failure, no-route skip, and file-not-found skip without changing retry counts, cursor policy, or scheduled-task broadcast semantics.
- Validation passed:
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - Direct image failure and direct file no-route skip are covered by lifecycle tests.
  - Retry, cursor commit, and scheduled-task broadcast behavior were not changed.
  - The restart-recovery suite emitted the existing MaxListeners warnings but all tests passed.

### Milestone 13

Objective:
- Surface recent non-ok Feishu lifecycle events in `/status` so delivery failures and skipped processing reasons stay visible even when later ok events arrive.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `src/db.ts`
- `src/im-command-utils.ts`
- `src/index.ts`
- `tests/im-message-lifecycle.test.ts`
- `tests/im-command-utils.test.ts`

Validation:
- `npm test -- --run tests/im-message-lifecycle.test.ts`
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
- Keep this milestone observability-only: do not change queue, delivery, cursor, or Feishu connection behavior.
- Follow TDD: add the failure-specific lifecycle query/formatting tests first, observe the expected red, then wire `/status` to include the compact failure line for Feishu chats.
- Added `getRecentImMessageLifecycleIssueEvents()` so `/status` can query recent Feishu lifecycle rows whose status is not `ok`, even when newer successful lifecycle rows exist.
- `formatImLifecycleStatus()` now keeps the existing compact lifecycle line and appends a separate compact `飞书异常` line for recent non-ok lifecycle events.
- Feishu `/status` now passes recent issue events into the formatter; non-Feishu `/status` output is unchanged.
- `docs/COMMAND.md` documents the additional Feishu `/status` failure line.
- Validation passed:
  - `npm test -- --run tests/im-message-lifecycle.test.ts`
  - `npm test -- --run tests/im-command-utils.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change is observability-only and does not alter queue, delivery, cursor, or Feishu connection behavior.
  - The new DB and formatter tests cover the key failure surfacing contract.

### Milestone 14

Objective:
- Surface recent non-ok Feishu lifecycle events in admin `/self-status` so global service diagnostics include delivery failures and skipped processing reasons without requiring operators to run `/status` in each Feishu chat.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `src/im-command-utils.ts`
- `src/index.ts`
- `tests/im-command-utils.test.ts`

Validation:
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
- Keep this milestone observability-only: do not change queue, delivery, cursor, Feishu connection, or restart behavior.
- Follow TDD: add a formatter regression first, observe the expected red, then wire `/self-status` to query global recent Feishu issue lifecycle events.
- TDD red observed before formatter support existed: `npm test -- --run tests/im-command-utils.test.ts` failed because `/self-status` output did not include the Feishu issue summary.
- Added optional `feishuIssueEvents` to `formatSelfStatus()` and reused the compact Feishu issue summary from `/status`.
- `buildCurrentSelfStatusText()` now queries the three most recent non-ok Feishu lifecycle events globally.
- `docs/COMMAND.md` documents the additional `/self-status` Feishu issue summary.
- Validation passed:
  - `npm test -- --run tests/im-command-utils.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change is observability-only and does not alter queue, delivery, cursor, Feishu connection, or restart behavior.

### Milestone 15

Objective:
- Fix the 2026-04-26 self-restart incident where Feishu-origin streaming work was persisted only to DB, marked committed, and therefore never retried in Feishu after restart; also make self-restart residual runner cleanup reap orphan runner process groups instead of only individual PIDs, and reuse that cleanup during backend startup.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `src/index.ts`
- `src/self-restart.ts`
- `tests/restart-recovery.test.ts`
- `tests/self-restart.test.ts`

Validation:
- `npm test -- --run tests/restart-recovery.test.ts`
- `npm test -- --run tests/self-restart.test.ts`
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
- Incident evidence from 2026-04-26: Feishu message `om_x100b51ed3cf378a0b2df988b2f86630` reached `stream_started`, then self-restart suppressed IM delivery of the shutdown partial (`sendToIM=false`) while advancing `last_committed_cursor`, leaving no Feishu-visible reply and no retry after restart.
- Incident evidence from `/self-restart`: residual summary reported runner `31` and orphan runner `15`; local process table showed old `codex-acp` children reparented to PID 1. Existing cleanup only sent `SIGTERM` to orphan PIDs and did not target the orphan process groups.
- Follow TDD: add failing policy tests before changing production code.
- TDD red observed before the cursor policy helper existed: `npm test -- --run tests/restart-recovery.test.ts` failed with `applyShutdownInterruptedStreamingCommittedCursor is not a function`.
- TDD red observed before PGID summary/cleanup existed: `npm test -- --run tests/self-restart.test.ts` failed because `orphanRunnerGroupIds` was missing and cleanup called individual orphan PIDs instead of negative PGID.
- `saveInterruptedStreamingMessages()` now leaves the Feishu committed cursor unchanged when self-restart intentionally suppresses IM delivery of the shutdown partial, so the inbound message remains retryable after restart.
- Self-restart residual inspection now asks `ps` for `PGID`, summarizes orphan runner process groups, and cleanup sends `SIGTERM` to negative PGIDs before falling back to individual PID cleanup.
- Backend startup now reuses the same one-pass residual inspection and cleanup helper after self-check mode is excluded, so orphan runner groups left by older restarts can be reaped even before the next `/self-restart` notification path.
- Validation passed:
  - `npm test -- --run tests/restart-recovery.test.ts`
  - `npm test -- --run tests/self-restart.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The cursor change is limited to self-restart shutdown partials whose IM delivery is intentionally suppressed.
  - The residual cleanup path preserves the old individual PID fallback when PGID data is unavailable.

### Milestone 16

Objective:
- Start P0 `RM-2026-04-25-02` with the smallest operator-facing guardrail: `/self-status` must explicitly warn when the service is running in `direct_backend` mode and show the canonical launcher path (`cli-claw start` / `cli-claw restart`) as the recommended long-running entrypoint.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `src/im-command-utils.ts`
- `tests/im-command-utils.test.ts`

Validation:
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
- Keep this milestone presentation-only: do not change `Makefile`, `package.json`, LaunchAgent install behavior, self-check behavior, or restart semantics yet.
- Follow TDD: add a formatter regression first, observe the expected red, then add the direct-backend warning to `formatSelfStatus()`.
- TDD red observed before formatter support existed: `npm test -- --run tests/im-command-utils.test.ts` failed because `/self-status` output did not explain `direct_backend` or show the canonical launcher recommendation.
- `formatSelfStatus()` now appends a direct-backend warning and `cli-claw start / cli-claw restart` recommendation when `restart.source === 'direct_backend'`.
- `docs/COMMAND.md` documents the new `/self-status` direct-backend warning.
- Validation passed:
  - `npm test -- --run tests/im-command-utils.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change is presentation-only and does not alter startup, self-check, or restart behavior.
- Applied evidence:
  - Commit `54c0e47 Warn on direct backend self status`.
  - Safe restart `restart-2026-04-26T05-35-28-464Z-595d6899` passed.
  - `/api/health` returned healthy for backend PID `63108`.

### Milestone 17

Objective:
- Make admin `/self-check` validate the same authoritative startup launch spec captured by the running backend, instead of implicitly checking `node dist/index.js`, and show the candidate command in the self-check result.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `src/self-check.ts`
- `src/index.ts`
- `src/im-command-utils.ts`
- `tests/self-check.test.ts`
- `tests/im-command-utils.test.ts`

Validation:
- `npm test -- --run tests/self-check.test.ts`
- `npm test -- --run tests/im-command-utils.test.ts`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`
- Manual review against `RUNBOOKS/Review.md`

Status:
- pending

Validation status:
- pending

Review status:
- pending

Risks / Notes / Handoff:
- Keep this milestone scoped to self-check launch-spec alignment and operator-visible formatting. Do not change Makefile, package scripts, LaunchAgent install defaults, or restart semantics here.
- Follow TDD: add failing tests for launch-spec cwd propagation and self-check command formatting before changing implementation.
- Paused before code changes on 2026-04-26 because the Feishu-triggered Web autopilot reply leak is a higher-priority P0 production incident.
- Paused again on 2026-04-26 because Feishu "继续任务 -" triggered an agent-initiated safe restart; preventing unexpected restarts is higher priority than self-check formatting.

### Milestone 18

Objective:
- Prevent workspace autopilot/background task results from publishing visible Web replies when the task was interrupted or preempted by real user/IM work, so a Feishu message such as "继续任务" cannot cause Web to immediately receive the background task's stale process/history text.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/task-scheduler.ts`
- `tests/task-scheduler-host-cwd.test.ts`

Validation:
- `npm test -- --run tests/task-scheduler-host-cwd.test.ts`
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
- Incident evidence from 2026-04-26: Feishu message `om_x100b51ee7e1e90acb22c773d634b6dd` arrived at `2026-04-26T05:30:53.296Z`; the queue closed the active `web:main` background task, and that task immediately published a `scheduled_task` message to `web:main` at `2026-04-26T05:30:53.722Z` before the Feishu run started.
- Keep this milestone scoped to suppressing visible background/autopilot publication after user work preempts the run. Do not change Feishu streaming card rendering, recovery-history injection, cursor semantics, or the self-check launch milestone here.
- Follow TDD: add a failing scheduler regression first, then make `runWorkspaceAutopilotTask()` consult queue state before publishing the result.
- TDD red observed before the fix: `npm test -- --run tests/task-scheduler-host-cwd.test.ts` failed because the interrupted autopilot still called `sendMessage('web:source', ..., { source: 'scheduled_task' })`.
- `runWorkspaceAutopilotTask()` now suppresses visible scheduled-task publication when the queue reports a pending IM sibling for the target Web workspace, while preserving task-run log evidence.
- Validation passed:
  - `npm test -- --run tests/task-scheduler-host-cwd.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - The change keeps normal uninterrupted autopilot publication behavior unchanged.
  - The regression test covers the incident class and confirms suppressed output is still recorded in the task run log.
- Applied evidence:
  - Commit `Suppress interrupted autopilot replies`.
  - Safe restart `restart-2026-04-26T05-44-42-058Z-81afb19b` passed.
  - `/api/health` returned healthy for backend PID `72604`.
  - Post-restart process table showed one current backend and one current runner group, not the previous historical runner residue.

### Milestone 19

Objective:
- Prevent IM-origin agent runs from autonomously triggering `cli-claw restart` or equivalent CLI restart commands from shell/tool execution. Feishu users must explicitly send `/self-restart` or a managed restart phrase such as "重启服务"; a vague continuation message must never execute a stale restart action from previous context.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `shared/service-restart-guard.ts`
- `container/agent-runner/src/index.ts`
- `tests/service-restart-guard.test.ts`

Validation:
- `npm test -- --run tests/service-restart-guard.test.ts`
- `npm run typecheck`
- `npm --prefix container/agent-runner run build:runner`
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
- Incident evidence from 2026-04-26: Feishu message `om_x100b51ee3e1b50acb3b0af6442e5761` content `继续任务 -` was processed together with two older uncommitted Feishu messages; the run reused session `019dc849-58e3-7d03-9a5d-168cb1bd5efb`, streamed stale task text, then generated restart intent `restart-2026-04-26T05-48-29-442Z-fa67eec6` with `requestChatJid = feishu:oc_98f0bb60f284627bf20f9386704f8c82`.
- Keep this milestone scoped to blocking agent-runner shell/tool restarts from IM-origin runs. Do not change pending cursor replay, recovery-history injection, Feishu card rendering, or self-check behavior here.
- Follow TDD: add a failing service restart guard test for disallowing safe restart commands in agent-runner context, then wire the runner permission hooks to use that stricter policy for IM-origin chats.
- TDD red observed before the fix: `npm test -- --run tests/service-restart-guard.test.ts` failed because `cli-claw restart` returned `null` even with `allowSafeRestartCommand: false`.
- `detectUnsafeCliClawServiceControl()` now supports a stricter agent-runner policy that blocks `cli-claw restart` and `bun/node/tsx .../cli.ts restart` variants with an IM-specific denial message.
- Agent-runner Bash and Codex ACP permission hooks now allow shell safe restart only for Web-origin chats; IM-origin runs must use backend-managed `/self-restart` or Feishu managed restart phrases.
- Validation passed:
  - `npm test -- --run tests/service-restart-guard.test.ts`
  - `npm run typecheck`
  - `npm --prefix container/agent-runner run build:runner`
  - `git diff --check`
  - `./scripts/review.sh`
  - `npx prettier --check shared/service-restart-guard.ts container/agent-runner/src/index.ts tests/service-restart-guard.test.ts`
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope stayed within the allowed files.
  - Default external `cli-claw restart` remains allowed when the stricter policy is not requested.
  - The stricter policy is applied to both Claude Bash hooks and Codex ACP permission requests for IM-origin runs.
- Applied evidence:
  - Commit `Block IM agent safe restarts`.
  - Safe restart `restart-2026-04-26T06-00-46-820Z-0cfc177e` passed.
  - `/api/health` returned healthy for backend PID `78587`.
  - Post-restart process table showed only the current backend and no residual runner process.

### Milestone 20

Objective:
- Add incident-shaped mocked-message regression coverage for the Feishu "继续任务" auto-restart failure, so future fixes are validated by tests instead of relying on the user to discover regressions in real Feishu.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `shared/service-restart-guard.ts`
- `container/agent-runner/src/index.ts`
- `tests/service-restart-guard.test.ts`
- `tests/feishu-connection.test.ts`

Validation:
- `npm test -- --run tests/service-restart-guard.test.ts tests/feishu-connection.test.ts`
- `npm run typecheck`
- `npm --prefix container/agent-runner run build:runner`
- `git diff --check`
- `./scripts/review.sh`
- `npx prettier --check shared/service-restart-guard.ts container/agent-runner/src/index.ts tests/service-restart-guard.test.ts tests/feishu-connection.test.ts`
- Manual review against `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- This milestone is explicitly test-shape hardening for the 2026-04-26 incident. It should not add new runtime behavior beyond extracting the existing agent-runner restart policy into a testable shared helper.
- The mocked-message coverage should prove a Feishu `继续任务 -` message is stored/queued as a normal message and does not trigger `onCommand('self-restart')`.
- The runner-policy coverage should prove the same Feishu-origin turn cannot execute `cli-claw restart` or `bun src/cli.ts restart` through agent tools, while Web-origin explicit safe restart remains allowed.
- Validation passed on 2026-04-26 with:
  - `npm test -- --run tests/service-restart-guard.test.ts tests/feishu-connection.test.ts`
  - `npm run typecheck`
  - `npm --prefix container/agent-runner run build:runner`
  - `git diff --check`
  - `npx prettier --check shared/service-restart-guard.ts container/agent-runner/src/index.ts tests/service-restart-guard.test.ts tests/feishu-connection.test.ts`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`: scope stayed within Milestone 20, both incident-shaped tests are present, no public protocol docs were required, and no blocking regression risk was found.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 20

Current status:
- done; pending commit and safe restart application

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `shared/service-restart-guard.ts`
- `container/agent-runner/src/index.ts`
- `tests/service-restart-guard.test.ts`
- `tests/feishu-connection.test.ts`

Last failure summary:
- No current validation or review failures. Milestone 20 validation and review passed.

Suspected cause:
- Previous validations covered pieces of the fix but not the incident-shaped Feishu message path; regressions can slip through if tests do not model the real "Feishu continuation message plus attempted runner restart" flow.

Next step:
- Commit Milestone 20, then apply via the safe `cli-claw restart` path and record restart evidence.
