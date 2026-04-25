# Cli Claw UX And Architecture Roadmap Review

## Goal

- Use read-only subagents and local code inspection to identify high-priority Cli Claw usage pain points, especially Feishu-first interaction problems, startup ambiguity, stream presentation, verbosity, and context leakage.
- Update `PLANS/ROADMAP.md` with a prioritized iteration plan while preserving existing unfinished roadmap items.

## Done when

- Relevant architecture, runtime, memory, command, and IM/message flow code paths have been inspected.
- Subagent findings have been synthesized into concrete roadmap items with priorities, status, evidence, and next actions.
- Existing unfinished roadmap items remain represented in `PLANS/ROADMAP.md`.
- Documentation-only validation and review gate have passed.

## Milestones

### Milestone 1

Objective:
- Analyze current Cli Claw pain points and update the roadmap with a prioritized refactor/iteration plan.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Validation:
- `git diff --check`
- `./scripts/review.sh`
- Manual review against `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- User explicitly requested subagents for broad analysis.
- This milestone is planning/documentation only; do not implement runtime fixes here.
- Preserve current unfinished roadmap items, especially monitoring/proposed entries, and reorder by priority.
- Read-only subagents completed startup/launch, presentation/reply-policy, and Feishu reliability reports; context/session subagent was stopped after timeout and local inspection filled that gap.
- Local evidence checked: current backend launch state, LaunchAgent plist, recent Feishu messages, recent autopilot task run logs, restart recovery/session code, Feishu slash/mention handling, stream presentation, Codex ACP loop.
- `PLANS/ROADMAP.md` now contains P0/P1/P2 roadmap items and preserves existing monitoring/unfinished items under `Existing Follow-Ups Preserved`.
- Validation passed:
  - `git diff --check`
  - `./scripts/review.sh`
  - Incomplete-marker scan returned no matches before this validation note was written.
- Review gate passed against `RUNBOOKS/Review.md`:
  - Scope limited to `PLANS/ACTIVE.md` and `PLANS/ROADMAP.md`.
  - Objective satisfied: roadmap now prioritizes the Feishu reliability, launch contract, presentation, context, autopilot, slash/binding, runtime, and observability work.
  - Existing unfinished monitoring/follow-up items are preserved and linked to the new prioritized items.
  - No runtime code changed, so no service restart is needed.

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
- `PLANS/ROADMAP.md`

Last failure summary:
- none

Suspected cause:
- none

Next step:
- Begin the next implementation round from P0 RM-2026-04-25-01 or P0 RM-2026-04-25-02.
