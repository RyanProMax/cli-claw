# Active Task: Scheduled Agent Runtime Failure Classification

## Current Goal

- Prevent Cli Claw scheduled agent tasks from reporting runtime setup/auth failures as successful task runs.
- Keep the stock handoff chain safe: if the scheduled agent cannot start or authenticate, the stock handoff must remain pending/unclaimed, but the task run log should show an actionable error instead of `success`.
- Preserve once-task behavior: the task may complete/stop after one attempt, its `last_result` and task_run_logs must make the failure visible to the operator, and it must not be re-enqueued while the first run is still finalizing.

## Current Milestone

Objective:
- Add a regression for host scheduled agent tasks whose runtime returns a login/setup failure as a textual result.
- Classify those runtime-failure results as task errors in `task_run_logs` and `last_result`.
- Finalize the `scheduled_tasks` row as soon as terminal output finalizes the run log, while still keeping the task in `runningTaskIds` until the agent process exits.
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
  - After the first fix and restart, a real retry logged the Codex login result as `error`, but also exposed that `runningTaskIds` is cleared before once-task finalization, allowing the due task to be re-enqueued while the first run is still closing.
  - Reproduced the early-running-guard/finalization failure with `npm test -- tests/task-scheduler-host-cwd.test.ts`: terminal output finalized the run log before the scheduled task row was updated, and `getRunningTaskIds()` was already empty.
  - `npm test -- tests/task-scheduler-host-cwd.test.ts`: passed, 5 tests.
  - `npm run typecheck:backend`: passed.
  - `./scripts/review.sh`: passed mechanical checks and confirmed semantic review is required before marking done.
  - `git diff --check`: passed.
  - Live retry after restart: latest `stock-handoff-7a966070-7522-4eb1-90c4-a41682bf3fa1` run logged `status=error` with `Codex CLI 未登录。请先在服务器上执行：codex login`; `scheduled_tasks.status=completed`, `next_run=NULL`, and no additional run appeared in the next scheduler cycle.

Review status:
- passed 2026-05-16:
  - Scope check: edits stay within the active milestone scope.
  - Objective check: scheduled agent textual login/setup failures are now classified as task errors; terminal output finalizes both the run log and scheduled task row; tasks stay in `runningTaskIds` until the agent process exits.
  - Pattern-fit check: the fix stays inside scheduler bookkeeping/classification logic and reuses existing runtime-error formatting.
  - Test and validation check: focused scheduler regression, backend typecheck, mechanical review, and whitespace diff check passed.
  - Hygiene check: no placeholder markers, debug logging, or temporary code found in the changed milestone files.
  - Docs check: no owner-doc contract changed; roadmap is updated with the real probe and scheduler guard progress.
  - Regression/contract check: script tasks and normal agent successes are unchanged; once-task duplicate enqueue is reduced by finalizing the task row promptly and keeping the running guard until process exit.

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
- Real scheduled agent task first logged `success` for `Not logged in · Please run /login`; after the first fix it logged `error`, but the same once task was still re-enqueued once more before `scheduled_tasks` reached `completed`.

Suspected cause:
- `runTask()` previously treated `ContainerOutput.status='success'` with textual runtime errors as success, and `finalizeRunLog()` also cleared `runningTaskIds` before `updateTaskAfterRun()`.

Next step:
- Fix the scheduled-task workspace Codex login/readiness issue, then retry or requeue the pending stock handoff so the agent can claim it and write the KOL report through `handoff complete`.
