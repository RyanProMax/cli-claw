# Self Iteration Runbook

This runbook describes the safe path for using a running Cli Claw service to validate changes to Cli Claw itself.

## Principle

The live backend must not directly restart itself. It owns the IM ingress path; if it exits and the replacement fails to boot, the operator loses the same channel that would report the failure.

## Safe Minimum Flow

1. Implement code changes through the normal `RUNBOOKS/Implement.md` loop.
2. Run the milestone validation commands, especially `npm run build:shared`, directly related tests, and `npm run build:backend`.
3. Send `/self-status` from an admin IM chat to check the running PID, build stale state, cwd, and latest self-check result.
4. Send `/self-check` from an admin IM chat.
5. Continue only if `/self-check` reports `通过`.
6. If a managed restart is desired, send `/self-restart` from an admin IM chat.
7. Inspect `~/.cli-claw/ops/restarts/*.json` if IM becomes temporarily unavailable.

## What `/self-check` Does

- Starts a candidate backend from the app root with `node dist/index.js`.
- Uses a temporary `HOME`, so candidate data lands under an isolated `~/.cli-claw`.
- Uses a temporary `WEB_PORT`.
- Sets `CLI_CLAW_SELF_CHECK=1`, so the candidate skips IM channel connections.
- Skips CLI launch cwd validation and host workspace default cwd materialization, because the candidate HOME is temporary and should not validate production host workspaces.
- Polls `http://127.0.0.1:<port>/api/health`.
- Stops the candidate process and removes the temporary HOME.
- Leaves the current live service untouched.

## What It Does Not Do

- It does not rebuild the project.
- It does not migrate or modify production `~/.cli-claw`.
- It does not stop the current service.
- It does not promote the candidate to the production port.
- It does not roll back a failed real restart.

## What `/self-restart` Does

- Writes a restart intent JSON under `~/.cli-claw/ops/restarts/`.
- Starts an independent watchdog process from `dist/self-restart-watchdog.js`.
- The watchdog runs shadow self-check first.
- If shadow self-check fails, the watchdog writes `preflight_failed` and leaves the current backend running.
- If shadow self-check passes, the watchdog sends `SIGTERM` to the old PID, starts the same command/args that launched the current backend, and polls the production `/api/health`.
- The watchdog inherits the current process environment but does not write the full environment into the intent JSON.

## Restart Rule

Only an out-of-process supervisor or watchdog should perform a real restart. That watchdog must own the old PID, new process launch, health polling, and log capture.

`/self-restart` is the built-in minimal watchdog. It is not a full release manager: it does not keep old binaries, switch symlinks, or guarantee rollback. For stronger production safety, run Cli Claw under launchd/systemd with release directories or blue-green promotion.
