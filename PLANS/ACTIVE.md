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
