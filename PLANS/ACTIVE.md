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

### Milestone 71

Objective:
- Keep Codex `/hkipo` process narration out of the Feishu main report body by recognizing the bold `港股 IPO 池` terminal title as the visible-answer boundary, and update `/hkipo` skill output to the user-requested compact section layout.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/reply-visibility.ts`
- `tests/reply-visibility.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `/Users/ryan/projects/stock-analysis-skill/commands/hkipo.py`
- `/Users/ryan/projects/stock-analysis-skill/tests/test_hkipo_command.py`
- `/Users/ryan/projects/stock-analysis-skill/SKILL.md`
- `/Users/ryan/projects/stock-analysis-skill/README.md`
- `/Users/ryan/projects/stock-analysis-skill/references/hkipo.md`
- `/Users/ryan/projects/stock-analysis-skill/PLANS/ACTIVE.md`

Validation:
- `npm test -- --run tests/reply-visibility.test.ts tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `python3 -m unittest tests/test_hkipo_command.py`
- `python3 -m unittest discover -s tests`
- `python3 -m py_compile scripts/*.py commands/*.py`
- `git -C /Users/ryan/projects/stock-analysis-skill diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-05: User reported `/hkipo` process narration such as "我会先..." and data-collection updates still appears in the main Feishu body. Root cause found: `reply-visibility` did not treat the bold `**港股 IPO 池｜...**` title as an answer boundary, so inferred commentary stripping did not run for hkipo reports.
- 2026-05-05: User clarified `/hkipo` final body should remove the `申购冲突` section entirely, remove the title-tail "investment suggestion"/priority wording, and put subscription deadline plus allotment/result date in each IPO title line, e.g. `🟡 2｜01236 樂動機器人｜74｜5/6截止 | 5/7开奖`.
- 2026-05-05: User also clarified report spacing should be compact: no blank empty lines between `关键结论`, `优先级`, per-IPO entries, and `来源`.

Validation status:
- passed 2026-05-05:
  - `npm test -- --run tests/reply-visibility.test.ts tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `python3 -m unittest tests/test_hkipo_command.py`
  - `python3 -m unittest discover -s tests`
  - `python3 -m py_compile scripts/*.py commands/*.py`
  - `git -C /Users/ryan/projects/stock-analysis-skill diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-05: scope stayed within Milestone 71; `reply-visibility` now treats the bold hkipo report title as the terminal answer boundary and routes stripped process narration into the top `Thinking` fold; `/hkipo` skill output no longer contains the subscription-conflict section, uses deadline/result dates in title lines, and removes blank empty lines from the report body contract. No blocking diff hygiene or contract issues found.

Risks / Notes / Handoff:
- Build still emits the existing Vite large-chunk warning, but exits successfully.
- The fixed-source-order heat rule reduces latest-margin drift by forcing the same source priority and timestamp gate. It does not yet implement a deterministic local scraper/cache for broker margin tables.

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
- Milestone 71

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `src/reply-visibility.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/reply-visibility.test.ts`
- `tests/stream-presentation.test.ts`
- `/Users/ryan/projects/stock-analysis-skill/commands/hkipo.py`
- `/Users/ryan/projects/stock-analysis-skill/tests/test_hkipo_command.py`
- `/Users/ryan/projects/stock-analysis-skill/SKILL.md`
- `/Users/ryan/projects/stock-analysis-skill/README.md`
- `/Users/ryan/projects/stock-analysis-skill/references/hkipo.md`
- `/Users/ryan/projects/stock-analysis-skill/PLANS/ACTIVE.md`

Last failure summary:
- RED tests failed as expected before implementation: hkipo bold titles were not recognized as answer boundaries; terminal process commentary was synced to Commentary instead of Thinking; `/hkipo` still contained `申购冲突`, blank empty lines, and priority-label title tails.

Suspected cause:
- The visibility boundary only handled Markdown `#` headings and bold `/research` titles, while `/hkipo` uses a bold `港股 IPO 池` title. The skill prompt still carried outdated report-body requirements.

Next step:
- Commit both repos, then apply through the safe restart path.
