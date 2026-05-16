# Active Task: Stock Handoff Scheduled-Agent Bridge

## Current Goal

- Add a bounded bridge that turns `stock-analysis-api` pending agent handoffs into Cli Claw one-shot scheduled agent tasks.
- Keep the bridge idempotent and operator-safe: it must not claim stock handoffs itself, must not run broker / registry approval commands, and must make the scheduled agent use the P1b owner / lease / hash `claim <id> -> complete/fail` contract.
- Preserve Cli Claw scheduler boundaries: bridge only creates `execution_type=agent`, `schedule_type=once` tasks; actual execution stays in the existing scheduler / `runTask` path.

## Current Milestone

Objective:
- Implement the smallest bridge runner that reads stock handoffs from a stock SQLite DB or exported JSON fixture and inserts missing Cli Claw once-agent scheduled tasks with deterministic IDs and safe prompts.

Allowed scope:
- `scripts/stock-handoff-agent-bridge.mjs`
- `tests/stock-handoff-agent-bridge.test.ts`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- Owner docs only if a durable Cli Claw contract changes.

Validation:
- Reproduce a failing focused bridge test before implementation.
- `npm test -- tests/stock-handoff-agent-bridge.test.ts`
- Related scheduler regression if needed: `npm test -- tests/task-scheduler-host-cwd.test.ts`
- `npm run typecheck:backend`
- `./scripts/review.sh`
- `git diff --check`

Status:
- done

Validation status:
- passed 2026-05-16:
  - Reproduced the pre-implementation focused failure with `npm test -- tests/stock-handoff-agent-bridge.test.ts`: the bridge module did not exist yet, so Vitest failed to import it.
  - `npm test -- tests/stock-handoff-agent-bridge.test.ts`: passed, 3 tests covering SQLite input, idempotency, and exported JSON fixture input.
  - `npm test -- tests/task-scheduler-host-cwd.test.ts`: passed, 3 tests.
  - `npm run typecheck:backend`: passed.
  - `./scripts/review.sh`: passed mechanical checks and confirmed semantic review is required before marking done.
  - `git diff --check`: passed.
  - Extra non-gating check: full `npm test` still fails in `tests/feishu-e2e.test.ts` at `does not write Codex replayed presentation text into real Feishu streaming cards for the current cursor`; focused rerun reproduces the same stale `Futu` payload assertion. This milestone does not touch Feishu files, so the failure is recorded as unrelated follow-up risk rather than a bridge blocker.

Review status:
- passed 2026-05-16:
  - Scope check: all edits stay inside the allowed milestone scope.
  - Objective check: the bridge creates deterministic `stock-handoff-<handoff_id>` once-agent tasks from pending stock handoffs, supports SQLite and JSON fixture input, and skips existing tasks idempotently.
  - Pattern-fit check: implementation follows existing scheduled task schema and `scripts/` ops-entry convention without adding a new framework or runtime path.
  - Test and validation check: focused bridge tests, scheduler host-cwd regression, backend typecheck, mechanical review, and whitespace diff check all passed.
  - Hygiene check: no placeholder markers, debug logging, or dead temporary code found in the changed milestone files.
  - Docs check: `docs/COMMAND.md` now documents the ops helper, SQLite input, JSON fixture input, and safety boundaries.
  - Regression/contract check: the bridge does not claim handoffs, run agents, approve/activate strategies, write broker state, or change scheduler execution; the scheduled agent must claim the exact handoff id and complete/fail with the P1b owner/lease/hash contract.

## Notes

- P1b is already implemented in `/Users/ryan/projects/stock-analysis-api` at commit `3c42df4`.
- Bridge must not pre-claim a stock handoff. Agent prompt must claim the exact handoff id at runtime so scheduler downtime does not strand the item and parallel handoffs do not get cross-claimed.
- Deterministic scheduled task ID should be `stock-handoff-<handoff_id>`.
- The scheduled task prompt must include the stock `handoff_id`, role, input hash, prompt text, and exact `uv run python scripts/task_chain.py ...` commands for claim / complete / fail.
- If a matching scheduled task already exists, bridge should report `skipped_existing` instead of creating a duplicate.

## Handoff

Current milestone:
- P2 bridge runner

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `scripts/stock-handoff-agent-bridge.mjs`
- `tests/stock-handoff-agent-bridge.test.ts`

Last failure summary:
- Extra full-suite attempt failed in the existing Feishu E2E stale-payload assertion:
  `tests/feishu-e2e.test.ts > does not write Codex replayed presentation text into real Feishu streaming cards for the current cursor`.
- Operational follow-up 2026-05-16: real bridge run against `/Users/ryan/projects/stock-analysis-api/.cache/task_chain.sqlite` and `~/.cli-claw/db/messages.db` returned `created=0`, `skipped_existing=0`, `ignored=0`; current stock handoff queue is empty.

Suspected cause:
- Existing Feishu presentation/current-cursor regression or fixture issue; not caused by the stock bridge diff.

Next step:
- Wait for or generate the next pending stock handoff, rerun the bridge, confirm the created Cli Claw scheduled agent task is picked up, then add execution-log sweep / retry handling for tasks that fail before calling stock `handoff fail`.
