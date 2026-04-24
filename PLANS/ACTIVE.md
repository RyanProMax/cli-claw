# Feishu Streaming Placeholder Cleanup

## Goal

- Reproduce and fix the current Feishu generating-state regression where the card body shows a literal `...` above the existing `⏳ 生成中...` status note.
- Keep the generating state minimal: when no answer text exists yet, only the status note should remain visible.

## Done when

- We have a focused failing test that proves the generating-state card body no longer renders a standalone `...` placeholder.
- The minimal renderer fix removes the duplicate ellipsis without regressing the existing `⏳ 生成中...` status note or interrupt row placement.
- Validation and review pass for the scoped change.

## Milestones

### Milestone 1

Objective:
- Capture the duplicate-ellipsis regression in Feishu streaming-card tests and implement the smallest fix in the initial-card renderer.

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- --run tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `./scripts/review.sh`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Evidence gathered on 2026-04-24:
  - user-visible symptom in Feishu: generating state renders both `...` and `⏳ 生成中...`; desired output keeps only the latter
  - current initial-card path uses `const initialText = this.accumulatedText || (this.thinking ? '' : '...')` in `src/feishu-streaming-card.ts`
  - current active initial render path goes through `createInitialCard()` into `MultiCardManager` / legacy fallback; the dormant `StreamingModeBackend` helper is not currently instantiated
- Validation evidence:
  - `npm test -- --run tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Review result:
  - passed local semantic review after inspecting the scoped diff; no blocker found beyond the intended streaming placeholder removal
- Out of scope for this milestone:
  - Codex `/model` discovery alignment remains tracked separately in `PLANS/ROADMAP.md` item `RM-2026-04-24-08`
  - safe-restart reply recovery has recent passing restart artifacts and is not being changed unless fresh failing evidence appears

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 1

Current status:
- validation/review passed

Changed files:
- `PLANS/ACTIVE.md`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`

Last failure summary:
- initial red test proved the generating-state card body still rendered a bare `...` markdown block alongside the `⏳ 生成中...` status line

Suspected cause:
- fixed:
  - streaming-state schema2 card bodies now allow an empty main-content area instead of forcing a `'...'` fallback
  - `createInitialCard()` no longer pre-seeds empty bodies with `'...'`
  - the empty-content helper now honors an explicit empty-string fallback instead of coercing it back to `'...'`

Next step:
- commit the scoped fix and apply it through the safe restart path so the next Feishu streaming turn renders only `⏳ 生成中...` during generation
