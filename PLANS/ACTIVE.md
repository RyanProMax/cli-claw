# Codex Context Window Overflow Handling

## Goal

- Fix the user-visible `context_window_exceeded` / `Codex ran out of room in the model's context window` failure.
- Return a useful recoverable message instead of a raw internal JSON error.
- Keep the change narrowly scoped to Codex runtime error handling and regression coverage.

## Done when

- Codex context-window exhaustion is classified and surfaced as an actionable user-facing failure.
- Raw `Internal error` JSON payloads for this case no longer leak as the assistant reply.
- Related tests, typecheck, runner build, diff hygiene, and review pass.

## Milestones

### Milestone 1

Objective:
- Locate the Codex ACP error path for `context_window_exceeded`, add targeted normalization / guidance, and cover it with tests.

Allowed scope:
- `PLANS/ACTIVE.md`
- `container/agent-runner/src/**`
- `tests/**`
- `shared/**` only if the existing error contract requires a shared helper
- `docs/RUNTIME.md` only if the runtime contract changes

Validation:
- `npm test -- --run tests/codex-session-runtime.test.ts`
- `npm run typecheck`
- `npm --prefix container/agent-runner run build:runner`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Initial symptom: `{"message":"Internal error","code":-32603,"data":{"message":"Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.","codex_error_info":"context_window_exceeded"}}`.
- Added Codex context-window detection for `context_window_exceeded`, "ran out of room in the model's context window", and "Start a new thread or clear earlier history".
- Codex runtime errors now format this case as an actionable `/clear` / new-session hint instead of leaking the raw JSON-RPC `Internal error` payload.
- Kept existing Codex auth and quota messages covered after moving the formatter into `codex-session-runtime.ts`.
- Validation passed:
  - `npm test -- --run tests/codex-session-runtime.test.ts`
  - `npm run typecheck`
  - `npm --prefix container/agent-runner run build:runner`
  - `git diff --check`
  - `./scripts/review.sh`
- Review gate passed against `RUNBOOKS/Review.md`; no docs update required because the public runtime contract did not change.
- Committed as the current task commit and applied through safe restart intent `restart-2026-04-25T04-26-03-941Z-08c9dc90`.
- Post-restart health check returned `{"status":"healthy","checks":{"database":true,"queue":true}}` on port `3000`.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 1

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `container/agent-runner/src/codex-session-runtime.ts`
- `container/agent-runner/src/index.ts`
- `tests/codex-session-runtime.test.ts`

Next step:
- None; fix is committed, applied, and healthy.
