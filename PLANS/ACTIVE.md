# Codex Model Picker Live Catalog

## Goal

- Make `/model` for Codex reflect the actual local Codex CLI catalog instead of relying on stale `~/.codex/models_cache.json` or only built-in presets.
- Keep `/model`, Feishu picker cards, Web picker data, validation, and `/status` aligned with the current effective runtime model.
- Preserve safe fallback behavior when the CLI is missing, logged out, slow, or returns malformed JSON.

## Done when

- The model source order is explicit and tested: live `codex debug models` first, local cache second, built-in presets last.
- Codex model selection accepts models discovered from the live CLI catalog.
- `/model` replies and picker choices include the current effective model context when needed.
- Docs, validation, review, commit, and safe restart are complete.

## Milestones

### Milestone 1

Objective:
- Confirm the existing `/model` data sources and the Codex CLI command that exposes the real model catalog.

Allowed scope:
- `PLANS/ACTIVE.md`
- read-only inspection of `src/runtime-model-options.ts`, `src/runtime-command-handler.ts`, `src/index.ts`, `src/feishu-streaming-card.ts`, `src/routes/groups.ts`, `src/codex-config.ts`, related tests, and local Codex CLI help/catalog output

Validation:
- Identify whether current behavior is hardcoded, cache-backed, or live CLI-backed.
- Identify the concrete live CLI command and fallback behavior.
- Name the files and tests required for the implementation.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Current evidence:
  - `src/runtime-model-options.ts` reads `~/.codex/models_cache.json` and falls back to shared built-in presets.
  - `codex debug models` exists in local Codex CLI `0.124.0` and renders the raw model catalog as JSON; `--bundled` skips refresh.
  - Local `~/.codex/config.toml` currently sets `model = "gpt-5.5"`, while the cache seen during inspection came from an older CLI client version.
  - Current local live CLI catalog returned `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, and `gpt-5.2`; the implementation must follow this real catalog and separately surface the effective current model when it differs.

### Milestone 2

Objective:
- Implement live catalog discovery and wire current effective model context into `/model` responses and picker cards.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/runtime-model-options.ts`
- `src/runtime-command-handler.ts`
- `src/index.ts`
- `src/routes/groups.ts`
- `src/feishu-streaming-card.ts` only if picker rendering needs a small compatibility fix
- directly related tests
- `docs/COMMAND.md`
- `docs/RUNTIME.md`

Validation:
- Focused runtime model/command/picker tests.
- `npm run typecheck`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Do not make `/model` block for a long time if Codex CLI is unavailable or slow; live discovery needs a short timeout and silent fallback.
- Avoid treating a stale configured model as available unless it is already the current effective model shown by Cli Claw.
- Fix implemented:
  - Codex model discovery now tries live `codex debug models` first with a bounded timeout and larger stdout buffer, then falls back to `~/.codex/models_cache.json`, then built-in preset.
  - `/model` text replies include the current effective model and available option values.
  - Feishu picker cards and Web `/model` picker fetch backend model options with current-model context.
  - Claude model options remain preset-only.
- Validation evidence:
  - `npm test -- --run tests/runtime-model-options.test.ts tests/runtime-command-handler.test.ts tests/groups-route.test.ts tests/feishu-streaming-card.test.ts`
  - `npm run typecheck`
  - `npm --prefix web run build`
  - `git diff --check`
  - `./scripts/review.sh`
  - live local check: `getAvailableRuntimeModelCatalog('codex', { currentModel: 'gpt-5.5' })` returned source `codex-cli` and values beginning with `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2`.
- Review result:
  - passed local semantic review against `RUNBOOKS/Review.md`; tightened the current-model backfill to Codex only so Claude stays preset-only.
  - follow-up semantic review found a PATCH edge case where switching from Claude to Codex could incorrectly pass the old Claude current model as the Codex current-model allowance; fixed by only carrying current-model context when the effective agent type already matches the target agent type.
  - follow-up validation passed with the new agent-switching regression test included.

### Milestone 3

Objective:
- Apply the fix to the running service and confirm `/model` now follows live CLI/current model behavior.

Allowed scope:
- `PLANS/ACTIVE.md`
- safe restart via `bun src/cli.ts restart`
- read-only post-restart logs/status checks

Validation:
- Safe restart passes.
- Post-restart `/model` data source can be verified without disrupting active user work.
- Any unverified live picker UI state is called out explicitly.

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- If an active runner is processing user work, do not send extra live IM probes unless the queue is idle.
- Pre-restart `active_streaming_turns` was `{}`.
- Safe restart `restart-2026-04-24T14-01-56-608Z-14ce081a` passed.
- Post-restart backend PID is `83028`; Feishu WebSocket and IM channel reconnected.
- Post-restart `active_streaming_turns` remained `{}`.
- No extra live Feishu/Web `/model` message was sent; backend helper verification covered the live catalog source without disturbing user channels.

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
- Done. `/model` and picker options now use live Codex CLI discovery first, cache second, presets last, while surfacing the current effective Codex model when it differs from the catalog.

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `src/index.ts`
- `src/routes/groups.ts`
- `src/runtime-command-handler.ts`
- `src/runtime-model-options.ts`
- `tests/groups-route.test.ts`
- `tests/runtime-command-handler.test.ts`
- `tests/runtime-model-options.test.ts`
- `web/src/components/chat/MessageInput.tsx`
- `web/src/lib/runtimeCommandPicker.ts`

Last failure summary:
- None after second validation. Focused tests, typecheck, Web build, diff hygiene, review script, and semantic review passed.

Suspected cause:
- Confirmed root cause: backend options were cache/preset-backed instead of live CLI-backed, and the Web picker used shared static presets. The local effective Codex model was `gpt-5.5`, while the live local Codex catalog currently did not list it.

Next step:
- Monitor whether inherited unavailable Codex models should be auto-warned or safely downgraded in a separate iteration.
