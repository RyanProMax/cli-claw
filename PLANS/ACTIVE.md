# Feishu Thinking And HKIPO Presentation Polish

## Goal

- Make Feishu streaming-card `thinking` visually distinct from the top status/body area by rendering it as the same native collapsible panel family as tool `steps`, even before any thinking text arrives.
- Adjust `/hkipo` report instructions so `申购冲突` is a top-level section beside `关键结论` and `优先级`; per-IPO fields stay compact without blank lines between every small point.

## Done when

- Streaming cards render empty/live thinking as a `collapsible_panel`, expanded while streaming and collapsed after completion, with tests covering the empty-thinking case.
- The hkipo reference contract shows `申购冲突` as a top-level section and removes the per-card `⏱` line from the default card template.
- The spacing contract requires blank lines around top-level sections only, not between every per-IPO small field.
- Focused tests, build/typecheck as needed, `git diff --check`, and `./scripts/review.sh` pass.

## Milestones

### Milestone 69

Objective:
- Fix Feishu card thinking presentation and synchronize hkipo report-format instructions.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`
- `/Users/ryan/projects/stock-analysis-skill/SKILL.md`
- `/Users/ryan/projects/stock-analysis-skill/references/hkipo.md`
- Related focused tests if existing coverage needs small expectation updates.

Validation:
- `npm test -- --run tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `git -C /Users/ryan/projects/stock-analysis-skill diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-05: Started from Feishu feedback: thinking should be a collapsible panel like steps; hkipo subscription conflict should be a top-level section; blank-line spacing should apply to top-level sections, not every small per-IPO field.
- 2026-05-05: Added RED coverage for empty `setThinking()` rendering; confirmed it failed because the old branch produced no collapsible panel. Implemented the minimal card change and updated `docs/RUNTIME.md`.
- 2026-05-05: Updated `stock-analysis-skill` `/hkipo` instructions so `⏱ 申购冲突` is top-level and per-IPO fields are compact without blank lines between every small point.
- 2026-05-05: Final validation passed. Build still emits the existing Vite large-chunk warning, but exits successfully.

Validation status:
- passed 2026-05-05:
  - `npm test -- --run tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `git -C /Users/ryan/projects/stock-analysis-skill diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-05: scope matches Milestone 69; `thinking` now consistently uses existing native collapsible panels instead of top-level markdown; hkipo instructions move `申购冲突` to a top-level section and narrow blank-line spacing to top-level sections only; docs/tests are synchronized; no blocking hygiene or contract issues found.

Risks / Notes / Handoff:
- `stock-analysis-skill` files were updated in place and match the installed skill copy used by the current `/hkipo` runtime path.

### Milestone 70

Objective:
- Keep Feishu card process panels (`thinking`, tool `steps`, commentary/progress details) at the top of the card in both live and completed states, before the final answer body.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- --run tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-05: User clarified that the previous completed-card ordering missed the point: `steps` should not move to the bottom. The target order is top process panels first, final answer body after them.
- 2026-05-05: Added RED coverage proving completed-card `thinking`, `steps`, and `commentary` were below the report body. Moved auxiliary panels to the top for all card states and synchronized `docs/RUNTIME.md`.
- 2026-05-05: Final validation passed. Build still emits the existing Vite large-chunk warning, but exits successfully.

Validation status:
- passed 2026-05-05:
  - `npm test -- --run tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-05: scope stayed within Milestone 70; completed and live Feishu cards now share top process-panel ordering; regression coverage asserts `thinking`, `steps`, and `commentary` appear before the report body; docs no longer contradict the requested top placement.

Risks / Notes / Handoff:
- This intentionally supersedes Milestone 69's completed-card rule that placed final answer before auxiliary details.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 70

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`

Last failure summary:
- RED test failed as expected before implementation: completed-card `thinking` index was after the report body index.

Suspected cause:
- Completed-card auxiliary layout still uses the old "body first, details after" ordering.

Next step:
- Commit the completed changes, then apply them through the safe restart path.
