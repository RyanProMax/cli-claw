# Feishu Card Residue Root Cause Trace

## Goal

- Find the remaining root cause of Feishu cards showing old `/hkipo` stock-analysis content after a new ordinary Feishu message.
- Add structured diagnostics at the failing boundaries so one Feishu `messageId` can be traced through DB, queue, runner stream events, card state, and final delivery.
- Fix the root cause with a real-flow regression that fails on the observed stale-card behavior and passes after the fix.

## Done when

- Live evidence identifies whether the stale content is coming from runtime session reuse, stale streaming buffer/card state, stale SDK event routing, or Feishu delivery/update targeting.
- Logs include enough compact fields to connect current user message id, source jid, turn id, session id, stream/card cursor, card message id, and visible text hash/preview.
- Feishu card payload for a new ordinary message cannot include old stock-analysis snippets, even when stale streaming/card state exists before processing.
- Validation, review, commit, safe restart, and residue check pass.

## Milestones

### Milestone 64

Objective:
- Remove external historical-context/replay coupling from the runtime stream path: Codex ACP session recovery must remain internal to the runner and must not emit historical execution events to the host; the host should no longer depend on pre-init replay filtering as the primary fix.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/ARCHITECTURE.md`
- `docs/MEMORY.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `container/agent-runner/src/index.ts`
- `container/agent-runner/src/codex-session-runtime.ts`
- `tests/codex-session-runtime.test.ts`
- `tests/feishu-e2e.test.ts`

Validation:
- `npm test -- --run tests/codex-session-runtime.test.ts`
- `npm test -- --run tests/feishu-e2e.test.ts -t "routes current Feishu stream events without replay gates"`
- `npm test -- --run tests/feishu-e2e.test.ts -t "sends current Codex raw final to Feishu when presentation contains stale transcript"`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-05：User rejected adding per-run protocol fields and requested complete removal of external historical-context/replay coupling. Revised root contract: continuity belongs only to the underlying runtime session; Cli Claw only stores the session handle and current pending turn, and historical execution events must not cross the runner output boundary.
- 2026-05-05：Added runner-side contract test for Codex ACP session updates: updates are private until a live prompt is active.
- 2026-05-05：Changed Codex runner so `loadSession` / session setup updates are ignored before `connection.prompt()` starts, and the current message cursor is only attached once the current turn is active.
- 2026-05-05：Removed host-side pre-init stream suppression gates from main and conversation-agent paths; host now keeps only stale `messageCursor.id` route protection.
- 2026-05-05：Replaced replay-gate Feishu tests with current-live-stream and stale-cursor route tests that match the simplified architecture.

Validation status:
- passed 2026-05-05:
  - failed as expected before implementation: `npm test -- --run tests/codex-session-runtime.test.ts`
  - `npm test -- --run tests/codex-session-runtime.test.ts`
  - `npm test -- --run tests/feishu-e2e.test.ts -t "routes current Feishu stream events without replay gates"`
  - `npm test -- --run tests/feishu-e2e.test.ts -t "sends current Codex raw final to Feishu when presentation contains stale transcript"`
  - extra adjacent check: `npm test -- --run tests/feishu-e2e.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-05: scope matches Milestone 64; Codex replay/history suppression moved from host card ingestion to runner session-update emission boundary; no new per-turn protocol fields were added; host pre-init gate code and tests were removed rather than layered; stale cursor route protection remains because it is message routing, not context management; docs now define runner stdout as current-turn live output only.

Handoff:
- Codex session continuity remains internal to ACP/Codex through the stored session id. Cli Claw no longer republishes session recovery/history updates as stream events, and the Feishu/Web presentation path no longer depends on pre-init replay filtering for correctness. If old steps appear again after this change, the next place to inspect is whether ACP emits old updates during `connection.prompt()` itself rather than during `loadSession` / setup.

### Milestone 63

Objective:
- Fix the remaining Feishu streaming-card contamination where reused Codex sessions replay old tool steps with the current cursor before the current `init` event.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `tests/feishu-e2e.test.ts`

Validation:
- `npm test -- --run tests/feishu-e2e.test.ts -t "suppresses current-cursor replayed tool steps before current Feishu cursor init"`
- `npm test -- --run tests/feishu-e2e.test.ts -t "suppresses cursorless Codex replayed tool steps"`
- `npm test -- --run tests/feishu-streaming-card.test.ts tests/stream-presentation.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-05：User screenshot for message "每个小点..." shows live card "Working on it (829 steps)" with old 罗博特科/MiniMax steps despite Milestone 62.
- 2026-05-05：DB/lifecycle confirms the raw final for the 03:19Z turn was current and correct (`rawFinalLength=1219`), while Codex presentation text was again stale/huge (`presentationAnswerLength=44946`).
- 2026-05-05：Log timing shows `stream_started` was delayed until 03:20:00Z, while the message arrived at 03:19:32Z. This is consistent with Codex session replay events being processed before the current `init/messageCursor`.
- 2026-05-05：Root cause refined. The previous fix only dropped cursor-less replay before current init. ACP `loadSession` replay can be stamped by the runner with the current cursor before `init`, so the main process incorrectly treats old tool steps as current.
- 2026-05-05：Added RED regression for current-cursor replay before current init; old 罗博特科/MiniMax tool step entered the card before the fix. Fixed by requiring the current `init/messageCursor` event, not merely a matching cursor id, to open the stream/card gate.

Validation status:
- passed 2026-05-05:
  - failed as expected before fix: `npm test -- --run tests/feishu-e2e.test.ts -t "suppresses current-cursor replayed tool steps"`
  - `npm test -- --run tests/feishu-e2e.test.ts -t "suppresses current-cursor replayed tool steps"`
  - `npm test -- --run tests/feishu-e2e.test.ts -t "suppresses cursorless Codex replayed tool steps"`
  - `npm test -- --run tests/feishu-streaming-card.test.ts tests/stream-presentation.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-05: scope matches Milestone 63; the fix tightens the existing stream gate without changing final-answer selection; regression covers the observed second failure mode where replayed stale tool events already carry the current cursor but arrive before current `init`; docs describe the stricter contract; no unrelated changes.

Handoff:
- The second recurrence was not from the stock-analysis-skill change itself. The live card was polluted because reused Codex/ACP session replay events were stamped with the current cursor before current `init`, bypassing the Milestone 62 cursor-less replay guard. Feishu/Web stream ingestion now drops every non-`init` event until the current `init/messageCursor` is observed, even when that event already carries the current cursor.

### Milestone 62

Objective:
- Trace and fix Feishu streaming card step explosion, cross-turn step contamination, and completed-card step loss after a simple git push request.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `src/feishu-streaming-card.ts`
- `src/stream-presentation.ts`
- `tests/feishu-e2e.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/stream-presentation.test.ts`
- Related persistence/log inspection files only if root cause requires them.

Validation:
- `npm test -- --run tests/feishu-e2e.test.ts -t "suppresses cursorless Codex replayed tool steps"`
- `npm test -- --run tests/feishu-streaming-card.test.ts tests/stream-presentation.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-04：User screenshot for message "把当前改动的提交push到远端" shows live card "Working on it (731 steps)" with old stock-analysis step text including 罗博特科 and MiniMax, while the requested task only needed git status/log/push/status.
- 2026-05-04：Need determine whether the bad steps originate from stale runtime stream events, stale card state reuse, missing per-turn step reset, or final-card rendering dropping step panels.
- 2026-05-04：DB/lifecycle confirmed the final raw answer for push was correct (`rawFinalLength=256`), but Codex presentation answer was stale/huge (`presentationAnswerLength=41863`) from reused session history. This explains why final text was right while live card progress was polluted.
- 2026-05-04：Root cause identified. Main stream suppression only activated after seeing an event with an old cursor. Reused Codex sessions can emit cursor-less replayed tool/text events before the current `init/messageCursor`, so those old steps entered the new Feishu card.
- 2026-05-04：Added regression for cursor-less Codex replayed tool steps before current Feishu cursor init; verified RED, then fixed by enabling the cursor-match gate as soon as a new Feishu streaming turn starts.
- 2026-05-04：Aligned suppression logs so runtime diagnostics say cursor-less events are dropped before the current cursor matches, not only after an explicit stale cursor.

Validation status:
- passed 2026-05-04:
  - `npm test -- --run tests/feishu-e2e.test.ts -t "suppresses cursorless Codex replayed tool steps"`
  - `npm test -- --run tests/feishu-streaming-card.test.ts tests/stream-presentation.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-04: scope matches Milestone 62; the fix addresses the cursor-less replay root cause at the stream ingestion boundary; regression asserts old 罗博特科/MiniMax snippets never enter any Feishu card payload and the completed card retains the current `git push origin main` step; docs updated for the streaming-card cursor gate contract; no leftover debug code or unrelated scope changes.

Handoff:
- Not expected behavior: the 731-step live card came from reused Codex session replay before current cursor initialization, not from the push task. The raw final answer for the push was correct, but old cursor-less tool/text stream events polluted the live card. The cursor gate now starts as soon as a new Feishu streaming turn starts and only allows cursor-less events after the current `init/messageCursor` is observed.

### Milestone 61

Objective:
- Fix skill command Python environment drift after service restart.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/COMMAND.md`
- `src/skill-command-dispatch.ts`
- `tests/skill-command-dispatch.test.ts`

External coordinated scope:
- `/Users/ryan/projects/stock-analysis-skill/AGENTS.md`
- `/Users/ryan/projects/stock-analysis-skill/README.md`
- `/Users/ryan/projects/stock-analysis-skill/SKILL.md`
- `/Users/ryan/projects/stock-analysis-skill/commands/research.py`
- `/Users/ryan/projects/stock-analysis-skill/references/cli.md`
- `/Users/ryan/projects/stock-analysis-skill/references/research.md`
- `/Users/ryan/projects/stock-analysis-skill/tests/test_research_command.py`
- `/Users/ryan/projects/stock-analysis-skill/PLANS/ACTIVE.md`
- `/Users/ryan/projects/stock-analysis-skill/PLANS/ROADMAP.md`

Validation:
- `npm test -- --run tests/skill-command-dispatch.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`
- In stock-analysis-skill: `python3 -m unittest tests/test_research_command.py -v`
- In stock-analysis-skill: `python3 -m py_compile scripts/*.py commands/*.py`
- In stock-analysis-skill: `git diff --check`

Status:
- done

Progress:
- 2026-05-04：Root cause identified. Skill command executors declared bare `python3`, so the host used whichever Python was visible in the service process PATH after restart instead of the skill-local `.venv`.
- 2026-05-04：Second root cause identified. `/research` generated bare `uv run python ...`, so the agent-facing stock-analysis-api command also depended on post-restart PATH.
- 2026-05-04：Implemented host-side resolution so bare `python` / `python3` skill executors prefer the skill root `.venv` Python before falling back to PATH.
- 2026-05-04：Implemented stock-analysis-skill `uv` resolution via `STOCK_ANALYSIS_UV` / `UV_BIN` / `UV` / PATH / `$HOME/.local/bin/uv` / `$HOME/.cargo/bin/uv`; generated commands now use absolute `uv`, or explicitly fail preflight.

Validation status:
- passed 2026-05-04:
  - `npm test -- --run tests/skill-command-dispatch.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`
  - stock-analysis-skill `python3 -m unittest tests/test_research_command.py -v`
  - stock-analysis-skill `python3 -m unittest discover -s tests -v`
  - stock-analysis-skill `python3 -m py_compile scripts/*.py commands/*.py`
  - stock-analysis-skill `git diff --check`

Review status:
- passed 2026-05-04: scope matches Milestone 61; dispatch contract is documented in `docs/COMMAND.md`; regression covers skill-local `.venv` selection; external skill tests cover absolute `uv` and missing-`uv` preflight.

Handoff:
- Bare `python` / `python3` skill executors now prefer the skill root `.venv` Python. `/research` generated stock-analysis-api commands now use an absolute `uv`; if no `uv` is resolvable, the prompt fails preflight instead of relying on restart-sensitive PATH.

### Milestone 60

Objective:
- Fix `/research MINIMAX` routing and Feishu/Codex output visibility diagnostics after the MiniMax incident.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/reply-visibility.test.ts`

External coordinated scope:
- `/Users/ryan/projects/stock-analysis-skill/commands/research.py`
- `/Users/ryan/projects/stock-analysis-skill/references/research.md`
- `/Users/ryan/projects/stock-analysis-skill/SKILL.md`
- `/Users/ryan/projects/stock-analysis-skill/tests/test_research_command.py`
- `/Users/ryan/projects/stock-analysis-skill/PLANS/ACTIVE.md`
- `/Users/ryan/projects/stock-analysis-skill/PLANS/ROADMAP.md`

Validation:
- `npm test -- --run tests/feishu-streaming-card.test.ts tests/reply-visibility.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`
- In stock-analysis-skill: `python3 -m unittest tests/test_research_command.py`
- In stock-analysis-skill: `python3 -m py_compile scripts/*.py commands/*.py`
- In stock-analysis-skill: `git diff --check`

Status:
- done

Progress:
- 2026-05-04：Root cause identified. `/research` executor classifies any bare uppercase ASCII input matching `[A-Z][A-Z0-9.-]{0,9}` as US before upstream identity correction. `MINIMAX` therefore becomes `US.MINIMAX` and gets a US-only prompt/title even though public sources identify the listed equity as HK `00100` / ADR `MMXGY`.
- 2026-05-04：Second root cause identified. Completed Feishu cards can render Codex commentary/thinking/tool auxiliary panels before the main final text, so process text can visually precede a report title even if it is technically not in the final markdown body.
- 2026-05-04：Need additional structured Codex final visibility logs including raw final fields, presentation lengths, commentary strip state, first visible line, and whether the visible body starts with `/research`.
- 2026-05-04：Implemented visible-reply stripping for process text before bold `/research` titles; completed Feishu cards now render final body before auxiliary details.
- 2026-05-04：Added structured Codex final visibility logs for main turns and conversation agents, covering raw final, presentation answer/commentary, resolved visible text, stripped commentary, runtime identity, turn/session/message ids, and research-title detection.

Validation status:
- passed 2026-05-04:
  - `npm test -- --run tests/reply-visibility.test.ts tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check` via `./scripts/review.sh`
  - `./scripts/review.sh`
  - stock-analysis-skill `python3 -m unittest tests/test_research_command.py`
  - stock-analysis-skill `python3 -m py_compile scripts/*.py commands/*.py` (rerun with approval after sandbox denied `__pycache__` writes)
  - stock-analysis-skill `git diff --check`

Review status:
- passed 2026-05-04: semantic diff review completed against the MiniMax incident scope; no unresolved review findings.

Handoff:
- `/research MINIMAX` is no longer preclassified as `US.MINIMAX`; the stock-analysis-skill executor emits a `待解析` prompt that requires identity/source-field inspection and HK rerouting when HK is the only reliable match.
- Cli Claw strips Codex process preambles before bold `/research` titles and keeps completed-card auxiliary panels after the report body.
- New `Codex final visible reply fields resolved` logs are the first place to inspect if a future Feishu report still shows raw final/presentation/commentary boundary issues.

### Milestone 56

Objective:
- Trace and fix remaining Feishu stale-card residue after restart.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/MEMORY.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `src/web.ts`
- `src/web-context.ts`
- `src/feishu-streaming-card.ts`
- `src/stream-presentation.ts`
- `src/feishu.ts`
- `tests/feishu-e2e.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/restart-recovery.test.ts`
- `tests/stream-presentation.test.ts`

Validation:
- `npm test -- --run tests/feishu-e2e.test.ts tests/feishu-streaming-card.test.ts tests/restart-recovery.test.ts tests/stream-presentation.test.ts tests/reply-visibility.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed
  - `npm test -- --run tests/feishu-e2e.test.ts tests/feishu-streaming-card.test.ts tests/restart-recovery.test.ts tests/stream-presentation.test.ts tests/reply-visibility.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed
  - Subagent review found Web active-runner IPC was still an uncovered pollution path.
  - Fixed the Web IPC path and added a regression proving polluted primary sessions bypass active runner IPC.

Risks / Notes / Handoff:
- User screenshot at 2026-04-29 ~12:02 shows a new Feishu message "那飞书卡片终态为什么没有 thinking" followed by a card whose tool trace/body still contains old stock-analysis `/hkipo` output.
- Previous milestone isolated `assistant_prompt` runtime sessions and passed the synthetic next-turn session regression; therefore this round must prove the actual remaining source before changing code.
- Root cause confirmed: a primary runtime session previously polluted by an `assistant_prompt` turn could remain selected for later ordinary turns after an intermediate ordinary reply. Feishu exposed the residue, but Web active-runner IPC could also inject messages into the polluted runtime. The fix clears/bypasses polluted primary runtime sessions across process, message-loop IPC, and Web IPC paths.
- Added diagnostics at Feishu stream/card feed boundaries with turn id, session id, cursor id, active cursor id, and presentation lengths.

### Milestone 57

Objective:
- Fix Feishu streaming card parity: do not render a dangling one-character Codex process prefix as body, and keep all tool step lines instead of truncating at five.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `src/feishu-streaming-card.ts`
- `tests/stream-presentation.test.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- --run tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed
  - `npm test -- --run tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed

Risks / Notes / Handoff:
- User screenshot at 2026-04-30 ~10:10 shows Feishu card main body as only `我` while Web shows the full process sentence. Hypothesis: the Feishu Codex preamble guard suppresses `我会...` only after enough characters arrive, but it already streamed the first ambiguous `我`.
- Same screenshot shows only 4 steps, and user reports a 5-step cap. Implementation currently uses `MAX_TOOL_DISPLAY = 5`; this is intentionally limiting Feishu below Web's trace.
- Root cause confirmed and fixed: `我` was allowed before the Codex preamble detector had enough characters to match `我会...`; Feishu steps were hard-limited by `MAX_TOOL_DISPLAY = 5` and completed tools could age out within the same turn.

### Milestone 58

Objective:
- Root-cause and fix the remaining Feishu stale-card residue where a new ordinary Feishu message is followed by an old Futu/stock-analysis streaming card.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/ARCHITECTURE.md`
- `docs/MEMORY.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `src/group-queue.ts`
- `src/feishu-streaming-card.ts`
- `tests/feishu-e2e.test.ts`
- `tests/restart-recovery.test.ts`
- `tests/feishu-streaming-card.test.ts`

Validation:
- `npm test -- --run tests/feishu-e2e.test.ts tests/restart-recovery.test.ts tests/feishu-streaming-card.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed
- `npm test -- --run tests/stream-presentation.test.ts` passed after RED/GREEN for idle streaming session rebuild.
- `npm test -- --run tests/feishu-e2e.test.ts` passed after adding the current-cursor Codex replay regression.
- `npm test -- --run tests/feishu-e2e.test.ts tests/restart-recovery.test.ts tests/feishu-streaming-card.test.ts tests/stream-presentation.test.ts` passed: 107 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `./scripts/review.sh` passed its automated checks.

Review status:
- passed
- Manual review gate passed per `RUNBOOKS/Review.md`: scope stayed within allowed files; docs updated in `docs/RUNTIME.md`; regression tests cover the observed Feishu current-cursor stale Codex presentation stream; no blocking findings.

Risks / Notes / Handoff:
- User screenshot at 2026-04-30 ~10:37 shows a new Feishu request about `agent-skills`, but the bot card below it contains stale Futu/OpenD analysis from the previous task. This looks like stale runtime/card output continuing after the new inbound event, not just DB history injection.
- Root cause confirmed from production logs: final DB reply used the current raw Codex final, but `streamingPresentationText.answerText` had grown to 2598 chars and contained replayed previous-task presentation content from the reused Codex session. The Feishu card was still live-rendering Codex `text_delta`, so stale ACP presentation text could enter the card even though final persistence was correct.
- Fix: Feishu cards no longer write Codex `text_delta` body/commentary live; they still live-render thinking/tools/hooks/status/todos and write the main body only from terminal raw/final output. Also fixed the idle-card rebuild predicate so a fresh idle streaming session is not treated as stale before the first visible event.

### Milestone 59

Objective:
- Inspect the current runtime for residual Cli Claw agent/container/process state and root-cause the Feishu card footer elapsed-time bug where durations accumulate across turns instead of measuring each conversation turn independently.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/RUNTIME.md`
- `src/feishu-streaming-card.ts`
- `src/index.ts`
- `src/streaming-runtime-meta.ts`
- `tests/streaming-runtime-meta.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/feishu-e2e.test.ts`

Validation:
- `npm test -- --run tests/streaming-runtime-meta.test.ts tests/feishu-streaming-card.test.ts tests/feishu-e2e.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed: `npm test -- --run tests/streaming-runtime-meta.test.ts tests/feishu-streaming-card.test.ts tests/feishu-e2e.test.ts` (57 tests passed)
- passed: `npm run typecheck`
- passed: `npm run build`
- passed: `git diff --check`
- passed: `./scripts/review.sh` hygiene/format checks; semantic review completed manually below.

Review status:
- passed: scope updated to include extracted footer usage helper and its direct test; diff stays focused on Feishu card footer presentation, validation ran, no blocking hygiene/docs/contract issues found.

Risks / Notes / Handoff:
- User reported on 2026-05-02 that Feishu card footer elapsed time appears cumulative across multiple conversations, not per conversation turn.
- Also requested an environment inspection for residual processes and other runtime issues before/alongside the footer fix.
- Runtime inspection found the service healthy and one active Cli Claw runner chain; no obvious orphaned Cli Claw runner/container process. Docker CLI is not installed, so container execution mode remains unavailable on this host.
- Safe restart passed and startup cleanup removed an orphaned pre-restart runner process group (`9851`); post-restart health is `healthy` on port 3000.
- Root cause: runtime `usage` events can carry SDK/session-level cumulative `durationMs`/`numTurns`; Feishu card feeding used that value directly, so late usage patches could overwrite the per-turn provisional footer with cumulative elapsed time.
- Fix: Feishu card usage events are normalized for presentation with the current turn start timestamp before reaching `StreamingCardController`, for both main workspace runs and conversation agents. Persistence still receives the original runtime usage event.
