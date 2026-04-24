# Feishu Afternoon No-Reply Incident

## Goal

- Identify the concrete root cause behind the 2026-04-24 afternoon Feishu no-reply incident and ship the smallest production fix.
- Preserve the existing Feishu restart/recovery protections while closing any newly observed reply-loss path.

## Done when

- The afternoon timeline is reconstructed from local service state, logs, DB, and relevant source paths.
- The root cause is represented by a focused regression test or an equivalent deterministic check.
- The production fix is implemented, validated, reviewed, committed, and applied through the safe restart path if it affects the running service.

## Milestones

### Milestone 1

Objective:
- Gather evidence for the afternoon Feishu no-reply window, identify the failing chain, and update the implementation scope before editing production code.

Allowed scope:
- `PLANS/ACTIVE.md`
- read-only inspection of `~/.cli-claw/**`, logs, database snapshots, recent git history, Feishu routing code, queue/recovery code, and tests

Validation:
- Produce a concrete timeline with source evidence.
- Name the suspected root-cause code path and the regression coverage needed.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Current production service is running `d00d3b6` from `/Users/ryan/projects/cli-claw`; restart at `2026-04-24T10:04:13Z` passed and Feishu WebSocket/backfill were healthy.
- The no-reply Feishu messages were stored at `2026-04-24T10:20:40Z` and `2026-04-24T10:26:13Z`; no Feishu assistant reply exists after `2026-04-24T09:46:04Z`.
- Router state shows Feishu `last_agent_timestamp` advanced to `2026-04-24T10:26:13.402Z`, but `last_committed_cursor` remained at `2026-04-24T09:38:44.594Z`, proving the message was accepted/injected but never committed by a successful Feishu-visible turn.
- Logs show the `2026-04-24T10:26:13Z` Feishu message was IPC-injected while a `web:main` autopilot runner was active; the runner failed at `2026-04-24T10:29:29Z` with unconsumed IPC sources `["web:main","feishu:..."]`, then the due autopilot immediately relaunched `web:main` at `2026-04-24T10:30:16Z` with `directImReply:false`.
- Root cause: queue ordering only considered in-memory waiting IM siblings. If the recovered Feishu source fell out of waiting state while its DB cursor stayed uncommitted, recurring `web:main` autopilot could consume the next shared-runner slot and leave Feishu silent.

### Milestone 2

Objective:
- Implement the smallest fix and focused regression coverage for the confirmed Feishu reply-loss path.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/group-queue.ts`
- `src/index.ts`
- `tests/group-queue.test.ts`
- `PLANS/ROADMAP.md` if a follow-up risk remains after validation

Validation:
- `npm test -- tests/group-queue.test.ts`
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
- Fix should prioritize uncommitted IM sibling user messages over recurring web/autopilot work without blocking normal web work when no IM backlog exists.
- Fix implemented:
  - `GroupQueue` can now promote a DB-pending IM sibling before launching `web:*` work and rejects web-originated IPC while an uncommitted IM sibling is waiting.
  - `index.ts` resolves pending IM siblings by comparing `last_agent_timestamp` and `last_committed_cursor`, then confirming user messages still exist after the committed cursor.
  - `tests/group-queue.test.ts` covers the lost waiting-state/autopilot reentry case that matched the production timeline.
- Validation evidence:
  - `npm test -- tests/group-queue.test.ts`
  - `npm test -- tests/restart-recovery.test.ts` (passes; existing `MaxListenersExceededWarning` emitted by broader test harness)
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Review result:
  - passed local semantic review against `RUNBOOKS/Review.md`; scope stayed inside the milestone, no owner-doc update was required, and the remaining Feishu outbound-delivery risks were recorded in `PLANS/ROADMAP.md`.
- Separate outbound-delivery hardening risks found by subagent remain out of scope for this incident fix.

### Milestone 3

Objective:
- Remove the live runtime configuration blocker that still prevents the recovered Feishu turn from producing a reply after the queue fix.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- operational SQLite update for `registered_groups.model` on the effective `main` workspace
- safe restart and read-only post-restart verification

Validation:
- Confirm current model failure from logs/process/config evidence.
- Set the effective `main` workspace Codex model to a listed available model.
- Apply through `bun src/cli.ts restart`.
- Confirm the recovered Feishu turn starts with `directImReply:true` and no longer uses `model="gpt-5.5"`.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- `~/.codex/config.toml` currently sets `model = "gpt-5.5"`, while `~/.codex/models_cache.json` does not list that model. Because `web:main` had no explicit model, Feishu inherited an unavailable Codex model and the runner launched with `-c model="gpt-5.5"`.
- Used an explicit workspace model override instead of editing the user's global Codex config: `web:main` now has `model='gpt-5.4'` and `reasoning_effort='xhigh'`.
- Safe restarts passed:
  - `restart-2026-04-24T13-04-42-281Z-69725c7d.json` applied the queue fix and reproduced the model-layer blocker.
  - `restart-2026-04-24T13-06-51-753Z-72dec64b.json` applied the `gpt-5.4` workspace override.
  - `restart-2026-04-24T13-09-05-657Z-43da8e48.json` re-drove the uncommitted Feishu messages after resetting the incident cursor to the pre-incident value.
- Final recovery evidence:
  - Feishu recovery launched with `directImReply:true`.
  - Active process used `codex-acp -c model="gpt-5.4" -c model_reasoning_effort="xhigh"`.
  - The recovered Feishu-visible reply was sent at `2026-04-24T13:12:05.355Z` with `sendToIM:true`.
  - The Feishu assistant row is `sdk_final` / `completed` at `2026-04-24T13:12:05.354Z`.
  - Feishu `last_committed_cursor` advanced to the incident message cursor `2026-04-24T10:26:13.402Z`.
- A later, separate Feishu `/hkipo` message arrived at `2026-04-24T13:13:23.528Z` and is now the active turn; it is not the original no-reply incident.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- none

Current status:
- Incident fix is implemented, validated, reviewed, safe-restarted, and production recovery has sent the previously missing Feishu-visible reply.

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/group-queue.ts`
- `src/index.ts`
- `tests/group-queue.test.ts`

Last failure summary:
- Feishu messages at `2026-04-24T10:20:40Z` and `2026-04-24T10:26:13Z` were stored but never received a Feishu-visible assistant reply until recovery was re-driven after the fix. After recovery, the Feishu reply was sent at `2026-04-24T13:12:05.355Z` and the committed cursor advanced to `2026-04-24T10:26:13.402Z`.

Suspected cause:
- Confirmed root causes are:
  - recurring `web:main` autopilot work winning the shared main-runner slot after Feishu IPC recovery advanced `last_agent_timestamp` but left `last_committed_cursor` behind.
  - `web:main` inheriting unavailable `gpt-5.5` from global Codex config, causing recovered Feishu runner startup to fail at the model layer.

Next step:
- Commit the incident fix. Follow-up hardening remains in `PLANS/ROADMAP.md` for Feishu outbound delivery failures and inherited Codex model validation.
