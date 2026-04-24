# Feishu IM Recovery Chain

## Goal

- Fix the reply-loss chain behind "service restarted and Feishu still does not reply", including both the startup late-bound streaming-session gap and the shared-runner queue path that can let `web:main` reclaim recovery ahead of the pending IM turn.
- Ensure a pending direct IM turn keeps visible progress and terminal delivery across restart, timeout, and sibling web/autopilot contention in the shared `main` serialization key.

## Done when

- We have a focused failing regression test for late-bound IM streaming-session recovery and a focused failing regression test for IM priority during shared-runner recovery/drain.
- The minimal production fixes keep restart-recovered IM turns visible after channel reconnect and prevent sibling web/autopilot work from reclaiming recovery before the pending IM turn.
- Validation and review pass for the scoped change.

## Milestones

### Milestone 1

Objective:
- Add a regression test for late-bound IM streaming session recovery and implement the smallest fix in the main startup-recovery path (plus the matching conversation-agent path if the same helper is shared).

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/index.ts`
- `tests/restart-recovery.test.ts`

Validation:
- `npm test -- tests/restart-recovery.test.ts`
- `npm run typecheck`
- `./scripts/review.sh`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Evidence gathered on 2026-04-24 before implementation:
  - `router_state.active_streaming_turns` still contains `feishu:oc_98f0bb60f284627bf20f9386704f8c82` with cursor `2026-04-24T09:06:33.321Z`, while `last_committed_cursor` for that chat is still `2026-04-24T09:06:20.752Z`.
  - startup log shows `recoverPendingMessages()` dispatching the Feishu turn at `2026-04-24T09:13:58.844Z`, before Feishu reconnect finishes at `2026-04-24T09:14:00.465Z`.
  - `IMConnectionManager.createStreamingSession()` returns `undefined` when the channel is unavailable, and `processGroupMessages()` / `processAgentConversation()` currently only try to create the Feishu streaming session eagerly.
  - historical host log `host-2026-04-24T09-06-27-141Z.log` shows a long-running Feishu recovery turn with stream/tool events and terminal `success` + `result:null`; without a live streaming session, that path has no visible IM fallback.
- Root cause hypothesis:
  - A recovered IM turn can start while Feishu is still disconnected, so no streaming card/session is created.
  - After Feishu reconnects, the running turn never retries session creation, so subsequent tool progress and silent terminal completion remain invisible to IM.
- Fix implemented:
  - added `ensureLateBoundStreamingSession()` so an IM streaming session can be created later, once the target channel becomes available, without changing normal web-only behavior.
  - wired the helper into `processGroupMessages()` and `processAgentConversation()` for stream-event delivery, interruption handling, final completion, route rebuilds, and partial-output card rebuilds.
  - kept `finally` cleanup on existing sessions only, so a post-result reconnect cannot create and finalize an empty Feishu card after a static IM reply has already been sent.
- Validation evidence:
  - `npm test -- tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Review result:
  - passed local semantic review against `RUNBOOKS/Review.md`; scope stayed within the plan, objective coverage matches the startup-recovery defect, and no additional doc-owner updates were required.
- Scope guard:
- Do not widen into queue ordering, cursor semantics, or outbound message contract changes unless the late-bind fix proves insufficient and this plan is updated first.

### Milestone 2

Objective:
- Reproduce the shared-runner recovery path where pending web/autopilot work can be drained before the sibling IM turn after runner exit, then implement the smallest queue-ordering fix that preserves IM priority.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/group-queue.ts`
- `tests/group-queue.test.ts`

Validation:
- `npm test -- tests/group-queue.test.ts tests/restart-recovery.test.ts`
- `npm run typecheck`
- `./scripts/review.sh`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- New evidence gathered on 2026-04-24 after Milestone 1:
  - Feishu message DB shows the user message at `2026-04-24T08:02:54Z` was stored, while the same chat later only recorded assistant `interrupt_partial` at `2026-04-24T08:42:29.339Z` and `2026-04-24T09:06:27.509Z`.
  - launchd stdout shows a long-running Feishu private-chat runner timing out at `2026-04-24T08:42:28.930Z`, immediately followed by `Unconsumed IPC messages found after agent exit, preserving injected source chats`, then prompt recovery / processing on `web:main`.
  - the later restart at `2026-04-24T08:48:45Z` still hit the Milestone 1 late-bind bug, so the observed outage window is a stacked failure rather than one isolated defect.
- Root cause hypothesis:
  - queue recovery already protects some IM-first paths in `drainGroup()`, but `drainWaiting()` still iterates raw waiting-set order and can let `web:main` launch before a pending IM sibling under the same serialization key.
  - once `web:main` re-enters first, the visible IM reply path is lost even though the underlying work continues.
- Fix implemented:
  - added `shouldDeferWebWaitingCandidate()` so waiting `web:*` work is only deprioritized when there is a waiting IM sibling on the same serialization key.
  - updated `drainWaiting()` to drain non-deferred candidates first, preserving existing queue behavior for unrelated groups while letting the IM sibling win the next free slot.
  - added a regression test that fills host capacity with an unrelated runner, queues `web:main` before Feishu, and proves the freed slot now launches the Feishu sibling first.
- Validation evidence:
  - `npm test -- tests/group-queue.test.ts tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Review result:
  - passed local semantic review; the queue change is narrowly scoped to waiting-order selection, preserves queued web work instead of dropping it, and matches the observed IM-first recovery requirement.
- Residual risk:
  - combined test runs still emit `MaxListenersExceededWarning` from the broader test harness; this does not fail the current suite and was left out of scope for this bugfix chain.
- Scope guard:
  - Keep this milestone inside queue ordering and regression coverage; do not reopen the Feishu session-creation code unless the new test disproves the queue hypothesis.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 2

Current status:
- Milestone 1 and Milestone 2 are both implemented, validated, and locally reviewed; the remaining execution step is commit plus safe restart apply

Changed files:
- `PLANS/ACTIVE.md`
- `src/group-queue.ts`
- `src/index.ts`
- `tests/group-queue.test.ts`
- `tests/restart-recovery.test.ts`

Last failure summary:
- The user-visible outage window contained two stacked failures: an older Feishu runner timed out and drifted recovery onto `web:main`, then a later restart re-dispatched the pending IM turn before Feishu reconnect finished.

Suspected cause:
- Milestone 1 fixed: startup recovery eagerly created the Feishu streaming session once, during the pre-connection window, and never retried after the channel became available.
- Milestone 2 fixed: shared-runner waiting/drain order allowed sibling `web:main` work to restart before the pending IM sibling after runner exit.

Next step:
- Commit the combined recovery-chain fix and apply it through the documented safe restart path so the running service picks up both protections.
