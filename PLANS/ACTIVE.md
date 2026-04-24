# Feishu Outbound Message Contract

## Goal

- Reproduce why Feishu can surface internal `commentary` / tool-step content as a user-visible reply.
- Add focused regression coverage for the user-visible message contract before changing production behavior.

## Done when

- We can point to the exact outbound path that lets internal execution content reach Feishu.
- A failing test captures the current bad behavior.
- The next round can implement the smallest safe fix inside a clearly bounded scope.

## Milestones

### Milestone 1

Objective:
- Reproduce the leak and capture it with the smallest failing test.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `src/feishu.ts`
- `src/feishu-streaming-card.ts`
- `src/reply-visibility.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/reply-visibility.test.ts`
- `tests/restart-recovery.test.ts`

Validation:
- `npm test -- tests/reply-visibility.test.ts tests/feishu-streaming-card.test.ts tests/restart-recovery.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- The previous terminal-state fix intentionally preserves existing card content; the remaining question is whether that preserved content should ever include internal execution panels for Feishu end users.
- Root cause confirmed: success cleanup paths call `completeWithCurrentText()`, which previously dropped commentary but preserved tool-step panels, so a completed Feishu card could still expose internal steps when there was no replacement final reply.
- Fresh evidence:
  - `npm test -- tests/feishu-streaming-card.test.ts`
  - `npm test -- tests/reply-visibility.test.ts tests/feishu-streaming-card.test.ts tests/restart-recovery.test.ts`
  - `git diff --check`

### Milestone 2

Objective:
- Implement the minimal contract fix, validate it, and update the roadmap status.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `src/feishu.ts`
- `src/feishu-streaming-card.ts`
- `src/reply-visibility.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/reply-visibility.test.ts`
- `tests/restart-recovery.test.ts`

Validation:
- `npm test -- tests/reply-visibility.test.ts tests/feishu-streaming-card.test.ts tests/restart-recovery.test.ts`
- `npm run typecheck`
- `./scripts/review.sh`
- `git diff --check`
- `cli-claw restart`
- `curl -sS http://127.0.0.1:3000/api/health`

Status:
- pending

Validation status:
- not_run

Review status:
- passed

Risks / Notes / Handoff:
- Keep the fix narrow: block internal-only content from becoming the final Feishu-visible reply without regressing legitimate task progress or terminal-state freezing.
- Narrow fix applied: completed cards now clear tool-step panels alongside commentary, while aborted/error flows keep their existing behavior.

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
- in_progress

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`

Last failure summary:
- none

Suspected cause:
- Feishu currently mixes two concerns: live progress visualization and final user-visible reply delivery. A success cleanup/fallback path was freezing progress-only tool panels into the completed user-visible card.

Next step:
- Commit the fix, apply it through the safe restart path, and verify health.
