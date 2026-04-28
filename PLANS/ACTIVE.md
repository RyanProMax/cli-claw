# No Context Injection Cleanup

## Goal

- Destructively remove Cli Claw-owned historical/context prompt injection paths.
- Keep message DB as audit/provenance only; runtime continuity comes from the agent runtime session id.
- Remove Cli Claw-maintained memory surfaces that could become agent context: default memory prompt wrappers, memory MCP tools, daily summaries, transcript archives, memory API/UI, and stale streaming partial-body delivery.

## Done when

- Independent subagent scan covers input, output, docs, and tests.
- No code path injects DB history, summaries, global memory, heartbeat, transcript archives, reply-policy wrappers, memory recall guidance, or stale presentation buffers into agent prompts or visible Feishu output.
- Current pending-message batching remains: only contiguous same-source pending messages after cursor are sent.
- Validation, review, commit, and safe restart pass.

## Milestones

### Milestone 51

Objective:
- Remove remaining dynamic context-injection and memory-context paths, then add real-flow regression coverage.

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `README.md`
- `config/global-agents-md.template.md`
- `container/Dockerfile`
- `container/entrypoint.sh`
- `container/agent-runner/prompts/security-rules.md`
- `container/agent-runner/src/index.ts`
- `container/agent-runner/src/mcp-tools.ts`
- `container/agent-runner/src/reply-policy.ts`
- `container/agent-runner/src/types.ts`
- `container/agent-runner/src/utils.ts`
- `docs/ARCHITECTURE.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- `docs/superpowers/specs/2026-04-23-skill-command-hkipo-design.md`
- `docs/superpowers/specs/2026-04-12-context-streaming-output-design.md`
- `docs/superpowers/plans/2026-04-12-context-streaming-output.md`
- `src/active-plan-progress.ts`
- `src/container-runner.ts`
- `src/context-compaction.ts`
- `src/daily-summary.ts`
- `src/db.ts`
- `src/file-manager.ts`
- `src/index.ts`
- `src/project-memory.ts`
- `src/routes/groups.ts`
- `src/routes/memory.ts`
- `src/routes/tasks.ts`
- `src/runtime-config.ts`
- `src/task-scheduler.ts`
- `src/types.ts`
- `src/utils.ts`
- `src/web.ts`
- `src/workspace-autopilot.ts`
- `tests/active-plan-progress.test.ts`
- `tests/context-compaction.test.ts`
- `tests/memory-paths.test.ts`
- `tests/minimal-reply-policy.test.ts`
- `tests/no-context-injection.test.ts`
- `tests/project-memory.test.ts`
- `tests/restart-recovery.test.ts`
- `tests/stream-presentation.test.ts`
- `tests/task-scheduler-host-cwd.test.ts`
- `web/src/App.tsx`
- `web/src/components/groups/GroupDetail.tsx`
- `web/src/components/settings/SettingsNav.tsx`
- `web/src/components/settings/types.ts`
- `web/src/pages/MemoryPage.tsx`
- `web/src/pages/SettingsPage.tsx`

Validation:
- `npm test -- --run tests/restart-recovery.test.ts tests/stream-presentation.test.ts tests/reply-visibility.test.ts tests/feishu-e2e.test.ts tests/task-scheduler-host-cwd.test.ts tests/context-compaction.test.ts tests/active-plan-progress.test.ts tests/no-context-injection.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run build:web`
- `git diff --check`
- `./scripts/review.sh`

Status:
- in_progress

Validation status:
- pending

Review status:
- pending

Risks / Notes / Handoff:
- Runtime-native session context remains by design.
