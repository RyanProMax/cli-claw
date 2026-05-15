# Active Task: Loop Status Runtime Compatibility

## Current Goal

- Fix `/status` loop rendering under Bun source-mode runtime.
- Keep loop status read-only and avoid surfacing low-level SQLite driver errors in Feishu.

## Current Milestone

Objective:
- Reuse the existing SQLite compatibility layer for stock task-chain reads.
- Add regression coverage for loop status formatting when the task-chain DB is unavailable.
- Reproduce and verify the formatter in Bun after the fix.

Validation:
- Run targeted loop-status tests.
- Run the `/status` loop formatter with Bun against the live stock-analysis task-chain DB.
- Run backend type/build checks and review helper.
- `git diff --check`

Status:
- done

Validation status:
- passed 2026-05-15:
  - Reproduced the bug with Bun source-mode formatter: direct `better-sqlite3` import surfaced the Bun unsupported-driver message in `market_loop`.
  - Added `tests/loop-status.test.ts` regression coverage for degraded market loop status without low-level SQLite error leakage.
  - `npm test -- tests/loop-status.test.ts`: passed.
  - Bun source-mode formatter against live stock-analysis task-chain DB: printed `market_loop: active` with `next`/`last`, without `better-sqlite3`, `market_loop: error`, or `task_chain_read_failed`.
  - `npm run typecheck:backend`: passed.
  - `npm run build:backend`: passed.
  - `prettier --check src/loop-status.ts src/sqlite-compat.ts tests/loop-status.test.ts PLANS/ACTIVE.md`: passed.
  - `git diff --check`: passed.
  - `./scripts/review.sh`: passed mechanical review gate.

Review status:
- passed 2026-05-15: fix reuses the existing SQLite compatibility layer, keeps `/status` read-only, and collapses any task-chain read failure to a short degraded state instead of leaking driver internals to Feishu.

## Notes

- Reproduced with Bun: `better-sqlite3` is unsupported, and the previous `/status` implementation imported it directly instead of using `src/sqlite-compat.ts`.
