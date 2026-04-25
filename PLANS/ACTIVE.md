# Agent Definition Cleanup

## Goal

- Remove the runtime compatibility migration from legacy agent definition paths.
- Keep user agent definitions owned by `~/.agents/agents/*.md` only.
- Simplify duplicated metadata assembly in the agent definition route.

## Done when

- Legacy agent-definition migration code is gone.
- A repository scan shows no remaining `.codex/agents` or `~/.claude/agents` compatibility references.
- Validation and review pass.

## Milestones

### Milestone 1

Objective:
- One-time local migration check, remove legacy agent-directory compatibility code, and simplify the touched route.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/routes/agent-definitions.ts`

Validation:
- `npm run typecheck`
- `npm run build:backend`
- `git diff --check`
- `./scripts/review.sh`
- `rg -n "\\.codex/agents|~/.claude/agents|getLegacyAgentsDir|migrateLegacyAgents|legacy.*agent definition|agent definition.*legacy" AGENTS.md RUNBOOKS docs src web tests .gitignore container`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- One-time local migration check found no `~/.claude/agents` directory, created/verified `~/.agents/agents`, and copied zero files.
- Removed `getLegacyAgentsDir()` and `migrateLegacyAgents()`; `discoverAgents()` and `getAgentDetail()` now read only `~/.agents/agents`.
- Consolidated agent metadata assembly into `buildAgentDefinition()`.
- Broader `legacy/fallback/compat` scan still finds unrelated database migrations, external runtime fallbacks, IM old-data routing, and UI fallback text. Those are not the agent-definition directory compatibility path and were left untouched.
- Committed as `0880310 Simplify agent definition lookup`.
- Safe restart passed via `restart-2026-04-25T02-47-27-411Z-76b8ea34`; current backend health check returned healthy after restart.

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
- `src/routes/agent-definitions.ts`

Next step:
- None; cleanup is committed, applied, and healthy.
