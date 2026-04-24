# Feishu Streaming Card Terminal-State Completion

## Goal

- Fix the remaining Feishu streaming-card gap where a task can finish but the card stays in `Working on it`.
- Ensure normal task completion without a final visible reply still freezes the existing card into a terminal state.
- Apply the fix through the safe `cli-claw restart` path after validation and review pass.

## Done when

- Feishu streaming cards no longer remain in streaming state when the task finishes successfully but emits no final visible text.
- Both main-session and conversation-agent cleanup paths convert active cards to a terminal completed state instead of silently disposing them.
- Focused regression tests cover the terminal-state fallback behavior and pass.
- The updated backend is applied through the repo-approved safe restart path.

## Milestones

### Milestone 1

Objective:
- Reproduce the terminal-state gap with failing focused tests before changing production code.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- tests/feishu-streaming-card.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Root-cause hypothesis: task completion currently relies on the presence of a final visible reply to call `complete()/fail()`. When the task ends without visible final text, the `finally` cleanup path falls back to `dispose()`, which stops timers but does not patch the card to a terminal state.
- Keep the first reproduction focused on controller/session finalization behavior. Only widen scope to `src/index.ts` after the failing test proves the gap.

### Milestone 2

Objective:
- Implement the terminal-state fallback fix, validate it, review it, and apply it through safe restart.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/feishu-streaming-card.ts`
- `src/feishu.ts`
- `src/index.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `./scripts/review.sh`
- `git diff --check`

Status:
- in_progress

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Prefer freezing the card’s existing accumulated content into a completed terminal card rather than synthesizing a new visible reply string in `index.ts`.
- Safe restart happens only after validation and review both pass.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 2

Current status:
- validated, awaiting apply

Changed files:
- `PLANS/ACTIVE.md`
- `src/feishu-streaming-card.ts`
- `src/feishu.ts`
- `src/index.ts`
- `tests/feishu-streaming-card.test.ts`

Last failure summary:
- Reproduced and fixed. Fresh validation passed:
  - `npm test -- tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`

Suspected cause:
- Confirmed: active Feishu streaming cards were finalized only when a final visible reply existed. Success cleanup paths without visible final text fell through to `dispose()` in `finally`, leaving the card visually stuck in streaming state.

Next step:
- Commit the fix, then apply it through `cli-claw restart` so the running backend picks up the new terminal-state cleanup behavior.
