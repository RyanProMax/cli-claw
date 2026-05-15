# Active Task: Loop Status And Startup

## Current Goal

- Add `market_loop` and `maintenance_loop` runtime state to `/status`.
- Start both loops through existing persisted scheduled task mechanisms without adding a second Feishu sender.

## Current Milestone

Objective:
- Show market loop status from the live stock-analysis task-chain DB and Cli Claw notifier task.
- Show maintenance loop status from a dedicated Cli Claw scheduled task heartbeat.
- Register/start the maintenance loop heartbeat task for the current Feishu chat.
- Include Codex 7d usage guard status so operators can see when loops should pause.

Validation:
- Run `/status` formatter path or an equivalent unit-level helper check and confirm both loop lines are present.
- Register/verify the maintenance loop scheduled task in `~/.cli-claw/db/messages.db`.
- Run maintenance loop heartbeat once and confirm it updates local state without noisy output.
- `git diff --check`

Status:
- done

Validation status:
- passed 2026-05-15:
  - Registered `maintenance-loop-heartbeat` in `~/.cli-claw/db/messages.db` for `feishu:oc_98f0bb60f284627bf20f9386704f8c82`.
  - Ran `node scripts/maintenance-loop-heartbeat.mjs --emit`: heartbeat state updated.
  - Scheduler naturally ran `maintenance-loop-heartbeat`: silent `Completed` run, no duplicate Feishu output.
  - Equivalent `/status` formatter check against live DB/state printed both `market_loop` and `maintenance_loop` lines plus `usage_guard`.
  - `npm run typecheck:backend`: passed.
  - `npm run build:backend`: passed.
  - `node --check scripts/maintenance-loop-heartbeat.mjs && node --check scripts/stock-loop-progress-notifier.mjs`: passed.
  - `prettier --check src/loop-status.ts src/index.ts scripts/maintenance-loop-heartbeat.mjs`: passed.
  - `git diff --check`: passed.
  - Safe restart requested via `node dist/cli.js restart`; new backend PID `58057`, `/api/health` returned `healthy`.

Review status:
- passed 2026-05-15: change is read-only status presentation plus a silent heartbeat task. It does not add a second Feishu sender, does not mutate stock-analysis state, and keeps market loop execution separate from maintenance loop visibility.

## Notes

- `market_loop` currently maps to stock-analysis `task_chain.sqlite` plus the `stock-loop-progress-notifier` Cli Claw scheduled task.
- `maintenance_loop` starts as a separate heartbeat/sentinel task. Full self-iteration execution remains separate from market loop and must later gain implement/review/regression workers.
