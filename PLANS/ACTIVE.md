# Safe Restart Reply Recovery

## Goal

- Reproduce why a safe restart can still leave an IM-originated run without a visible follow-up when workspace autopilot injects `web:main` work into the same shared runner.
- Prevent workspace/web prompts from hijacking an active IM runner's reply route or forcing it to drain before the IM turn finishes.

## Done when

- A failing regression test proves `web:main` pending work does not inject into, or drain, an active sibling IM runner.
- The minimal fix keeps the web/autopilot work queued until the IM runner finishes naturally.
- Validation and review pass for the scoped change.

## Milestones

### Milestone 1

Objective:
- Capture the cross-source shared-runner regression with a failing test, implement the minimal queue guard, and verify it.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/group-queue.ts`
- `tests/group-queue.test.ts`

Validation:
- `npm test -- tests/group-queue.test.ts`
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
- Root-cause evidence from `~/.cli-claw/ops/launchd/cli-claw.stdout.log`:
  - `2026-04-24 03:04:16` restart recovery correctly re-queued `feishu:oc_98f0bb60f284627bf20f9386704f8c82`.
  - `2026-04-24 03:05:17` scheduler injected `autopilot:workspace:main` into `web:main` while the recovered Feishu runner was still active.
  - The shared runner then logged `Container closed during query without reply, keeping cursor for retry` for the Feishu chat and immediately re-queued only `web:main`, proving the web task preempted the IM turn.
  - Earlier evidence at `2026-04-23 22:58:09` shows the active Feishu run later persisted a reply with `sendToIM: false`, consistent with `replySourceImJid` being cleared by injected `web:main` work.
- Keep the fix minimal and local to queue routing; do not widen this round into `/model` discovery or WeChat `context_token` recovery.
- Validation evidence:
  - `npm test -- tests/group-queue.test.ts`
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Implementation result:
  - `enqueueMessageCheck()` no longer writes `_drain` when `web:main` work targets an active sibling IM runner.
  - `sendMessage()` now refuses to IPC-inject web/workspace work into an active IM runner, leaving that work queued until the IM turn exits naturally.
- Residual note:
  - `src/feishu-streaming-card.ts` and `tests/feishu-streaming-card.test.ts` remain dirty from the separate outbound-contract roadmap item and are intentionally outside this milestone.

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
- validation/review passed

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/group-queue.ts`
- `tests/group-queue.test.ts`

Last failure summary:
- none after validation and review

Suspected cause:
- fixed: queued `web:main` work now waits behind an active sibling IM runner instead of draining or IPC-injecting into it.

Next step:
- Commit the scoped queue guard, apply it through the safe restart path, and monitor the next real IM recovery turn.
