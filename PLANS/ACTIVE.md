# Runtime Configuration Command Consolidation

## Goal

- Remove standalone `/model`, `/effort`, and `/speed` commands from user-facing command dispatch and help.
- Consolidate model, reasoning effort, and Codex speed configuration under `/codex` and `/claude`, reusing one runtime configuration card/dropdown experience in Feishu and keeping Web picker behavior aligned.
- Restructure `/help` so commands are grouped by module, for example `Agent 命令`, instead of one undifferentiated `可用命令` list.

## Done when

- `/model`, `/effort`, and `/speed` no longer appear as built-in commands, no longer work as standalone runtime commands, and are absent from `/help`.
- `/codex` opens a combined Codex runtime configuration picker that can update model, reasoning effort, and speed using the existing runtime configuration persistence.
- `/claude` opens a combined Claude runtime configuration picker that can update Claude model using the same picker/card surface, without exposing unsupported Codex-only settings.
- `/help` groups built-in and skill commands by module instead of using a single `可用命令` heading.
- Feishu card actions, Web command picker behavior, docs, and focused tests all match the new command contract.

## Milestones

### Milestone 68

Objective:
- Replace standalone runtime setting commands with agent-scoped `/codex` and `/claude` configuration commands, and regroup help output by module.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `shared/runtime-command-registry.ts`
- `src/runtime-command-registry.ts`
- `src/runtime-command-handler.ts`
- `src/index.ts`
- `src/feishu.ts`
- `src/feishu-streaming-card.ts`
- `src/routes/groups.ts`
- `web/src/lib/runtimeCommandPicker.ts`
- `web/src/lib/runtimeCommandRegistry.ts`
- `web/src/components/chat/MessageInput.tsx`
- Related runtime command, Feishu card, group route, and Web picker tests.
- `tests/feishu-connection.test.ts`

Validation:
- `npm run build:shared`
- `npm test -- --run tests/runtime-command-registry.test.ts tests/runtime-command-handler.test.ts tests/groups-route.test.ts tests/feishu-streaming-card.test.ts tests/feishu-connection.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Progress:
- 2026-05-05: Started from user request to remove `/effort` `/model` `/speed`, merge settings into `/codex` `/claude`, reuse one Feishu dropdown card, and regroup `/help` by module.
- 2026-05-05: Added RED tests for grouped help, removed standalone runtime commands, combined `/codex` / `/claude` handler fallback, and one Feishu configuration card with multiple selectors; focused tests failed against the old behavior as expected.
- 2026-05-05: Implemented `/codex` and `/claude` as the only user-facing runtime configuration commands. Codex now renders model, reasoning effort, and speed in one Feishu/Web picker; Claude renders model only. `/help` now groups commands into module sections and no longer emits the `可用命令：` heading.
- 2026-05-05: Synchronized command/runtime docs and verified adjacent Web/IM slash command behavior.

Validation status:
- passed 2026-05-05:
  - `npm run build:shared`
  - `npm test -- --run tests/runtime-command-registry.test.ts tests/runtime-command-handler.test.ts tests/groups-route.test.ts tests/feishu-streaming-card.test.ts tests/feishu-connection.test.ts`
  - extra adjacent check: `npm test -- --run tests/web-slash-command.test.ts tests/im-slash-command.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
  - `./scripts/review.sh`

Review status:
- passed 2026-05-05: scope matches Milestone 68; standalone `/model` / `/effort` / `/speed` are removed from the command registry and Web picker detection; `/codex` and `/claude` reuse the same runtime selection persistence; Feishu renders one configuration card per agent command; `/help` is grouped by command module; docs are synchronized with the new command contract.

Risks / Notes / Handoff:
- Internal `selection: model | effort | speed` remains only for Feishu/Web dropdown callbacks and persistence; these are no longer user-facing slash commands.

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 68

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `shared/runtime-command-registry.ts`
- `src/feishu-streaming-card.ts`
- `src/index.ts`
- `src/runtime-command-handler.ts`
- `src/runtime-command-registry.ts`
- `tests/feishu-connection.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/runtime-command-handler.test.ts`
- `tests/runtime-command-registry.test.ts`
- `web/src/components/chat/MessageInput.tsx`
- `web/src/lib/runtimeCommandPicker.ts`
- `web/src/lib/runtimeCommandRegistry.ts`

Last failure summary:
- none

Suspected cause:
- n/a

Next step:
- Commit the completed change, then apply it to the running service through the safe restart path if needed.
