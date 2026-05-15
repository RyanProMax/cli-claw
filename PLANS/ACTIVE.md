# Active Task: Stock Loop Progress Notifier Cursor

## Current Goal

- Fix stock loop progress notifications so completed market/news/KOL/strategy tasks are reported after the task-chain history grows beyond the notifier page size.
- Keep the change scoped to notifier cursor semantics; do not change loop execution or Feishu delivery policy.

## Current Milestone

Objective:
- Move incremental task selection into SQL so the notifier reads rows after `lastCompletedCursor`, instead of reading the oldest 50 completed tasks and filtering in memory.
- Add regression coverage for a cursor that is older than the newest rows but outside the first page of completed history.
- Verify the live notifier emits the missed progress and advances its cursor.

Allowed scope:
- `scripts/stock-loop-progress-notifier.mjs`
- focused tests for the notifier script
- this active plan

Validation:
- Reproduce the pre-fix no-output condition with the live task-chain state.
- Run the new notifier regression test.
- Run `git diff --check`.
- Run the review helper if the targeted validation passes.

Status:
- done

Validation status:
- passed 2026-05-15:
  - Reproduced the live no-output condition before the fix: the notifier state cursor stayed at `2026-05-15T13:36:48.970486+00:00` while newer `news_scan` / `strategy_iteration` tasks existed.
  - `npm test -- tests/stock-loop-progress-notifier.test.ts`: passed.
  - Live task-chain dry run with a temporary state file emitted 6 missed items and advanced the temp cursor to `2026-05-15T14:18:39.085319+00:00`.
  - Real scheduled notifier run at `2026-05-15T14:29:11Z` sent the missed Feishu progress message and advanced `.cli-claw/stock-loop-progress-notifier.json`.
  - `npx prettier --check scripts/stock-loop-progress-notifier.mjs tests/stock-loop-progress-notifier.test.ts PLANS/ACTIVE.md`: passed.
  - `git diff --check`: passed.
  - `./scripts/review.sh`: passed mechanical checks and requested semantic review.

Review status:
- passed 2026-05-15: scoped to notifier cursor selection plus a focused regression test; no loop execution semantics, Feishu delivery policy, or stock-analysis task-chain behavior changed.

## Notes

- Root cause found 2026-05-15: `fetchRows()` queried `ORDER BY updated_at ASC LIMIT 50` and only then applied `isAfterCursor()` in JS. The live task-chain has 56 completed rows, so the query returned only old rows and never saw the completed `news_scan` / `strategy_iteration` rows after the cursor.

## Handoff

- The stock loop is running and progress notifications resumed.
- Latest verified emitted progress included `news_scan`, `kol_scan`, and `strategy_iteration`.
- Next loop capability gap remains separate: KOL scan still records `agent_required` because `stock-kol-intel` returns an Agent prompt, not the final report.
