# Implement Runbook

This file defines the default loop for the main Codex agent when executing a complex task in this repository.

## Inputs

- Repo contract: `AGENTS.md`
- Engineering guardrails: `docs/ENGINEERING.md`
- Local active plan: `PLANS/ACTIVE.md`
- Review gate: `RUNBOOKS/Review.md`
- Handoff rules: `RUNBOOKS/Handoff.md`
- Optional role cards: `.codex/agents/*.md`

## Execution Loop

1. Read `AGENTS.md`, `docs/ENGINEERING.md`, and the current `PLANS/ACTIVE.md`.
2. Find the first milestone whose `Status` is not `done`.
3. Set that milestone to `in_progress` if it is still `pending`.
4. Re-read the milestone's `Objective`, `Allowed scope`, and `Validation`.
5. Confirm the planned work still fits the milestone. If objective, scope, or validation changed, update `PLANS/ACTIVE.md` before editing code.
6. Decide whether subagents are needed.

## When Subagents Are Allowed

- The work can be split into narrow, low-coupling tasks.
- The main agent can continue making progress without waiting on every delegated result.
- The delegated task has a clear owner and a short write boundary, or is read-only.
- The requested output can be summarized structurally.

## When Subagents Are Not Allowed

- The work is on the immediate critical path and the main agent is blocked on it.
- Objective or scope is still unclear.
- Validation rules are not yet defined.
- The task would duplicate work the main agent is already doing.
- The delegated write surface overlaps heavily with other ongoing edits.

## Recommended Roles

- `reader`: read-only exploration, context gathering, code location, pattern lookup
- `implementer`: bounded implementation inside an explicit write set
- `tester`: reproduction, validation execution, failure summarization
- `reviewer`: diff audit against `RUNBOOKS/Review.md`

## Subagent Output Contract

When dispatching a subagent, require it to return:

- `summary`: what it found or changed
- `files`: exact files read or changed
- `risks`: unresolved risks, assumptions, or regressions
- `next_action`: the next concrete step the main agent should take

The main agent remains responsible for final decisions, final edits, validation, review, and plan updates.

## Implementation Rules

1. Choose the smallest safe change set that satisfies the current milestone.
2. Stay inside `Allowed scope`. If a required change falls outside scope, stop and update `PLANS/ACTIVE.md` first.
3. Apply edits.
4. Run the milestone validation immediately after the implementation round.
5. If validation fails, record the failure in the milestone notes and enter the repair loop.

## Repair Loop

1. Do not advance to the next milestone.
2. Inspect the failing command or symptom.
3. Make the smallest repair that targets the observed failure.
4. Re-run the failed validation and then the full milestone validation set.
5. Repeat until validation passes or the task is clearly blocked.
6. If blocked, update `PLANS/ACTIVE.md` and write a handoff using `RUNBOOKS/Handoff.md`.

## Review Gate

1. After validation passes, run the review process in `RUNBOOKS/Review.md`.
2. If review fails, capture the findings in the milestone notes.
3. Fix the issues inside the same milestone.
4. Re-run validation.
5. Re-run review.

## Completion Rule

- Mark the milestone `done` only after:
  - `Validation status: passed`
  - `Review status: passed`
- Then update the `Handoff` section in `PLANS/ACTIVE.md` with the resulting state and the next recommended action.
- Move to the next milestone and repeat the loop.
