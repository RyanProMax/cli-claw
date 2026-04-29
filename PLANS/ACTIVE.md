# Feishu Streaming Card Parity

## Goal

- Fix Feishu streaming card turn-boundary residue so old tool steps cannot appear on a new user message.
- Make Codex Feishu streaming cards show live body text instead of waiting for final completion.
- Keep terminal Feishu streaming cards useful by retaining collapsed thinking and steps like runclaw.
- Keep static cards as fallback only; do not remove safety paths that prevent lost IM replies.
- Clarify commentary as an internal presentation lane while improving card output behavior.

## Done when

- Same-source IPC turns reset card presentation state and cannot reuse prior tool steps.
- Codex `text_delta` updates the live card body while commentary remains separated.
- Completed cards retain collapsed steps and thinking when those signals exist.
- Existing static fallback behavior still works for streaming failure and non-streaming sends.
- Focused tests, typecheck/build, diff check, and review pass.

## Milestones

### Milestone 53

Objective:
- Align Feishu streaming cards with runclaw-style live/terminal presentation while preserving Cli Claw delivery safety.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/index.ts`
- `src/feishu-streaming-card.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/stream-presentation.test.ts`
- `tests/streaming-turn-boundary.test.ts`

Validation:
- `npm test -- --run tests/feishu-streaming-card.test.ts tests/stream-presentation.test.ts tests/streaming-turn-boundary.test.ts tests/feishu-e2e.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed 2026-04-29:
  - `npm test -- --run tests/stream-presentation.test.ts tests/feishu-streaming-card.test.ts tests/streaming-turn-boundary.test.ts` passed (3 files, 50 tests; expected mocked CardKit fallback logs emitted).
  - `npm test -- --run tests/feishu-streaming-card.test.ts tests/stream-presentation.test.ts tests/streaming-turn-boundary.test.ts tests/feishu-e2e.test.ts` passed (4 files, 59 tests; expected Feishu mock logs emitted).
  - `npm run typecheck` passed.
  - `npm run build` passed; Vite emitted existing large chunk warning.
  - `git diff --check` passed.
  - `./scripts/review.sh` passed format/diff hygiene and requested semantic review.

Review status:
- passed 2026-04-29; reviewed against `RUNBOOKS/Review.md` for scope, same-source stale state isolation, Codex commentary/body separation, runclaw terminal parity, static fallback preservation, and regression coverage.

Risks / Notes / Handoff:
- Static cards intentionally remain as fallback for Feishu API failures and non-streaming command replies.
- Same-source IPC now resets the card controller before the next turn; active old cards are asynchronously aborted with `新的回复已开始`.
- Codex live body streaming still suppresses obvious process preambles and internal-context markers until a real answer boundary is available.
- Existing Vitest `MaxListenersExceededWarning` may appear in Feishu test groups; judge by exit code/assertions.
