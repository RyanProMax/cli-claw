# Codex GPT-5.5 Metadata Diagnostic Filtering

## Goal

- Stop Codex runtime diagnostics like `Model metadata for gpt-5.5 not found...` from leaking into user-visible replies.
- Preserve normal Codex streaming output and final answer accumulation.

## Done when

- The gpt-5.5 metadata diagnostic is treated as runner/runtime noise, not answer text.
- Tests cover exact diagnostic-only chunks and diagnostic prefixes before normal answer text.
- Validation, review, safe restart, roadmap sync, and commit are complete.

## Milestones

### Milestone 1

Objective:
- Add a focused Codex ACP stream sanitizer for model-metadata diagnostics and tests around final accumulation.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `container/agent-runner/src/codex-session-runtime.ts`
- `container/agent-runner/src/index.ts`
- `tests/codex-session-runtime.test.ts`
- directly related tests only if required

Validation:
- `npm test -- --run tests/codex-session-runtime.test.ts`
- `npm run typecheck`
- `npm --prefix container/agent-runner run build:runner`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Local evidence:
  - `codex --version` is `codex-cli 0.124.0`.
  - `codex debug models` currently returns `gpt-5.5` metadata.
  - `~/.codex/models_cache.json` also contains `gpt-5.5` metadata.
  - Historical host logs show the diagnostic arriving as a Codex `agent_message_chunk`, then being accumulated into the final `success.result`.
- Root cause candidate:
  - The warning is emitted by Codex/ACP as assistant text, not by cli-claw's model picker or footer code.
  - cli-claw currently trusts every `agent_message_chunk` as answer text.
- Implemented:
  - `container/agent-runner/src/codex-session-runtime.ts` now strips known Codex runtime diagnostic prefixes from assistant chunks.
  - `container/agent-runner/src/index.ts` now suppresses fully diagnostic chunks and only streams/accumulates the sanitized visible chunk.
  - `tests/codex-session-runtime.test.ts` covers diagnostic-only chunks and diagnostic prefixes before normal answer text.
- Validation evidence:
  - `npm test -- --run tests/codex-session-runtime.test.ts`
  - `npm run typecheck`
  - `npm --prefix container/agent-runner run build:runner`
  - `git diff --check`
  - `./scripts/review.sh`
- Review result:
  - passed semantic review against `RUNBOOKS/Review.md`; scope stayed inside Codex ACP runtime diagnostic filtering.
- Safe restart:
  - `restart-2026-04-24T15-58-12-695Z-705a3f74` passed via `node dist/cli.js restart`.
  - Post-restart backend PID is `7515`; `/api/health` is healthy and `active_streaming_turns` is `{}`.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 1

Current status:
- Done. The known gpt-5.5 metadata diagnostic is filtered before Codex streaming and final accumulation.

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `container/agent-runner/src/codex-session-runtime.ts`
- `container/agent-runner/src/index.ts`
- `tests/codex-session-runtime.test.ts`

Last failure summary:
- None after validation. A broad container Prettier check also found unrelated pre-existing formatting issues in other runner files; changed files pass targeted Prettier.

Suspected cause:
- Codex/ACP emits runtime diagnostics as assistant chunks; cli-claw does not filter this known diagnostic before streaming and final accumulation.

Next step:
- Commit the focused Codex diagnostic filtering fix.
