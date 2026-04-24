# Roadmap And Message Policy Follow-up

## Goal

- Introduce `PLANS/ROADMAP.md` as the long-term iteration tracker while keeping `PLANS/ACTIVE.md` as the current-round execution plan.
- Verify whether quota-pause, footer remaining thresholds, and task-message progress suffix behavior already match the requested contract.
- Record unfinished long-term messaging gaps into `PLANS/ROADMAP.md`.

## Done when

- `PLANS/ROADMAP.md` exists with clear long-term tracking structure.
- Repo entry docs explain the split between `ROADMAP.md` and `ACTIVE.md`.
- Items `4/5/7` are verified with fresh evidence.
- Any still-open long-term messaging gaps are captured in `PLANS/ROADMAP.md`.

## Milestones

### Milestone 1

Objective:
- Verify the current implementation status of items `4/5/7` and define the minimal `ROADMAP.md` structure.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `.gitignore`
- `AGENTS.md`
- `docs/ENGINEERING.md`
- `docs/CONTEXT.md`
- `docs/MODULE.md`
- `src/runtime-usage.ts`
- `src/active-plan-progress.ts`
- `tests/workspace-autopilot.test.ts`
- `tests/assistant-meta-footer.test.ts`
- `tests/active-plan-progress.test.ts`

Validation:
- `npm test -- tests/workspace-autopilot.test.ts tests/assistant-meta-footer.test.ts tests/active-plan-progress.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- The user’s Feishu-message complaint indicates a broader reliability gap than the already-fixed terminal-state bug; long-term items should be tracked separately in `ROADMAP.md`.
- Fresh verification passed:
  - `npm test -- tests/workspace-autopilot.test.ts tests/assistant-meta-footer.test.ts tests/active-plan-progress.test.ts`
  - `git diff --check`

### Milestone 2

Objective:
- Finalize docs/roadmap updates, run review, and commit the round.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `AGENTS.md`
- `docs/ENGINEERING.md`
- `docs/CONTEXT.md`
- `docs/MODULE.md`

Validation:
- `npm test -- tests/workspace-autopilot.test.ts tests/assistant-meta-footer.test.ts tests/active-plan-progress.test.ts`
- `./scripts/review.sh`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Keep the new roadmap file lightweight and decision-oriented; it should track long-term follow-up, not replace milestone execution details in `ACTIVE.md`.
- `PLANS/ROADMAP.md` had to be unignored in `.gitignore` so the long-term tracker can actually be versioned.
- Fresh validation/review evidence:
  - `npm test -- tests/workspace-autopilot.test.ts tests/assistant-meta-footer.test.ts tests/active-plan-progress.test.ts`
  - `./scripts/review.sh`
  - `git diff --check`

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- none

Current status:
- completed

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `.gitignore`
- `AGENTS.md`
- `docs/ENGINEERING.md`
- `docs/CONTEXT.md`
- `docs/MODULE.md`

Last failure summary:
- none

Suspected cause:
- Feishu message issues have been caught too late because the repo currently has point tests for individual behaviors, but not enough end-to-end channel-contract coverage for what is actually allowed to reach users.

Next step:
- Commit the roadmap/doc split. Future message-reliability gaps should be opened from `PLANS/ROADMAP.md` into new `PLANS/ACTIVE.md` rounds.
