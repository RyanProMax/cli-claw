# Feishu Streaming Card Contract

## Goal

- Reproduce and fix the current Feishu card hierarchy regressions:
  - streaming phase: visible content is incorrectly piling into commentary
  - terminal phase: commentary is lost and dumped into main body
  - terminal phase: body occasionally becomes empty while only commentary remains
- Re-establish a stable card contract so streaming and terminal renderers preserve the same answer/commentary separation.

## Done when

- We have focused failing tests for the three user-visible regressions.
- The minimal fix restores correct answer/commentary layering in both streaming and completed states.
- Validation and review pass for the scoped change.

## Milestones

### Milestone 1

Objective:
- Capture the three Feishu card regressions with failing tests, implement the smallest renderer fix, and verify it.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/feishu-streaming-card.ts`
- `src/index.ts`
- `tests/feishu-streaming-card.test.ts`
- `shared/stream-presentation.ts`
- `shared/dist/stream-presentation.js`
- `tests/chat-streaming-store.test.ts`
- `tests/stream-presentation.test.ts`

Validation:
- `npm test -- tests/feishu-streaming-card.test.ts`
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
- User-reported symptoms on 2026-04-24:
  - 流式输出期间，所有内容都会被堆到 commentary
  - 卡片终态丢失 commentary，所有内容都被堆到正文
  - 卡片终态偶现正文为空，只有 commentary 的情况
- Root cause escaped the renderer boundary during investigation:
  - terminal-state commentary loss is in `src/feishu-streaming-card.ts`
  - streaming-phase body/commentary inversion is rooted in `shared/stream-presentation.ts`, which currently routes all Codex `text_delta` into `commentaryText`
- Scope is widened only to the shared presentation classifier plus the smallest affected tests.
- Validation evidence:
  - `npm test -- --run tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts tests/chat-streaming-store.test.ts`
  - `npm run typecheck`
  - `./scripts/review.sh`
  - `git diff --check`
- Review result:
  - passed local semantic review after inspecting the scoped diff; no remaining blocker found in the updated Codex stream segmentation or Feishu terminal-card contract

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
- `shared/stream-presentation.ts`
- `src/feishu-streaming-card.ts`
- `src/index.ts`
- `tests/chat-streaming-store.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/stream-presentation.test.ts`

Last failure summary:
- none after validation and review

Suspected cause:
- fixed:
  - Codex stream presentation now keeps the latest assistant message in `answerText` and moves older messages into `commentaryText`
  - Feishu `feedStreamEventToCard()` now syncs both Codex answer/commentary slots during `text_delta`
  - completed Feishu cards no longer drop commentary panels while still clearing tool-step internals

Next step:
- Commit the scoped contract fix, apply it through the safe restart path, and watch the next real Feishu Codex turn for regression signals.
