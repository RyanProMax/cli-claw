# Active Task: Stock Strategy Iteration Gate

## Current Goal

- Stop the stock task-chain from treating collector prechecks as completed strategy iteration input.
- Make the loop pause strategy iteration when KOL intelligence still requires an Agent-produced report, so market/news scans are not presented as a working self-iteration chain before strategy evidence exists.
- Keep the change scoped to scheduling semantics and reporting contracts; do not add public API, approve / activate strategies, or touch live trading paths.

## Current Milestone

Objective:
- Add a regression showing `kol_scan` with `agent_required` must not schedule `strategy_iteration`.
- Change task-chain scheduling so `strategy_iteration` is only queued after actionable KOL intelligence is collected and no main post-market drain task is pending.
- Update the stock-analysis docs/plan to record the new gate and current blocker.

Allowed scope:
- `/Users/ryan/projects/stock-analysis-api/src/services/task_chain_service.py`
- `/Users/ryan/projects/stock-analysis-api/tests/test_task_chain_cli.py`
- `/Users/ryan/projects/stock-analysis-api/docs/architecture.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/task-chain-worker.md`
- `/Users/ryan/projects/stock-analysis-api/docs/plan.md`
- `PLANS/ROADMAP.md`
- `PLANS/ACTIVE.md`

Validation:
- Run the focused task-chain regression test.
- Run `uv run pytest tests/test_task_chain_cli.py`.
- Run `git diff --check` in both affected repositories.
- Run the repo review helper where available.

Status:
- done

Validation status:
- passed 2026-05-16:
  - Reproduced the pre-fix failure with `uv run pytest tests/test_task_chain_cli.py::test_kol_scan_does_not_treat_assistant_prompt_as_final_report tests/test_task_chain_cli.py::test_kol_scan_with_final_report_can_trigger_strategy_iteration`: `agent_required` KOL still scheduled `strategy_iteration`.
  - Focused regression after fix: same command passed, 2 tests.
  - `uv run pytest tests/test_task_chain_cli.py`: passed, 13 tests.
  - `/Users/ryan/projects/stock-analysis-api`: `git diff --check` passed.
  - `/Users/ryan/projects/cli-claw`: `git diff --check` passed.
  - `/Users/ryan/projects/cli-claw`: `./scripts/review.sh` passed mechanical checks and requested semantic review.

Review status:
- passed 2026-05-16: diff stays within the active scope; `kol_scan agent_required` no longer advances strategy iteration, collected KOL output still can unblock it, no public API / approval / activation / live trading path changed, and owner docs plus roadmap are synchronized.

## Notes

- Root cause found 2026-05-16: live task-chain runs repeatedly completed `kol_scan` with `status=agent_required` because `stock-kol-intel` returned an assistant prompt, not final KOL intelligence. `_execute_task()` still scheduled `strategy_iteration`, so the loop reran alpha research while consuming placeholder KOL input and while the strategy registry had no active strategy versions.

## Handoff

- Completed. The task-chain source invoked by launchd will pick up the scheduling gate on the next `uv run python scripts/task_chain.py ... tick` invocation.
- Current live task-chain pending state has only a future `market_observe`; no stale `strategy_iteration` is pending.
- Follow-up tracked in `PLANS/ROADMAP.md`: Cli Claw still needs an Agent handoff to turn `stock-kol-intel` `agent_required` prompts into final KOL reports.
