# Memory Owner Doc Rename

## Goal

- Rename `docs/CONTEXT.md` to `docs/MEMORY.md`.
- Keep `MEMORY.md` focused on Cli Claw memory/context retention only.
- Move or point non-memory facts to their owner docs, especially execution protocol facts to `AGENTS.md`.
- Update references so `CONTEXT.md` is no longer treated as an owner doc.

## Done when

- `docs/MEMORY.md` explains the current memory mechanism, triggers, storage paths, retention/growth boundaries, and Claude/Codex session differences.
- Non-memory content formerly in `docs/CONTEXT.md` is removed from the memory doc and represented in the appropriate owner doc.
- References in `AGENTS.md`, `README.md`, `docs/*.md`, and module index use `docs/MEMORY.md`.
- Validation and review pass.

## Milestones

### Milestone 1

Objective:
- Rename and rewrite the memory owner doc, then update owner-doc references and minimal extracted content.

Allowed scope:
- `PLANS/ACTIVE.md`
- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ENGINEERING.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- remove `docs/CONTEXT.md`

Validation:
- `rg -n "CONTEXT\\.md|docs/CONTEXT" AGENTS.md README.md docs`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep this as a documentation-only change.
- Do not duplicate the full workspace/session model in `MEMORY.md`; architecture/runtime owner docs should carry those boundaries.
- Implemented:
  - Replaced `docs/CONTEXT.md` with focused `docs/MEMORY.md`.
  - Moved execution protocol ownership into `AGENTS.md`.
  - Moved workspace/conversation identity and permission boundary notes into `docs/ARCHITECTURE.md`.
  - Kept host cwd / runtime session / external Claude-Codex state in `docs/RUNTIME.md`.
- Validation evidence:
  - `rg -n "CONTEXT\\.md|docs/CONTEXT" AGENTS.md README.md docs` produced no matches.
  - `git diff --check`
  - `./scripts/review.sh`
- Review result:
  - passed semantic review against `RUNBOOKS/Review.md`; change stayed documentation-only and inside the allowed scope.

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
- Done. `docs/MEMORY.md` is now the memory owner doc and all active owner-doc references point to it.

Changed files:
- `PLANS/ACTIVE.md`
- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ENGINEERING.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- removed `docs/CONTEXT.md`

Last failure summary:
- None.

Next step:
- Commit the documentation-only change.
