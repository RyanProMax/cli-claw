# Feishu Card Layering Contract

## Goal

- Fix Feishu streaming card layer placement so user-visible answer content and commentary/internal progress stay in the correct regions during streaming and at terminal state.
- Close the three reported cases:
  - Streaming output puts every chunk into commentary.
  - Terminal card drops commentary and puts everything into body.
  - Terminal card occasionally has an empty body with commentary only.

## Done when

- The current data flow from runtime stream events to Feishu card rendering is mapped with source evidence.
- A focused regression test covers streaming and terminal presentation boundaries.
- The production fix is implemented, validated, reviewed, committed, and applied through the safe restart path if it affects the running service.

## Milestones

### Milestone 1

Objective:
- Locate the exact presentation boundary that mixes body/commentary and decide the smallest implementation scope.

Allowed scope:
- `PLANS/ACTIVE.md`
- read-only inspection of `shared/stream-presentation.ts`, `src/feishu-streaming-card.ts`, `src/index.ts`, chat streaming stores, Feishu tests, recent logs/DB rows, and related tests

Validation:
- Identify which event fields are intended to become Feishu body vs commentary.
- Identify the failing code path for streaming and terminal card updates.
- Name the regression tests needed before editing production code.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- RM-2026-04-24-05 already tracks Feishu outbound message contract; this task narrows it to card layer rendering.
- Data flow confirmed:
  - runtime `text_delta` events update `StreamPresentationTextState`.
  - `feedStreamEventToCard()` writes that state into `StreamingCardController`.
  - final result handling calls `resolveVisibleReplyText()` and then `StreamingCardController.complete()/fail()`.
- Root cause:
  - Codex presentation state may move earlier assistant text into `commentaryText`, but `feedStreamEventToCard()` eagerly writes the full `commentaryText` into the Feishu card on every streaming `text_delta`.
  - Terminal finalization relies on the controller already having the right commentary state; if the streaming path and final result path disagree, commentary either leaks into body, disappears, or leaves a terminal card with no answer body.
- Regression coverage needed:
  - Codex streaming `text_delta` should update Feishu body only, not push commentary into the commentary panel during streaming.
  - Terminal completion must sync commentary into a dedicated panel immediately before finalizing.
  - Completion with no answer body must render a body fallback, not an empty body.

### Milestone 2

Objective:
- Implement the card-layering fix and regression tests.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md` if follow-up remains
- `shared/stream-presentation.ts`
- `src/feishu-streaming-card.ts`
- `src/index.ts`
- directly related tests under `tests/`

Validation:
- Run focused Feishu/presentation tests identified in Milestone 1.
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
- Keep this focused on Feishu card presentation layers. Do not fold in unrelated outbound delivery/cursor commits unless the root cause proves they are inseparable.
- Fix implemented:
  - `StreamPresentationTextState` now keeps a separate cumulative `streamText` for live card body rendering, so unstable Codex message UUID boundaries cannot push most live output into the commentary panel.
  - `feedStreamEventToCard()` no longer writes Codex `commentaryText` into the card during streaming; terminal paths sync commentary immediately before `complete()` / `fail()` / `abort()`.
  - `resolveVisibleReplyParts()` can return both final body text and commentary text, including a guarded fallback for short Codex process prefixes before Markdown report headings such as the observed `/hkipo` reply shape.
- Validation evidence:
  - `npm test -- --run tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts tests/reply-visibility.test.ts tests/chat-streaming-store.test.ts tests/restart-recovery.test.ts` (passes; existing `MaxListenersExceededWarning` remains test-harness noise)
  - `npm run typecheck`
  - `git diff --check`
  - `./scripts/review.sh`
- Review result:
  - passed local semantic review against `RUNBOOKS/Review.md`; no owner-doc update required because the public architecture/runtime contract did not change.

### Milestone 3

Objective:
- Apply and verify the fix against the running service.

Allowed scope:
- `PLANS/ACTIVE.md`
- safe restart via `bun src/cli.ts restart`
- read-only post-restart logs/DB verification

Validation:
- Safe restart passes.
- Feishu card update logs/DB evidence show expected finalization path.
- Any unverified real Feishu visual state is called out explicitly.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- If live visual verification requires a new Feishu message and there is an active user task, avoid disrupting it; use tests and logs unless a safe live probe is available.
- Safe restart passed via `bun src/cli.ts restart`.
  - Restart request: `/Users/ryan/.cli-claw/ops/restarts/restart-2026-04-24T13-27-59-254Z-c8f1f8c8.json`
  - Running backend after restart: PID 67786, port 3000, started at `2026-04-24T13:28:04.862Z`.
  - Feishu WebSocket, startup backfill, and IM channel connection all completed after restart for user `665eb9d5-6fa8-4d08-acef-93a79c3a6aea`.
- Router state after restart shows no active Feishu streaming turn; one unrelated `web:main` recovery run is active.
- No new live Feishu probe was sent, to avoid interrupting active work. The previously observed `/hkipo` terminal shape is covered by regression tests.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 3

Current status:
- Complete. Feishu card layering fix is implemented, validated, reviewed, safely restarted, and committed.

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `shared/stream-presentation.ts`
- `src/index.ts`
- `src/reply-visibility.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/reply-visibility.test.ts`
- `tests/stream-presentation.test.ts`

Last failure summary:
- The previous implementation mixed streaming body and commentary in `feedStreamEventToCard()` and terminal finalization, causing Codex process text to leak across Feishu card sections.

Suspected cause:
- Fixed. Live body rendering now uses cumulative `streamText`; commentary is synced only at terminal card finalization; terminal reply visibility strips guarded Codex process prefixes before Markdown report headings.

Next step:
- Monitor the next real Feishu card run for visual confirmation. No code follow-up is currently required.
