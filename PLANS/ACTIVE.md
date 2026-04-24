# Safe Restart Reply Recovery

## Goal

- Reproduce why a safe restart or runner handoff can leave IM users with only an interrupted partial and no follow-up reply.
- Add focused regression coverage for the shared-runner recovery path before changing production behavior.

## Done when

- We can point to the exact recovery path that loses IM continuity after safe restart / shared-runner exit.
- A failing test captures the current bad behavior.
- The fix restores IM reply continuity without widening scope beyond queue / restart recovery.

## Milestones

### Milestone 1

Objective:
- Reproduce the leak and capture it with the smallest failing test.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `src/feishu.ts`
- `src/feishu-streaming-card.ts`
- `src/reply-visibility.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/reply-visibility.test.ts`
- `tests/restart-recovery.test.ts`

Validation:
- `npm test -- tests/reply-visibility.test.ts tests/feishu-streaming-card.test.ts tests/restart-recovery.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- The previous terminal-state fix intentionally preserves existing card content; the remaining question is whether that preserved content should ever include internal execution panels for Feishu end users.
- Root cause confirmed: success cleanup paths call `completeWithCurrentText()`, which previously dropped commentary but preserved tool-step panels, so a completed Feishu card could still expose internal steps when there was no replacement final reply.
- Fresh evidence:
  - `npm test -- tests/feishu-streaming-card.test.ts`
  - `npm test -- tests/reply-visibility.test.ts tests/feishu-streaming-card.test.ts tests/restart-recovery.test.ts`
  - `git diff --check`

### Milestone 2

Objective:
- Implement the minimal recovery fix for IM reply continuity after shared-runner exit / safe restart, validate it, and update the roadmap status.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/group-queue.ts`
- `src/index.ts`
- `tests/restart-recovery.test.ts`
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
- Keep the fix narrow: preserve existing shared-runner serialization while ensuring unconsumed IPC recovery re-enqueues the originating IM chat, not just the owner runner JID.
- Root cause confirmed on 2026-04-24: a Feishu IM message can be IPC-injected into the active `web:main` runner, advance `lastAgentTimestamp` for the Feishu chat, then get stranded when the shared runner exits before consuming the IPC file. `recoverUnconsumedIpc()` currently marks only the active runner JID (`web:main`) as pending, so the restart/rerun processes the wrong chat and the IM message never gets its follow-up reply.
- Restart-specific follow-up root cause confirmed on 2026-04-24: startup recovery uses `lastCommittedCursor` to detect the pending Feishu turn, but `processGroupMessages()` still reads from `lastAgentTimestamp`, so the recovered run can no-op even after `recoverPendingMessages()` correctly flags the chat for retry.
- Fresh evidence:
  - `~/.cli-claw/ops/launchd/cli-claw.stdout.log` at `2026-04-24T06:44:55Z` shows the Feishu message stored, but the first drain/requeue was triggered later by `autopilot:workspace:main`, not by the IM message itself.
  - `router_state.last_agent_timestamp` already advanced Feishu to `2026-04-24T06:44:55.553Z`, while `last_committed_cursor` for the same chat was still `2026-04-24T05:37:35.279Z`, proving the IM message was accepted for IPC but never committed.
- Validation evidence:
  - `npm test -- tests/group-queue.test.ts tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Implementation result:
  - Shared-runner exit now tracks the actual IPC source JIDs and re-enqueues those chats for safety re-check instead of blindly requeueing `web:main`.
  - Startup recovery now replays from `last_committed_cursor` when a chat is flagged for recovery, so a restart can actually pick up the stranded IM turn.
- Residual note:
  - `src/feishu-streaming-card.ts` and `tests/feishu-streaming-card.test.ts` remain dirty from the separate outbound-contract roadmap item and must stay out of this milestone's commit.

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
- validation/review passed

Changed files:
- `PLANS/ACTIVE.md`
- `src/group-queue.ts`
- `src/index.ts`
- `tests/group-queue.test.ts`
- `tests/restart-recovery.test.ts`

Last failure summary:
- none after the final validation round

Suspected cause:
- fixed: recovery now preserves the originating IPC source JIDs and startup replay now reads from `lastCommittedCursor` for recovery chats.

Next step:
- Commit the scoped recovery fix and apply it through the safe restart path, then monitor real IM traffic for regressions.
