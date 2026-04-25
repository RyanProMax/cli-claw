# Agent Definition Directory Migration

## Goal

- Move tracked agent role cards from `.codex/agents/` to `.agents/`.
- Use `.agents` as the unified location for agent definitions instead of Codex- or Claude-specific directories.
- Update docs and the Agent Definitions API to point at the unified layout.

## Done when

- Repo role cards live under `.agents/*.md`.
- Active docs and runbooks no longer point to `.codex/agents/*.md`.
- Agent definition management stores user-global definitions under `~/.agents/agents`, with a compatibility path for old `~/.claude/agents` files.
- Validation and review pass.

## Milestones

### Milestone 1

Objective:
- Migrate repo role cards and user-global agent definition ownership to `.agents`.

Allowed scope:
- `PLANS/ACTIVE.md`
- `.gitignore`
- `AGENTS.md`
- `RUNBOOKS/Implement.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- `.agents/*.md`
- remove `.codex/agents/*.md`
- `src/routes/agent-definitions.ts`
- directly related tests if needed

Validation:
- `rg -n "\\.codex/agents|~/.claude/agents" AGENTS.md RUNBOOKS docs src web tests`
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep the migration scoped to agent definitions. Skills remain under the existing skills paths.
- Preserve a compatibility read/migrate path for existing `~/.claude/agents` files.
- Implemented:
  - Moved tracked role cards from `.codex/agents/*.md` to `.agents/*.md`.
  - Updated execution docs and runbooks to reference `.agents/*.md`.
  - Updated the Agent Definitions API to use `~/.agents/agents`, copying legacy `~/.claude/agents/*.md` files on access when the new file is missing.
  - Adjusted `.gitignore` so root `.agents/*.md` role cards are tracked while other `.agents` runtime content remains ignored.
- Validation evidence:
  - `rg -n "\\.codex/agents|~/.claude/agents" AGENTS.md RUNBOOKS docs src web tests` produced no matches.
  - `npm run typecheck`
  - `git diff --check`
  - `git diff --cached --check`
  - `./scripts/review.sh`
- Review result:
  - passed semantic review against `RUNBOOKS/Review.md`; scope stayed limited to agent definition directory ownership.

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
- Done. Tracked role cards and user-global Agent definition management now use the unified `.agents` layout.

Changed files:
- `PLANS/ACTIVE.md`
- `.gitignore`
- `.agents/implementer.md`
- `.agents/reader.md`
- `.agents/reviewer.md`
- `.agents/tester.md`
- removed `.codex/agents/*.md`
- `AGENTS.md`
- `RUNBOOKS/Implement.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- `src/routes/agent-definitions.ts`

Last failure summary:
- None.

Next step:
- Commit the migration.
