# Active Task: Scheduled Agent Runtime Failure Classification

## Current Goal

- Prevent Cli Claw scheduled agent tasks from reporting runtime setup/auth failures as successful task runs.
- Keep the stock handoff chain safe: if the scheduled agent cannot start or authenticate, the stock handoff must remain pending/unclaimed, but the task run log should show an actionable error instead of `success`.
- Preserve once-task behavior: the task may complete/stop after one attempt, but its `last_result` and task_run_logs must make the failure visible to the operator.

## Current Milestone

Objective:
- Add a regression for host scheduled agent tasks whose runtime returns a login/setup failure as a textual result.
- Classify those runtime-failure results as task errors in `task_run_logs` and `last_result`.
- Record the real stock handoff probe outcome and next operator step.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/task-scheduler.ts`
- `tests/task-scheduler-host-cwd.test.ts`
- Owner docs only if a durable scheduler/runtime contract changes.

Validation:
- Reproduce the failing scheduler regression before implementation.
- `npm test -- tests/task-scheduler-host-cwd.test.ts`
- `npm run typecheck:backend`
- `./scripts/review.sh`
- `git diff --check`

Status:
- done

Validation status:
- passed 2026-05-16:
  - Reproduced the failing scheduler regression with `npm test -- tests/task-scheduler-host-cwd.test.ts`: a host agent result `Not logged in · Please run /login` was logged as `status='success'`.
  - `npm test -- tests/task-scheduler-host-cwd.test.ts`: passed, 4 tests.
  - `npm run typecheck:backend`: passed.
  - `./scripts/review.sh`: passed mechanical checks and confirmed semantic review is required before marking done.
  - `git diff --check`: passed.

Review status:
- passed 2026-05-16:
  - Scope check: edits stay within the active milestone scope.
  - Objective check: scheduled agent textual login/setup failures are now classified as task errors; the run log keeps the raw result and stores an actionable error message.
  - Pattern-fit check: the fix stays in `runTask()` classification logic and reuses existing runtime-error formatting instead of changing runner/process lifecycle semantics.
  - Test and validation check: focused scheduler regression, backend typecheck, mechanical review, and whitespace diff check passed.
  - Hygiene check: no placeholder markers, debug logging, or temporary code found in the changed milestone files.
  - Docs check: no owner-doc contract changed; roadmap is updated with the real probe and runtime-failure classification progress.
  - Regression/contract check: script tasks and normal agent successes are unchanged; only scheduled agent outputs with explicit runtime-error finalization or exact Codex login text become task errors.

## Notes

- P2 bridge was committed in `cb45a99` and the no-op real bridge run was recorded in `5a6c491`.
- Manual probe generated stock handoff `7a966070-7522-4eb1-90c4-a41682bf3fa1` and bridge created Cli Claw task `stock-handoff-7a966070-7522-4eb1-90c4-a41682bf3fa1`.
- Scheduler attempted the task twice and logged `success` with result `Not logged in · Please run /login`; stock handoff stayed `pending` and unclaimed. This is a scheduler/runtime classification problem, not a bridge insertion problem.

## Handoff

Current milestone:
- P3 scheduled agent runtime-failure visibility

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/task-scheduler.ts`
- `tests/task-scheduler-host-cwd.test.ts`

Last failure summary:
- Real scheduled agent task logs show `success` even though the only result is `Not logged in · Please run /login`; the stock handoff remains `pending` with no owner or lease.

Suspected cause:
- `runTask()` currently treats `ContainerOutput.status='success'` with textual runtime errors as success; Codex ACP can surface login failures as final text rather than process errors.

Next step:
- Restart Cli Claw so the scheduler picks up the fix, then retry or requeue the stock handoff task after Codex login is available.
