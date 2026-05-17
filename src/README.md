# Source Layout

Backend source is organized by product responsibility. New code should go into the matching module instead of adding another top-level file.

## Top-Level Entrypoints

- `index.ts` starts the backend service and wires the major modules together.
- `cli.ts` is the published `cli-claw` command entrypoint.
- `reset-admin.ts` is an operator utility entrypoint.
- `self-restart-watchdog.ts` is the child process entrypoint used by managed restarts.

## Modules

- `agent/`
  - Agent execution, queueing, scheduled task execution, runner output parsing, local process dispatch, and script execution.
- `core/`
  - App primitives: config, auth, permissions, schemas, logging, billing, self-check/restart, model settings, and workspace security helpers.
- `domain/`
  - Shared backend domain types. `types.ts` remains broad for now and should be split gradually by domain.
- `mcp/`
  - MCP configuration helpers used by runner and routes.
- `messaging/`
  - IM/message layer: provider adapters, channel registry, slash commands, downloads, attachments, lifecycle tracking, notifications, and provider-specific formatting.
- `presentation/`
  - Shared user-visible response formatting: assistant footer, reply visibility, stream event types, streaming runtime metadata, loop status, and tool step display.
- `skills/`
  - Skill discovery, validation, command dispatch, and skill utility functions.
- `storage/`
  - SQLite connection, schema, migrations, and persistence facade. `db.ts` is intentionally still a facade until repositories are split.
- `web/`
  - Hono app assembly, WebSocket state/context, auth middleware, and HTTP routes.

## Rules For Future Changes

1. Put new files in the module that owns the behavior.
2. Prefer direct imports from the owning module path; do not add legacy compatibility facades for moved files.
3. Keep root files limited to runtime entrypoints.
4. When moving files, rewrite imports in the same change and run `npm run typecheck` before continuing.
5. Split large facade files only when changing their behavior; do not mix broad internal splits with unrelated feature work.
