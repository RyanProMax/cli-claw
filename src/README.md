# Source Layout

This directory is organized by runtime responsibility. Prefer adding new code inside the matching module instead of adding more top-level files.

## Modules

- `agent/`
  - runner, queue, scheduler, and process output handling.
  - Use this for code that starts agents, serializes work, parses runner output, or executes scheduled tasks.
- `core/`
  - runtime configuration, workspace helpers, permissions, and app-level primitives.
  - Use this for shared backend logic that is not tied to a specific IM provider or route.
- `data/`
  - database connection, schema, migrations, and repositories.
  - `db.ts` may remain a facade while repositories are split.
- `domain/`
  - shared backend domain types.
  - Move broad types here when breaking up `types.ts`.
- `im/`
  - IM provider adapters, channel registry, slash commands, lifecycle tracking, and provider-specific message handling.
- `web/`
  - HTTP app assembly, route helpers, WebSocket state, and web-only message handling.

## Current Migration State

The refactor is intentionally incremental. Some legacy top-level files still exist while their responsibilities are moved into modules.

Current moduleized files:

- `agent/runner/output-parser.ts`
- `agent/runner/workspace-reset.ts`
- `agent/queue/group-queue.ts`
- `agent/scheduler/index.ts`
- `core/runtime/command-handler.ts`
- `core/runtime/group-runtime.ts`
- `core/runtime/identity.ts`
- `core/runtime/model-options.ts`
- `core/runtime/usage.ts`
- `core/workspace/host-cwd.ts`

When moving a file:

1. Move the implementation into the target module.
2. Rewrite imports directly to the new path.
3. Avoid old-path compatibility facades unless a build break cannot be resolved in the same pass.
4. Run `npm run typecheck` before moving the next batch.
