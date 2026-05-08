# Codex Feishu Final Body Visibility Regression

## Goal

- Restore Codex Feishu/Web final-answer visibility when a terminal final contains process narration followed by the actual user-facing report body.
- Keep process narration in the unified Thinking lane without swallowing structured final reports such as `/research`.

## Done when

- A regression test covers a long Codex process preamble followed by a structured `/research` title where raw final text equals streamed commentary text.
- The visible reply resolver returns the `/research` report as body text and keeps only the process preamble in Thinking/commentary.
- Runtime documentation records the boundary so future Codex `text_delta` changes do not collapse final bodies into Thinking.
- Focused tests, typecheck/build, diff check, review, commit, and safe restart pass.

## Milestones

### Milestone 81

Objective:
- Fix the Codex final visibility classifier so a long process preamble before a structured final report is stripped into Thinking while the report remains visible正文.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/RUNTIME.md`
- `src/reply-visibility.ts`
- `tests/reply-visibility.test.ts`
- `tests/stream-presentation.test.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- --run tests/reply-visibility.test.ts tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-08: Production log for the Cloudflare `/research` turn shows `rawFinalLength=5287`, `visibleTextLength=0`, `commentaryTextLength=5287`, followed by `Message sent length: 0`; the final report existed but was classified entirely as Thinking/commentary.
- 2026-05-08: Added a RED regression for long duplicated Codex process narration followed by `**/research｜NET｜us｜2026-05-08**`; it initially reproduced the incident with empty `visibleText`.
- 2026-05-08: Updated `reply-visibility` so strong structured report headings (`/research` and 港股 IPO 池) split long process preambles into Thinking/commentary while keeping the report body visible; preserved process-only duplicate handling.

Validation status:
- passed
  - `npm test -- --run tests/reply-visibility.test.ts`: failed before the fix with empty `visibleText`, matching the production incident.
  - `npm test -- --run tests/reply-visibility.test.ts`: passed after the fix, 19 tests.
  - `npm test -- --run tests/reply-visibility.test.ts tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts`: passed, 79 tests. Existing Feishu CardKit fallback logs appeared but tests passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed. Existing Vite chunk-size warning appeared.
  - `git diff --check`: passed.
  - `./scripts/review.sh`: passed. Existing `LC_ALL` locale warning appeared and the script requested semantic review.

Review status:
- passed 2026-05-08: scope stayed within Milestone 81. The diff targets the final visibility boundary only, keeps Codex `text_delta` out of answer buffers, preserves process-only duplicate finals, and documents the structured-report exception for `/research` / 港股 IPO 池 titles.

Risks / Notes / Handoff:
- Runtime code changed; after commit, apply with the normal safe restart path.
- The structured-boundary exception is deliberately narrow to `/research` and 港股 IPO 池 headings to avoid turning arbitrary long process logs into正文.

---

# Stock Watch Snapshot Readability

## Goal

- Make the Feishu stock-watch full snapshot readable at a glance by separating alerts, losers, gainers, and flat items, with clear direction and move-size labels.

## Done when

- The scheduled stock-watch script keeps the same read-only API polling path and push gating.
- Snapshot output starts with concise counts for success,上涨,下跌,大幅, and异动.
- Output groups rows so alerts are first, then remaining down/up/flat items sorted by move severity.
- Focused tests, diff check, review, and commit pass.

## Milestones

### Milestone 80

Objective:
- Collapse Codex `Thinking` and `过程` presentation into one Thinking lane, and classify terminal process preambles before rendering so the answer body only contains the actual reply.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/RUNTIME.md`
- `src/reply-visibility.ts`
- `src/feishu-streaming-card.ts`
- `src/index.ts`
- `web/src/components/chat/StreamingDisplay.tsx`
- `tests/reply-visibility.test.ts`
- `tests/stream-presentation.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/chat-streaming-store.test.ts`

Validation:
- `npm test -- --run tests/reply-visibility.test.ts tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts tests/chat-streaming-store.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-08: User clarified the desired model: classify events as they arrive instead of guessing the last assistant message, and merge `Thinking` and `过程` into one user-facing Thinking concept.
- 2026-05-08: Added RED coverage for process-only terminal finals, long duplicate process finals, and Feishu cards rendering Codex commentary in `Thinking` without a separate `过程` panel.
- 2026-05-08: Implemented the merged lane: Feishu/Web now render `thinkingText` plus Codex `commentaryText` in one `Thinking` section; process-only terminal finals stay in commentary with an empty-body completion fallback; actual answer suffixes still render as正文.

Validation status:
- passed
  - `npm test -- --run tests/reply-visibility.test.ts tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts tests/chat-streaming-store.test.ts`: passed, 84 tests. Existing Feishu test client fallback logs appeared but tests passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed. Existing Vite chunk-size warning appeared.
  - `git diff --check`: passed.
  - `./scripts/review.sh`: passed. Existing `LC_ALL` locale warning appeared but exited 0.

Review status:
- passed 2026-05-08: scope stayed within Milestone 80 after adding `PLANS/ROADMAP.md` for the durable presentation-contract update. The diff removes the separate user-facing process panel, keeps tool steps separate, preserves Codex `text_delta` outside answer buffers, and adds terminal-final classification coverage for both short and long process-only outputs.

Risks / Notes / Handoff:
- Keep tool steps as a separate execution trace. The merge applies to model thinking/process/commentary text, not tool-call step history.
- Runtime and Web code changed; after commit, apply with the normal safe restart path.

### Milestone 79

Objective:
- Stop Feishu completed cards from showing the same Codex accumulated text in both `过程` and正文 when terminal final equals the streamed presentation text.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/reply-visibility.ts`
- `src/index.ts`
- `tests/reply-visibility.test.ts`
- `tests/stream-presentation.test.ts`

Validation:
- `npm test -- --run tests/reply-visibility.test.ts tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-08: User reported completed Feishu card renders identical Codex text in the `过程` panel and main body. Host run log confirms Codex `text_delta` accumulated the same text that later arrived as terminal `success.result`.
- 2026-05-08: Added RED coverage for terminal final equal to streaming commentary and for terminal card sync clearing stale process commentary.
- 2026-05-08: Implemented final visibility de-duplication: when Codex raw/final equals streaming `commentaryText`, `reply-visibility` keeps raw/final as正文 and returns empty commentary. Terminal card sync now clears the existing `过程` panel for empty commentary, or replaces it with the explicit visible commentary when a real process prefix is detected.

Validation status:
- passed
  - `npm test -- --run tests/reply-visibility.test.ts tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts`: passed, 76 tests. Existing Feishu test client fallback logs appeared but tests passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed. Existing Vite chunk-size warning appeared.
  - `git diff --check`: passed.
  - `./scripts/review.sh`: passed. Existing `LC_ALL` locale warning appeared but exited 0.

Review status:
- passed 2026-05-08: scope stayed within Milestone 79. The fix is at final visibility/card synchronization, preserves raw/final as the only正文 source, clears duplicate process presentation at completion, and keeps real inferred commentary in the process lane.

Risks / Notes / Handoff:
- Runtime code changed; after commit, apply with the normal safe restart path.

### Milestone 78

Objective:
- Remove textual direction labels from stock-watch snapshot rows and counts, replacing them with direction/magnitude emoji markers.

Allowed scope:
- `PLANS/ACTIVE.md`
- `scripts/stock-watch-feishu-20260427-0208.py`
- `tests/stock-watch-feishu-20260427-0208.test.py`

Validation:
- `python3 tests/stock-watch-feishu-20260427-0208.test.py`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-08: User clarified that textual labels like `大跌` / `上涨` are still noisy; direction should be communicated primarily through up/down emoji.
- 2026-05-08: Replaced row direction words with `📈` / `📉` / `📈⚡` / `📉⚡` / `➖`, replaced header words with compact emoji counts, and changed alert reason `涨跌幅` to `幅度`.

Validation status:
- passed
  - `python3 tests/stock-watch-feishu-20260427-0208.test.py`: passed, 6 tests.
  - `git diff --check`: passed.
  - `./scripts/review.sh`: passed. It emitted the existing `LC_ALL` locale warning but exited 0.

Review status:
- passed 2026-05-08: scope stayed within Milestone 78. The diff only changes stock-watch presentation text and focused assertions; polling, thresholds, state persistence, and read-only API usage are unchanged.

Risks / Notes / Handoff:
- Completed as a presentation-only change; no service restart required for the next scheduled script run.

### Milestone 77

Objective:
- Improve `scripts/stock-watch-feishu-20260427-0208.py` snapshot presentation so Feishu messages expose direction, magnitude, and alert priority without changing polling or trading behavior.

Allowed scope:
- `PLANS/ACTIVE.md`
- `scripts/stock-watch-feishu-20260427-0208.py`
- `tests/stock-watch-feishu-20260427-0208.test.py`

Validation:
- `python3 tests/stock-watch-feishu-20260427-0208.test.py`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-08: User reported full snapshot rows are all numeric and hard to scan; identified the formatter in `scripts/stock-watch-feishu-20260427-0208.py`.
- 2026-05-08: Added direction/magnitude display rows and grouped output: alerts first, then remaining down/up/flat rows sorted by move severity.
- 2026-05-08: Added regression coverage for a mixed snapshot with one large-down alert, one change-point alert, one ordinary loser, and one gainer.

Validation status:
- passed
  - `python3 tests/stock-watch-feishu-20260427-0208.test.py`: passed, 6 tests.
  - `git diff --check`: passed.
  - `./scripts/review.sh`: passed. It emitted the existing `LC_ALL` locale warning but exited 0.

Review status:
- passed 2026-05-08: scope stayed within Milestone 77. The diff is presentation-only for the watch script, preserves the read-only API polling path and push gating, and adds focused coverage for grouped Feishu snapshot output. No blocking regression or contract issue found.

Risks / Notes / Handoff:
- Completed as a presentation-only change. The script remains read-only and continues using `stock-analysis-api/scripts/poll_realtime_quotes.py`.

---

# Codex Feishu Process / Body Presentation

## Goal

- Keep Codex process narration out of Feishu/Web answer bodies by routing `text_delta` presentation streams into a dedicated process/commentary lane, with readable process formatting in Feishu cards.

## Done when

- Raw Codex stream logs and local code paths show `text_delta` is treated as process/presentation text, not canonical answer text.
- Feishu cards render Codex process text in a separate process panel, not in the main body; long process text is segmented instead of one dense paragraph.
- Web streaming snapshots and disk recovery buffers do not store Codex process narration in `partialText`.
- Focused tests, build/typecheck as needed, `git diff --check`, and `./scripts/review.sh` pass.

## Milestones

### Milestone 76

Objective:
- Fix Codex `text_delta` presentation routing so process narration is never accumulated as answer body, and improve Feishu process panel readability for long Codex narration.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/RUNTIME.md`
- `shared/stream-presentation.ts`
- `src/index.ts`
- `src/feishu-streaming-card.ts`
- `web/src/components/chat/StreamingDisplay.tsx`
- `tests/stream-presentation.test.ts`
- `tests/chat-streaming-store.test.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- --run tests/stream-presentation.test.ts tests/chat-streaming-store.test.ts tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-08: User reported Feishu card still mixes正文 and过程, with Codex process narration rendered as a dense main-body paragraph.
- 2026-05-08: Raw host logs confirm Codex emits process narration as token-level `text_delta` events, e.g. separate deltas for `我` / `会` / `用` / backticked skill names, followed by tool events and `Context compacted`; these deltas carry runtime identity but no stable answer/process message boundary.
- 2026-05-08: Root cause found in shared presentation routing: `shared/stream-presentation.ts` still classifies every `text_delta` as `answer`, so Codex process text enters `answerText` and then propagates to Web snapshots, streaming buffers, terminal visibility heuristics, and fallback paths even though the Feishu card feed already avoids direct Codex live answer appends.
- 2026-05-08: Implemented source-level routing: Codex `text_delta` now accumulates only in `commentaryText`; Feishu feeds that lane into the “过程” collapsible panel; Web streaming labels the same lane as “过程”; Feishu process panel text is sentence-split for dense Chinese narration.

Validation status:
- failed as expected 2026-05-08:
  - `npm test -- --run tests/stream-presentation.test.ts tests/chat-streaming-store.test.ts tests/feishu-streaming-card.test.ts` failed before implementation because Codex `text_delta` still entered `answerText`, Feishu did not call `appendCommentary`, and the process panel still used the old label/raw paragraph body.
- passed 2026-05-08:
  - `npm test -- --run tests/stream-presentation.test.ts tests/chat-streaming-store.test.ts tests/feishu-streaming-card.test.ts`
  - `npm test -- --run tests/reply-visibility.test.ts tests/streaming-turn-boundary.test.ts tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-08: scope stayed within Milestone 76; the diff changes only presentation routing/rendering, docs, and focused tests. Codex terminal raw final remains the only answer source; Codex `text_delta` now stays out of answer buffers and renders as a separate process lane. No blocking hygiene, validation, or contract issue found.

Risks / Notes / Handoff:
- Preserve the terminal raw final as the only canonical Codex answer. Codex `text_delta` may be displayed as process/commentary, but must not become `answerText` or override final visible text.

### Milestone 75

Objective:
- Fix Feishu/Web assistant footer elapsed time so a new streaming turn cannot inherit a stale start timestamp from a previous completed turn or long-lived runner.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `tests/streaming-turn-boundary.test.ts`

Validation:
- `npm test -- --run tests/streaming-turn-boundary.test.ts tests/streaming-runtime-meta.test.ts tests/assistant-meta-footer.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-06: User reported Feishu footer showing an impossible `27m` duration and suspected elapsed-time accumulation.
- 2026-05-06: Root cause investigation found the turn boundary helper already resets elapsed start time when an existing `turnId` / `messageCursor.id` changes, but not when a previously cleared boundary first observes the next turn id/cursor. After a completed turn clears ids but leaves the old `startedAtMs`, the next turn can inherit the stale start if route reset did not run before the first stream event.

Validation status:
- failed as expected 2026-05-06:
  - `npm test -- --run tests/streaming-turn-boundary.test.ts` failed because a cleared boundary retained `startedAtMs=1000` instead of resetting to `60000` when first binding the next cursor.
- passed 2026-05-06:
  - `npm test -- --run tests/streaming-turn-boundary.test.ts tests/streaming-runtime-meta.test.ts tests/assistant-meta-footer.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-06: scope stayed within Milestone 75; the fix changes only turn-boundary elapsed-time binding, with focused regression coverage and the runtime footer contract updated. No blocking scope, hygiene, or contract issue found.

Risks / Notes / Handoff:
- This fixes stale elapsed-time inheritance when the next turn first binds `turnId` / `messageCursor.id` after completed-state cleanup. Applying it to live Feishu requires the normal Cli Claw restart path after commit.

### Milestone 74

Objective:
- Fix Codex remote compact task error recognition for `unknown_parameter safety_identifier`, so cli-claw surfaces a concise context-compression failure instead of raw JSON.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/agent-output-parser.ts`
- `container/agent-runner/src/codex-session-runtime.ts`
- `tests/agent-output-parser.test.ts`
- `tests/codex-session-runtime.test.ts`
- `docs/RUNTIME.md`

Validation:
- `npm test -- --run tests/codex-session-runtime.test.ts tests/agent-output-parser.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-06: User asked whether the Codex context-compression recognition failure had been fixed. Confirmed it had not been touched by the prior stock-analysis migration.
- 2026-05-06: Root cause: cli-claw already formats common Codex context-window/quota/auth errors, but does not recognize JSON-RPC `Internal error` wrapping `Error running remote compact task` with `unknown_parameter` / `safety_identifier`, so the raw JSON reaches the visible card.
- 2026-05-06: Added RED coverage in `tests/codex-session-runtime.test.ts`; focused test fails because `formatCodexRuntimeError()` returns the raw JSON.
- 2026-05-06: Implemented remote compact parameter-error classification in both Codex ACP runtime formatting and host stderr formatting; updated `docs/RUNTIME.md` to make raw compact diagnostics non-user-visible.

Validation status:
- failed as expected 2026-05-06:
  - `npm test -- --run tests/codex-session-runtime.test.ts`
- passed 2026-05-06:
  - `npm test -- --run tests/codex-session-runtime.test.ts tests/agent-output-parser.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-06: scope stayed within Milestone 74; the fix classifies Codex remote compact `unknown_parameter safety_identifier` errors at both ACP runtime and host stderr boundaries; tests cover both paths and assert raw JSON markers are not user-visible; docs now record the runtime-error presentation contract. No blocking hygiene or regression issue found.

Risks / Notes / Handoff:
- This fix should classify and present the runtime failure; it does not change Codex upstream compact request parameters because `safety_identifier` is not generated by cli-claw code.
- Applying the fix to the running service requires the normal cli-claw restart path after build/commit.

### Milestone 73

Objective:
- Replace the report-specific Feishu Markdown hard-break workaround with first-class Schema 2 card rendering for compact reports, so `/hkipo` reports use the same interactive-card path as normal Feishu messages without report-specific `<br>` injection in the global Markdown optimizer.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/feishu-markdown-style.ts`
- `src/feishu-streaming-card.ts`
- `tests/feishu-markdown-style.test.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- --run tests/feishu-markdown-style.test.ts tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-05: User rejected the "safe"/workaround framing and clarified the target: reports should be rendered as normal Feishu message cards, not via a degraded or tricky Markdown side path.
- 2026-05-05: Added RED coverage proving Schema 2 Markdown still injected report-specific `<br>` and completed `/hkipo` cards still rendered the whole report as one markdown element.
- 2026-05-05: Removed compact-report hard-break injection from the global Markdown optimizer and moved compact report layout into Schema 2 card content construction, where each report line is rendered as a native `markdown` element on the normal interactive-card path.
- 2026-05-05: Updated `docs/RUNTIME.md` to make native card elements the durable report-rendering contract and explicitly reject separate "safe"/degraded report formats.

Validation status:
- passed 2026-05-05:
  - `npm test -- --run tests/feishu-markdown-style.test.ts tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-05: scope stayed inside Milestone 73; normal Feishu card send paths remain unchanged; compact `/hkipo` reports now use native Schema 2 markdown elements instead of global `<br>` rewriting; tests cover both bold and plain report headings plus optimizer non-injection; docs match the new presentation contract. No blocking hygiene or regression issue found.

Risks / Notes / Handoff:
- Keep the normal Feishu card send path unchanged; only move compact report layout handling from Markdown post-processing into card element construction.
- Build still emits the existing Vite large-chunk warning, but exits successfully.

### Milestone 72

Objective:
- Fix the current Feishu `/hkipo` completed-card presentation regression: tool `steps` must be the first process panel, `Thinking` must sit directly below it, and compact report line breaks must survive Feishu Markdown rendering.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/feishu-markdown-style.ts`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`
- Focused formatting tests if existing coverage needs a smaller unit assertion.

Validation:
- `npm test -- --run tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-05: User reported the real Feishu card still renders `Thinking` above `steps`, while the compact hkipo正文 collapses into one paragraph because single Markdown newlines do not survive Feishu rendering.
- 2026-05-05: Added RED coverage for steps being the first process element even when a system status exists, and for hkipo compact reports that use plain section headings, list bullets, and unbold ranked title lines.
- 2026-05-05: Moved system status below steps/thinking and expanded compact-report hard-break handling to bridge Feishu-normalized blank lines with `<br>` for hkipo section/rank/field boundaries.

Validation status:
- passed 2026-05-05:
  - `npm test -- --run tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-05: scope stayed within Milestone 72; process-panel ordering now puts steps first and Thinking second; compact hkipo report line breaks are renderer-side and limited to hkipo-like section/rank/field lines; docs and tests match the presentation contract. No blocking hygiene or contract issues found.

Risks / Notes / Handoff:
- The fix should be renderer-side so existing hkipo compact output remains compact without requiring blank empty lines between every field.
- Build still emits the existing Vite large-chunk warning, but exits successfully.

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
- Milestone 73

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/feishu-markdown-style.ts`
- `src/feishu-streaming-card.ts`
- `tests/feishu-markdown-style.test.ts`
- `tests/feishu-streaming-card.test.ts`

Last failure summary:
- RED tests failed as expected before implementation: Schema 2 Markdown optimizer still injected `<br>` into report-shaped lines, and completed `/hkipo` cards still rendered the entire report as one markdown element.

Suspected cause:
- Report line preservation currently lives in the generic Markdown optimizer as report-shaped `<br>` injection instead of being modeled as Feishu card element layout.

Next step:
- Commit the fix, then apply through the safe restart path.

### Milestone 74

Objective:
- Fix Feishu assistant footer duration so elapsed time is scoped to the current streaming turn, not the whole long-running agent handler.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `tests/streaming-turn-boundary.test.ts`
- Focused tests if needed for footer duration normalization.

Validation:
- `npm test -- --run tests/streaming-turn-boundary.test.ts tests/streaming-runtime-meta.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-06: User reported Feishu footer showing an impossible 27m elapsed time. Root cause investigation found the SDK cumulative duration normalization exists, but the long-running conversation-agent path keeps one handler-level start timestamp while turn boundaries reset text/thinking only; follow-up turns therefore inherit earlier elapsed time.
- 2026-05-06: Added RED coverage for turn-boundary elapsed start reset; it failed because `startedAtMs` was not tracked.
- 2026-05-06: Added per-turn `startedAtMs` to streaming boundary state and changed main/conversation usage normalization plus provisional footer patches to use the current turn start.
- 2026-05-06: Updated `docs/RUNTIME.md` to state footer duration is scoped to the current streaming turn.

Validation status:
- passed 2026-05-06:
  - `npm test -- --run tests/streaming-turn-boundary.test.ts tests/streaming-runtime-meta.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-06: scope stayed within Milestone 74; footer duration now follows the same turn boundary as presentation/thinking state; the SDK cumulative duration path remains normalized, and late usage patches cannot reintroduce handler-level elapsed time. Build still emits the existing Vite large-chunk warning, but exits successfully.

Risks / Notes / Handoff:
- This fixes the accumulation path for current and future streaming turn boundaries. It does not rewrite old already-sent Feishu cards that displayed an inflated footer.
