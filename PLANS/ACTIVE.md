# Workspace Autopilot Backoff

## Goal

- Stop workspace autopilot from repeatedly consuming long Codex runs when recent autopilot turns are timing out or crashing.
- Keep normal autopilot behavior unchanged after successful/no-op runs.
- Add focused regression coverage for timeout/error backoff scheduling.

## Done when

- Consecutive failed autopilot runs schedule the next run with an exponential backoff instead of the fixed 5-minute interval.
- A successful autopilot run resets the failure streak back to the normal interval.
- Related tests, typecheck, diff hygiene, and review pass.

## Milestones

### Milestone 1

Objective:
- Add failure-aware workspace autopilot backoff and regression tests.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/task-scheduler.ts`
- `tests/workspace-autopilot.test.ts` or adjacent scheduler tests

Validation:
- `npm test -- --run tests/workspace-autopilot.test.ts tests/group-queue.test.ts tests/task-scheduler-host-cwd.test.ts`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Live evidence from `~/.cli-claw/db/messages.db`: recent `autopilot:workspace:main` runs repeatedly ended with `Host Agent timed out after 1800000ms` or `Process crashed before completion`.
- Current task remains active; this milestone changes future scheduling behavior only and should not kill running agents directly.
- Keep scope limited to backoff; do not redesign autopilot prompting or session behavior in this milestone.
- Implemented consecutive-error exponential backoff for workspace autopilot interval tasks, capped at 6h.
- Successful/no-op runs continue using the normal interval and therefore reset the failure streak.
- Validation passed:
  - `npm test -- --run tests/workspace-autopilot.test.ts tests/group-queue.test.ts tests/task-scheduler-host-cwd.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
  - `npm run build`
- Review gate passed against `RUNBOOKS/Review.md`; no public command/runtime contract docs needed.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 1

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/task-scheduler.ts`
- `tests/task-scheduler-host-cwd.test.ts`

Next step:
- Commit and apply through the safe restart path; then continue monitoring autopilot task run logs.
