# Workspace Autopilot Low-Priority Background Runs

## Goal

- Stop workspace autopilot from repeatedly injecting `[WORKSPACE_AUTOPILOT]` as normal user-visible chat history.
- Make autopilot low priority, deduplicated, and aware of real user / IM work before it consumes Codex.
- Preserve existing `/autopilot on|off|status` behavior and quota pause semantics.

## Done when

- Scheduler does not write autopilot prompts into `messages` as ordinary user messages.
- Autopilot skips or defers when the workspace has active/pending real work, especially Feishu/IM messages.
- User/IM messages are prioritized ahead of autopilot in `GroupQueue`.
- Tests cover no message pollution, queue priority, and IM/user preemption boundaries.
- Docs, validation, review, safe restart, and commit are complete.

## Milestones

### Milestone 1

Objective:
- Lock the implementation contract for autopilot scheduling, queue priority, and visibility.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- read-only inspection of `src/workspace-autopilot.ts`, `src/task-scheduler.ts`, `src/group-queue.ts`, `src/index.ts`, `src/web.ts`, related tests, and docs.

Validation:
- Identify exact code paths to change.
- Define the minimal test set for the behavior contract.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Current issue: `runGroupModeTask()` stores autopilot prompt as a user message in `web:main` every 5 minutes, then enqueues normal message processing.
- Code paths:
  - `src/workspace-autopilot.ts` owns task ID, prompt, quota state.
  - `src/task-scheduler.ts` currently handles all group-context tasks by `storePromptMessage()` + `enqueueMessageCheck()`.
  - `src/group-queue.ts` currently prioritizes pending tasks over pending messages during drain.
  - `src/index.ts` wires `storePromptMessage` and queue callbacks.
- Target contract:
  - autopilot is a background task, not a normal user message;
  - autopilot is skipped when active/pending user or IM work exists;
  - queued user/IM messages outrank queued autopilot work;
  - no-op/skip should update task run logs without user-visible output.
- Minimal test set:
  - task scheduler autopilot run does not call `storePromptMessage`;
  - no-op autopilot result is not sent to user;
  - substantive autopilot result is sent as a scheduled-task message;
  - background queued task drains after pending messages.

### Milestone 2

Objective:
- Implement low-priority background autopilot execution and queue priority behavior.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/workspace-autopilot.ts`
- `src/task-scheduler.ts`
- `src/group-queue.ts`
- `src/index.ts`
- `src/web.ts` only if required to mark user/IM priority boundaries
- `docs/COMMAND.md`
- `docs/ARCHITECTURE.md`
- `docs/MODULE.md`
- directly related tests

Validation:
- `npm test -- --run tests/workspace-autopilot.test.ts tests/group-queue.test.ts tests/task-scheduler-host-cwd.test.ts`
- Add/adjust focused tests that fail on the old behavior.
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
- Avoid broad queue rewrites. Use the smallest priority extension needed for autopilot.
- Preserve existing task and agent conversation behavior.
- Implemented:
  - `GroupQueue.enqueueTask()` accepts `priority: 'background'`.
  - Pending messages drain before background tasks.
  - User messages close active background tasks via `_close`, but ordinary scheduled tasks keep existing behavior.
  - Workspace autopilot runs through `runWorkspaceAutopilotTask()` without calling `storePromptMessage()`.
  - Autopilot prompt uses recent workspace context as hidden prompt input; no-op results are logged but not sent.
  - Scheduler skips due autopilot ticks when pending IM sibling or active/pending workspace work exists.
- Validation evidence:
  - `npm test -- --run tests/workspace-autopilot.test.ts tests/group-queue.test.ts tests/task-scheduler-host-cwd.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review result:
  - passed semantic review against `RUNBOOKS/Review.md`; no blocking scope, priority, or ordinary task regression found.

### Milestone 3

Objective:
- Update docs, apply the fix to the running service, and record final handoff.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `docs/ARCHITECTURE.md`
- `docs/MODULE.md` only if module ownership wording needs adjustment
- safe restart via `bun src/cli.ts restart`
- read-only post-restart status/log checks

Validation:
- Docs reflect the new autopilot contract.
- Safe restart passes and IM channels reconnect.
- Unverified live behavior is called out explicitly.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- If route/runtime code changes after restart, rerun safe restart before final handoff.
- Docs updated:
  - `docs/COMMAND.md`
  - `docs/ARCHITECTURE.md`
  - `docs/MODULE.md`
- Safe restart `restart-2026-04-24T14-41-19-260Z-c027f9a3` passed.
- Post-restart backend PID is `92746`; `/api/health` is healthy and `active_streaming_turns` is `{}`.
- Feishu and WeChat channels reconnected after restart. Feishu startup backfill logged one existing 400 response but completed and connected.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 3

Current status:
- Done. Workspace autopilot now runs as low-priority background work instead of injecting ordinary chat messages, and real user/IM messages take priority.

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `src/group-queue.ts`
- `src/task-scheduler.ts`
- `src/workspace-autopilot.ts`
- `tests/group-queue.test.ts`
- `tests/task-scheduler-host-cwd.test.ts`

Last failure summary:
- None after validation. Focused tests, typecheck, diff hygiene, review script, and semantic review passed.

Suspected cause:
- The scheduler treats workspace autopilot as a group-context scheduled task implemented by ordinary message injection rather than as a low-priority background run with preflight gates.

Next step:
- Commit the focused fix, then monitor the next scheduled autopilot tick in real usage.
