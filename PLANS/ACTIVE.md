# Restart Recovery And Hidden Context Hardening

## Goal

- Fix the second review findings in one coordinated pass.
- Restart recovery must not skip accepted-but-uncommitted messages.
- Restart recovery must not inject old history, interrupted bodies, ACTIVE.md content, handoff text, or summaries.
- Dynamic hidden-context surfaces must be hardened: MCP settings, workspace MCP loading, and IM skill-command `assistant_prompt` source kind propagation.
- Feishu regression coverage must exercise the real output chain, not only helper functions.
- Docs must keep the safe launcher restart contract clear.

## Done when

- Recovery uses committed cursors for completed work and never treats accepted IPC cursors as committed.
- Missing committed cursors recover only restart-recoverable current work after the latest non-user boundary.
- Context-like MCP servers cannot survive stale session settings or bypass filtering through command/url/args/env text.
- WeChat/DingTalk skill command rewrites propagate `sourceKind: assistant_prompt`.
- Feishu E2E covers `processGroupMessages -> runner stream -> card/final output -> cursor commit`.
- Validation, review, and commit pass.

## Milestones

### Milestone 52

Objective:
- Apply restart recovery, hidden-context, Feishu E2E, IM skill rewrite, and docs contract fixes from the parallel subagent review.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `README.md`
- `container/agent-runner/src/index.ts`
- `docs/COMMAND.md`
- `src/container-runner.ts`
- `src/dingtalk.ts`
- `src/index.ts`
- `src/wechat.ts`
- `tests/feishu-e2e.test.ts`
- `tests/no-context-injection.test.ts`
- `tests/restart-recovery.test.ts`
- `tests/wechat-dingtalk-skill-command.test.ts`

Validation:
- `npm test -- --run tests/restart-recovery.test.ts tests/group-queue.test.ts tests/reply-visibility.test.ts tests/feishu-e2e.test.ts tests/no-context-injection.test.ts tests/runtime-command-registry.test.ts tests/wechat-dingtalk-skill-command.test.ts tests/im-slash-command.test.ts tests/im-message-lifecycle.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed 2026-04-28:
  - `npm test -- --run tests/restart-recovery.test.ts tests/group-queue.test.ts tests/reply-visibility.test.ts tests/feishu-e2e.test.ts tests/no-context-injection.test.ts tests/runtime-command-registry.test.ts tests/wechat-dingtalk-skill-command.test.ts tests/im-slash-command.test.ts tests/im-message-lifecycle.test.ts` passed (9 files, 105 tests; existing MaxListeners warnings emitted).
  - `npm run typecheck` passed.
  - `npm run build` passed; Vite emitted existing large chunk warning.
  - `git diff --check` passed.
  - `./scripts/review.sh` passed.
  - Production scan found only defensive context blockers: MCP denylist regexes and reply-policy output stripping.
  - RED/GREEN for restart recovery cursor helpers and startup recovery accepted-but-uncommitted replay passed.
  - MCP worker reported targeted tests/typecheck/build/review passed for `src/container-runner.ts`, `container/agent-runner/src/index.ts`, `tests/no-context-injection.test.ts`; main agent reran combined validation above.
  - WeChat/DingTalk worker committed `2749ac8 Fix IM skill command source kind propagation` with targeted validation.
  - Feishu E2E worker committed `747221c test: cover Feishu process group output delivery` with targeted validation.

Review status:
- passed 2026-04-28; reviewed against `RUNBOOKS/Review.md` for scope, objectives, tests, hidden context surfaces, docs consistency, and cursor regression risk.

Risks / Notes / Handoff:
- Existing Vitest `MaxListenersExceededWarning` can appear during Feishu/restart test groups; treat failures by exit code and assertions, not by this known warning alone.
- Service has not been restarted after these code changes.
