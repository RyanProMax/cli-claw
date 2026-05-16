# Active Task: Source And Test Layout Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or direct controller execution with verification gates. Plans live in `PLANS/`; do not write new plans under `docs/superpowers`.

**Goal:** Make `src/` and `tests/` human and AI friendly by grouping files by product responsibility instead of flat historical names.

**Architecture:** Keep runtime entrypoints stable at the top level, then move implementation files into feature directories. This pass is primarily mechanical: move files, update imports, preserve behavior, and run the full existing gate before claiming completion.

**Tech Stack:** TypeScript ESM, NodeNext imports, Vitest, Hono, Bun/tsx dev runtime.

---

## Scope

In scope:
- Keep top-level entrypoints: `src/index.ts`, `src/cli.ts`, `src/reset-admin.ts`, `src/self-restart-watchdog.ts`, `src/pty-worker.cjs`.
- Move backend implementation files into:
  - `src/core/`
  - `src/storage/`
  - `src/messaging/`
  - `src/presentation/`
  - `src/skills/`
  - `src/mcp/`
  - `src/agent/`
  - `src/web/`
  - `src/domain/`
- Move tests into:
  - `tests/unit/`
  - `tests/integration/`
  - `tests/contracts/`
  - `tests/scripts/`
- Update `src/README.md` and `docs/MODULE.md`.

Out of scope for this pass:
- Splitting `src/index.ts`, `src/storage/db.ts`, `src/web/app.ts`, or `src/core/runtime/config.ts` internally.
- Deleting more P0 tests. This pass may move tests and record low-value cleanup, but behavior pruning needs a follow-up after the layout compiles cleanly.

## Target Source Layout

```text
src/
  index.ts
  cli.ts
  reset-admin.ts
  self-restart-watchdog.ts
  pty-worker.cjs
  core/
    app-root.ts
    auth.ts
    billing.ts
    config.ts
    logger.ts
    permissions.ts
    schemas.ts
    utils.ts
    runtime/
    self/
    workspace/
  storage/
    db.ts
    sqlite-compat.ts
  domain/
    types.ts
  messaging/
    channel.ts
    manager.ts
    notifier.ts
    lifecycle.ts
    providers/
  presentation/
  agent/
  web/
  skills/
  mcp/
```

## Target Test Layout

```text
tests/
  unit/
    agent/
    app/
    core/
    messaging/
    presentation/
    skills/
    web/
  integration/
    agent/
    messaging/
    routes/
    scheduler/
    web/
  contracts/
    cli/
    openai/
    packaging/
    runtime/
  scripts/
    stock/
```

## Execution Steps

- [x] Commit current working tree baseline.
- [x] Move `src/` implementation files into functional directories with `git mv`.
- [x] Rewrite relative imports mechanically from old file paths to new file paths.
- [x] Move `tests/` files into unit/integration/contract/script directories.
- [x] Rewrite test imports and mocks mechanically.
- [x] Update `src/README.md` and `docs/MODULE.md`.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `./scripts/review.sh`.

## Validation

Required before completion:
- `npm run typecheck`
- `npm test`
- `./scripts/review.sh`
- `curl -fsS http://127.0.0.1:3000/api/health`

## Handoff

Current status:
- done

Notes:
- The layout refactor is allowed to be breaking internally, but must preserve public CLI/package entrypoints.
- If full test failures reveal stale import paths only, fix them in the same pass.
- Validation passed: `npm run typecheck`, `npm test` (61 files / 450 tests), `./scripts/review.sh`, `npm run build`, and local `/api/health`.
- Service was restarted successfully through `bun src/cli.ts restart`; the managed watchdog entrypoint remains at `src/self-restart-watchdog.ts` so `dist/self-restart-watchdog.js` is preserved.
