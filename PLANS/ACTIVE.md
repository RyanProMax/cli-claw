# Active Task: Stock Loop Progress Notification

## Current Goal

- Make the independent stock-analysis task-chain loop report progress back into the current Feishu conversation.
- Reuse the existing Cli Claw scheduled script IM delivery path instead of adding a second Feishu sender in the stock API.

## Current Milestone

Objective:
- Add a host-side notifier script that reads stock-analysis task-chain state, emits a concise progress summary for hourly/daily reports or failures, and stays silent for ordinary internal subtask completions.
- Register the notifier as a Cli Claw script scheduled task for the current Feishu chat.
- Keep the existing stock-analysis launchd loop unchanged for execution; this task only bridges visibility back to IM.

Validation:
- Run the notifier once against the live stock-analysis SQLite DB and confirm it prints the recent progress summary.
- Run the notifier a second time and confirm it is silent when there are no new completions.
- Register/verify the scheduled task in `~/.cli-claw/db/messages.db`.
- `git diff --check`

Status:
- done

Validation status:
- passed 2026-05-15:
  - `node scripts/stock-loop-progress-notifier.mjs --force --state-file=/private/tmp/stock-loop-progress-notifier-test.json --max-items=5`: printed recent loop progress.
  - Second notifier run with the same state file: silent, confirming duplicate suppression.
  - Default notifier run after an ordinary `paper_trade` completion: silent, confirming it will not push every internal 5-minute subtask.
  - Registered `stock-loop-progress-notifier` in `~/.cli-claw/db/messages.db` for `feishu:oc_98f0bb60f284627bf20f9386704f8c82`.
  - Scheduler executed the task: first run sent 8 recent completions; second run was silent and marked `Completed`.
  - Natural hourly-report run at `2026-05-15T07:19:40Z`: sent the hourly progress summary; the following tick was silent.
  - `node --check scripts/stock-loop-progress-notifier.mjs`: passed.
  - `prettier --check scripts/stock-loop-progress-notifier.mjs`: passed.
  - `git diff --check`: passed.

Review status:
- passed 2026-05-15: change is visibility-only. The stock-analysis launchd worker remains the single execution loop, and the notifier only reads `task_chain.sqlite`, writes a local notification cursor, and uses the existing Cli Claw scheduled-script IM path. Default push cadence is report-worthy progress, not every internal chain step.

## Notes

- 2026-05-15 root cause: the stock-analysis loop is running independently through launchd and records progress in `.cache/task_chain.sqlite`; Cli Claw has no scheduled script task reading that state, so no Feishu progress message is produced.
- `src/task-scheduler.ts` already sends non-empty script stdout to IM via `deps.sendMessage(...)`; the notifier should use that existing path and avoid direct Feishu API calls.
- Installed scheduled task id: `stock-loop-progress-notifier`, interval: `60000ms`.
