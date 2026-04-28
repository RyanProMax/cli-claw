# No Context Injection Cleanup

## Goal

- Destructively remove Cli Claw-owned historical/context prompt injection paths.
- Keep message DB as audit/provenance only; runtime continuity comes from the agent runtime session id.
- Remove Cli Claw-maintained memory surfaces that could become agent context: default memory prompt wrappers, memory MCP tools, daily summaries, transcript archives, memory API/UI, and stale streaming partial-body delivery.

## Done when

- Independent subagent scan covers input, output, docs, and tests.
- No code path injects DB history, summaries, global memory, heartbeat, transcript archives, reply-policy wrappers, memory recall guidance, or stale presentation buffers into agent prompts or visible Feishu output.
- Current pending-message batching remains: only contiguous same-source pending messages after cursor are sent.
- Validation, review, and commit pass. Service restart is left to an explicit operator command for this cleanup.

## Milestones

### Milestone 51

Objective:
- Remove remaining dynamic context-injection and memory-context paths, then add real-flow regression coverage.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `README.md`
- `config/mount-allowlist.json`
- `container/Dockerfile`
- `container/entrypoint.sh`
- `container/agent-runner/prompts/security-rules.md`
- `container/agent-runner/src/index.ts`
- `container/agent-runner/src/mcp-tools.ts`
- `container/skills/post-test-cleanup/SKILL.md`
- `docs/COMMAND.md`
- `docs/ARCHITECTURE.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- `docs/superpowers/plans/2026-04-24-workspace-autopilot-usage-footer.md`
- `shared/runtime-command-registry.ts`
- `src/active-plan-progress.ts`
- `src/container-runner.ts`
- `src/db.ts`
- `src/index.ts`
- `src/mount-security.ts`
- `src/routes/bug-report.ts`
- `src/routes/tasks.ts`
- `src/routes/workspace-config.ts`
- `src/runtime-usage.ts`
- `src/schemas.ts`
- `src/task-scheduler.ts`
- `src/types.ts`
- `src/workspace-autopilot.ts`
- `tests/active-plan-progress.test.ts`
- `tests/group-queue.test.ts`
- `tests/no-context-injection.test.ts`
- `tests/restart-recovery.test.ts`
- `tests/runtime-command-registry.test.ts`
- `tests/runtime-usage.test.ts`
- `tests/task-scheduler-host-cwd.test.ts`
- `tests/workspace-autopilot.test.ts`
- `web/src/stores/tasks.ts`

Validation:
- `npm test -- --run tests/no-context-injection.test.ts tests/runtime-command-registry.test.ts tests/task-scheduler-host-cwd.test.ts tests/runtime-usage.test.ts tests/restart-recovery.test.ts tests/group-queue.test.ts tests/reply-visibility.test.ts tests/feishu-e2e.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed 2026-04-28:
  - `npm test -- --run tests/no-context-injection.test.ts tests/runtime-command-registry.test.ts tests/task-scheduler-host-cwd.test.ts tests/runtime-usage.test.ts tests/restart-recovery.test.ts tests/group-queue.test.ts tests/reply-visibility.test.ts tests/feishu-e2e.test.ts` passed (92 tests; Vitest emitted existing MaxListeners warnings).
  - `npm run typecheck` passed.
  - `npm run build` passed.
  - `git diff --check` passed.
  - `./scripts/review.sh` passed after formatting `src/index.ts`.

Review status:
- passed 2026-04-28; semantic review found no blocking issues.

Risks / Notes / Handoff:
- Runtime-native session context remains by design.
- Service has not been restarted in this cleanup; apply via explicit operator restart when ready.
