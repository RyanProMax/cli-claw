# Feishu Post-Restart Reply Stall

## Goal

- Reproduce and fix the regression where Feishu user messages sent after a service restart are stored but do not receive an assistant reply.
- Confirm the root cause in the post-restart consumption path instead of assuming a startup backfill gap.

## Done when

- We have a focused failing test that proves the affected Feishu messages remain unconsumed because of a restart/recovery state bug in the main processing path.
- The smallest production fix restores reply delivery for the affected post-restart Feishu messages without breaking existing restart/backfill behavior.
- Validation and review pass for the scoped change.

## Milestones

### Milestone 1

Objective:
- Capture the confirmed post-restart Feishu reply stall in tests and implement the minimal fix in the pending-message / recovery path.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/index.ts`
- `src/feishu.ts`
- `src/message-notifier.ts`
- `src/group-queue.ts`
- `tests/restart-recovery.test.ts`
- `tests/group-queue.test.ts`
- `tests/feishu-connection.test.ts`

Validation:
- `npm test -- --run tests/restart-recovery.test.ts tests/group-queue.test.ts tests/feishu-connection.test.ts`
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
  - chat `feishu:oc_98f0bb60f284627bf20f9386704f8c82` is already present in `registered_groups`, so this regression is not explained by missing startup backfill targets
  - restart record `~/.cli-claw/ops/restarts/restart-2026-04-24T07-47-40-722Z-97405a3e.json` shows the new process was healthy by `2026-04-24T07:47:47.557Z`
  - user messages at `2026-04-24T07:49:24.564Z` and `2026-04-24T08:00:45.023Z` were stored in `messages`, but no matching assistant reply was produced afterward
  - the latest assistant outputs in the affected chat around restart are `interrupt_partial`, which narrowed the investigation to restart/recovery queue state instead of Feishu ingress
- Confirmed root cause:
  - restart recovery can leave a shared runner active for the workspace while new Feishu IM messages continue arriving
  - `startMessageLoop()` treats a successful IPC write as handled work, advances `lastAgentTimestamp`, and marks the source chat via `queue.markIpcInjectedMessage(chatJid)`
  - `GroupQueue.getStuckPendingGroups()` only looked at `pendingMessages`, so IPC-injected work did not count as pending and the stuck-runner watchdog never restarted the idle/hung shared runner
- Fix implemented:
  - `GroupQueue.getStuckPendingGroups()` now treats `hasIpcInjectedMessages` and `ipcInjectedMessageJids` as pending work, matching the existing exit-time requeue semantics for IPC-injected chats
  - added a regression test that covers a shared runner receiving IPC-injected work from a sibling Feishu chat
- Validation evidence:
  - `npm test -- --run tests/restart-recovery.test.ts tests/group-queue.test.ts tests/feishu-connection.test.ts`
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Review result:
  - passed local semantic review; the change does not widen the watchdog beyond already-active shared message runners, and `activeRunnerIsTask` plus the existing idle threshold remain intact
- Out of scope for this milestone:
  - `/model` discovery alignment
  - unrelated Feishu card layout/contract work unless the confirmed fix requires touching that code and the plan is updated first

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 1

Current status:
- implementation, validation, and review completed

Changed files:
- `PLANS/ACTIVE.md`
- `src/group-queue.ts`
- `tests/group-queue.test.ts`

Last failure summary:
- After restart, Feishu user messages are persisted for the affected chat, but the main assistant pipeline does not produce a reply.

Suspected cause:
- Fixed: the stuck-runner watchdog ignored IPC-injected work, so post-restart Feishu messages could sit behind an idle shared runner with no restart trigger.

Next step:
- Commit the scoped fix and apply it through the safe restart path so the next post-restart Feishu message exercises the corrected watchdog behavior.
