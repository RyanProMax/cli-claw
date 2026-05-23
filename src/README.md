# Source Layout

Backend source is organized by product responsibility. New code should go into the matching module instead of adding another top-level file.

## Top-Level Entrypoints

- `index.ts` starts the backend service and wires the major modules together.
- `cli.ts` is the published `cli-claw` command entrypoint.
- `self-restart-watchdog.ts` is the child process entrypoint used by managed restarts.

## Modules

- `agent/`
  - Agent execution, queueing, workflow scheduled task execution, runner output parsing, and local process dispatch.
- `core/`
  - App primitives: config, instance auth, schemas, logging, self-check/restart, model settings, and workspace security helpers.
- `domain/`
  - Shared backend domain types. `types.ts` remains broad for now and should be split gradually by domain.
- `messaging/`
  - IM/message layer: provider adapters, channel registry, slash commands, downloads, attachments, lifecycle tracking, notifications, and provider-specific formatting.
- `presentation/`
  - Shared user-visible response formatting: assistant footer, reply visibility, stream event types, streaming runtime metadata, loop status, and tool step display.
- `skills/`
  - Skill discovery, validation, command dispatch, and skill utility functions.
- `storage/`
  - SQLite connection, schema, migrations, and domain persistence entrypoints. Import through `access`, `messages`, `workspaces`, `workflows`, `scheduler`, `agents`, or `schema` instead of the underlying `db.ts` implementation.
- `web/`
  - Hono app assembly, WebSocket state/context, auth middleware, and HTTP routes.

## Rules For Future Changes

1. Put new files in the module that owns the behavior.
2. Prefer direct imports from the owning module path; do not add legacy compatibility facades for moved files.
3. Keep root files limited to runtime entrypoints.
4. When moving files, rewrite imports in the same change and run `npm run typecheck` before continuing.
5. Split large facade files only when changing their behavior; do not mix broad internal splits with unrelated feature work.
