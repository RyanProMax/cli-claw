# Workspace Autopilot And Usage-Aware Footer

## Goal

- Keep workspace-scoped proactive mode quota-aware, but pause it when either the current 5-hour remaining usage drops below 20% or the current week remaining usage drops below 10%.
- Keep assistant footers minimal: always retain the base runtime footer, and append remaining usage only when the current quota has crossed the same pause thresholds (`5h < 20%` or `week < 10%`).
- Append a minimal milestone progress report to task replies, sourced from `PLANS/ACTIVE.md`, with completed milestones marked using `✓`.

## Done when

- A workspace can enable and disable proactive mode from a runtime command without creating a separate immortal agent process.
- Proactive mode reuses the existing workspace/session pipeline, pushes work through the main workspace context, and pauses itself when either the current runtime `5h` remaining usage is below `20%` or the current `week` remaining usage is below `10%`.
- `/status` or a dedicated runtime command can report whether proactive mode is enabled or paused for quota.
- Text replies and Feishu card footers always keep the base runtime footer; usage remaining appears only when `5h < 20%` or `week < 10%`.
- Task replies end with a minimal milestone progress line derived from `PLANS/ACTIVE.md`, and completed milestones are shown with `✓`.
- Validation and review pass for the final diff.

## Milestones

### Milestone 1

Objective:
- Add a shared runtime-usage footer path so outbound replies can include remaining usage conditionally without regressing existing text/card footer rendering.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/COMMAND.md`
- `docs/superpowers/plans/2026-04-24-workspace-autopilot-usage-footer.md`
- `shared/assistant-meta-footer.ts`
- `src/assistant-meta-footer.ts`
- `src/claude-oauth-usage.ts`
- `src/feishu-streaming-card.ts`
- `src/im-channel.ts`
- `src/index.ts`
- `src/usage-command.ts`
- `src/runtime-usage.ts`
- `tests/assistant-meta-footer.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/runtime-usage.test.ts`
- `tests/usage-command.test.ts`

Validation:
- `npm test -- tests/assistant-meta-footer.test.ts tests/feishu-streaming-card.test.ts tests/runtime-usage.test.ts tests/usage-command.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Footer rule changed from “hide entirely when quota is healthy” to “always show base footer, only append remaining when <30%”.
- Keep backend and web footer formatting aligned through `shared/assistant-meta-footer.ts`.
- Persist remaining usage through existing message/footer metadata instead of introducing a channel-only special case.

### Milestone 2

Objective:
- Implement workspace proactive mode as a managed group-context scheduled task plus runtime commands, with quota-aware pause/resume semantics.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `docs/superpowers/plans/2026-04-24-workspace-autopilot-usage-footer.md`
- `shared/runtime-command-registry.ts`
- `src/runtime-command-registry.ts`
- `src/runtime-command-handler.ts`
- `src/task-scheduler.ts`
- `src/index.ts`
- `src/db.ts`
- `src/types.ts`
- `src/workspace-autopilot.ts`
- `tests/runtime-command-registry.test.ts`
- `tests/runtime-command-handler.test.ts`
- `tests/task-scheduler-host-cwd.test.ts`
- `tests/workspace-autopilot.test.ts`

Validation:
- `npm test -- tests/runtime-command-registry.test.ts tests/runtime-command-handler.test.ts tests/task-scheduler-host-cwd.test.ts tests/workspace-autopilot.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Reuse the existing group-context task injection path instead of introducing a second long-lived runner lifecycle.
- Keep one autopilot instance per workspace.
- Quota pause should stop proactive turns, not block explicit user-initiated messages.

### Milestone 3

Objective:
- Align autopilot pause thresholds and remaining-usage footer thresholds to `5h < 20%` or `week < 10%`, and append minimal `PLANS/ACTIVE.md` milestone progress to task replies.

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/COMMAND.md`
- `shared/assistant-meta-footer.ts`
- `src/assistant-meta-footer.ts`
- `src/feishu-streaming-card.ts`
- `src/im-channel.ts`
- `src/index.ts`
- `src/runtime-usage.ts`
- `src/workspace-autopilot.ts`
- `src/active-plan-progress.ts`
- `tests/active-plan-progress.test.ts`
- `tests/assistant-meta-footer.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/im-channel.test.ts`
- `tests/runtime-usage.test.ts`
- `tests/workspace-autopilot.test.ts`

Validation:
- `npm test -- tests/active-plan-progress.test.ts tests/assistant-meta-footer.test.ts tests/feishu-streaming-card.test.ts tests/im-channel.test.ts tests/runtime-usage.test.ts tests/workspace-autopilot.test.ts`
- `git diff --check`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Progress尾注必须保持最小必要，不得和 runtime footer 混成一行。
- 进度尾注现在按当前回复所属工作区读取对应 `PLANS/ACTIVE.md`；读取失败时退化为不追加。

## Working Rules

- `PLANS/ACTIVE.md` is the local active copy of this template and the single source of truth during execution.
- Only one milestone may be `in_progress` at a time.
- Do not expand scope implicitly; update the active plan before changing objective, scope, or validation.
- Validation failure and review failure both keep work inside the current milestone until fixed or explicitly blocked.
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- None

Current status:
- completed

Changed files:
- `PLANS/ACTIVE.md`
- `docs/COMMAND.md`
- `shared/assistant-meta-footer.ts`
- `src/active-plan-progress.ts`
- `src/index.ts`
- `src/runtime-usage.ts`
- `tests/active-plan-progress.test.ts`
- `tests/assistant-meta-footer.test.ts`
- `tests/feishu-streaming-card.test.ts`
- `tests/im-channel.test.ts`
- `tests/runtime-usage.test.ts`
- `tests/workspace-autopilot.test.ts`

Last failure summary:
- `tests/im-channel.test.ts` still asserted the pre-existing legacy footer shape (`tokens` summary instead of base runtime footer), so the validation command failed until the test baseline was updated to the already-shipped footer contract.

Suspected cause:
- The repo still had one stale assertion path that was never updated when footer rendering switched to the shared base runtime footer.

Next step:
- Commit the Milestone 3 diff; if this change should take effect in the running Cli Claw service immediately, apply it through the safe restart path.
