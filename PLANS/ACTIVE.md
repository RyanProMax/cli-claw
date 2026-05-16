# Active Task: P0 E2E Test Contract Convergence

## Current Goal

- Make the test suite catch real daily-use regressions before they reach Feishu/Web users.
- Reduce low-signal tests that only assert mocks, static strings, or duplicated card schema details.
- Establish a P0 e2e/contract matrix where external services are mocked only at the network/protocol boundary, while DB, queue, runtime selection, scheduler, presentation, cursor, and session behavior stay real.

## Why The 2026-05-16 OpenAI 400 Escaped

- Existing Feishu e2e tests mocked `runHostAgent`, so they never entered `container/agent-runner`.
- Existing OpenAI runtime tests checked `buildModelSettings()`, but not the final request body emitted by `@openai/agents` + OpenAI SDK.
- Existing runtime picker tests proved `speedTier: "fast"` persisted and reached runner input, but not that Codex backend accepts the serialized `service_tier`.
- The missing contract was: `workspace/runtime setting -> runner input -> OpenAI Agent -> OpenAI SDK Responses request body`.

## Current Milestone

Objective:
- Add the missing OpenAI runner request contract.
- Do a first low-risk pass that consolidates obvious duplicate/low-value tests.
- Record the P0 matrix so later cleanup does not delete high-value chain coverage.

Allowed scope:
- `PLANS/ACTIVE.md`
- `tests/p0-openai-runner-contract.test.ts`
- `tests/feishu-connection.test.ts`
- `tests/runtime-usage.test.ts`
- Follow-up roadmap entries only if this milestone leaves unfinished cleanup.

Validation:
- `npm test -- tests/p0-openai-runner-contract.test.ts tests/feishu-connection.test.ts tests/runtime-usage.test.ts`
- `npm run typecheck`
- `npm test`
- `./scripts/review.sh`

Status:
- done

## P0 E2E / Contract Matrix

1. Feishu private message to final streaming-card reply
   - Entry: Feishu `im.message.receive_v1`.
   - Keep real: DB, lifecycle, notifier, queue, `processGroupMessages`, card controller, cursor commit.
   - Mock only: Feishu SDK network and runner output.
   - Assert: received/stored/notified/stream/final/delivered/cursor lifecycle; final assistant body only contains current-turn answer.
   - Location: `tests/feishu-e2e.test.ts`.

2. Feishu group mention gate and group success path
   - Entry: Feishu group message with `chat_type=group`.
   - Keep real: mention policy, storage, queue, cursor/source handling.
   - Mock only: Feishu SDK network and runner output.
   - Assert: unmentioned message records skip; mentioned or gate-disabled message reaches the same reply chain without crossing private-chat state.
   - Location: `tests/feishu-e2e.test.ts`.

3. Web main workspace message path
   - Entry: Web message API or exported test hook.
   - Keep real: DB, workspace runtime identity, queue/IPC decision, Web stream snapshot.
   - Mock only: runner output.
   - Assert: user message lands in `web:<folder>` main conversation; runtime identity is preserved; cursor/session state advances correctly.
   - Proposed location: `tests/web-main-workspace-e2e.test.ts`.

4. Codex CLI auth contract
   - Entry: fake `codex app-server --listen stdio://` plus temporary `~/.codex/auth.json`.
   - Keep real: JSON-RPC framing, token expiration logic, app-server priority, auth.json fallback.
   - Mock only: fake `codex` executable via `PATH`.
   - Assert: refresh on expiring token, fallback only for valid auth.json, stable codex-login error for missing/expired auth.
   - Location: `tests/codex-cli-auth.test.ts`.

5. OpenAI runner request contract for `gpt-5.5 + xhigh + fast`
   - Entry: `runOpenAiAgentLoop()` using real `@openai/agents` and OpenAI SDK.
   - Keep real: runner construction, session, model settings, SDK serialization.
   - Mock only: Codex backend with a local HTTP server.
   - Assert: final HTTP body sends `service_tier: "priority"` for UI `fast`, never `service_tier: "fast"`; `standard` omits service tier.
   - Location: `tests/p0-openai-runner-contract.test.ts`.

6. Workspace runtime and host cwd settings
   - Entry: Web groups/workspace config route.
   - Keep real: effective home sibling inheritance, runtime identity resolution, cwd helper.
   - Mock only: ACL and external process stop.
   - Assert: runtime switch stops runner and clears session; host cwd is inherited correctly; member cannot silently gain host access.
   - Location: `tests/workspace-config-host-cwd.test.ts`, `tests/groups-route.test.ts`.

7. Session reuse and `/clear`
   - Entry: Web `/clear`, Feishu `/clear`, then a normal follow-up message.
   - Keep real: session store, runtime reset, runner input session id.
   - Mock only: runner output.
   - Assert: main workspace uses `(folder, empty agentId)` session; clear deletes runtime session files and next message starts fresh; conversation agent session does not overwrite main session.
   - Proposed location: `tests/web-main-workspace-e2e.test.ts`, `tests/feishu-e2e.test.ts`.

8. Scheduled/loop task run
   - Entry: task route or `runTask()`.
   - Keep real: task row/log transitions, source runtime/cwd inheritance, isolated task workspace.
   - Mock only: runner output.
   - Assert: run log running/success/error transitions; login/setup error is user-visible and not marked success; once task does not double enqueue while finalizing.
   - Location: `tests/task-scheduler-host-cwd.test.ts`.

9. Tool call presentation and `send_message`
   - Entry: fake runner stream with tool start/delta/end, commentary, final answer.
   - Keep real: Feishu card controller, Web stream store, visible reply resolver.
   - Mock only: Feishu SDK network and runner event source.
   - Assert: tool steps remain visible in completed card; commentary stays in Thinking; final answer is clean; tool-sent content follows the same visibility contract.
   - Location: `tests/feishu-e2e.test.ts`, `tests/chat-streaming-store.test.ts`.

10. User-facing error boundary
    - Entry: runner structured error, provider 400/401/429/model/context errors, Feishu delivery failure.
    - Keep real: output parser, error formatter, message persistence, delivery/cursor policy.
    - Mock only: external provider/Feishu failure.
    - Assert: no raw JSON, stack, token, `[object Object]`, or provider internals are sent as final text; cursor commits only after successful user-visible delivery.
    - Location: `tests/feishu-e2e.test.ts`, `tests/task-scheduler-host-cwd.test.ts`, `tests/error-serialization.test.ts`.

## First Cleanup Decisions

Done in this milestone:
- Added `tests/p0-openai-runner-contract.test.ts`, a local HTTP contract test that exercises real runner + OpenAI SDK serialization.
- Consolidated three Feishu runtime picker action forwarding tests into one table-driven adapter contract.
- Consolidated multiple OpenAI/missing runtime usage null tests into one semantic test.

Keep:
- `feishu-e2e.test.ts` core chain tests.
- `group-queue.test.ts` IPC/idle/source ordering tests.
- `task-scheduler-host-cwd.test.ts` runtime/cwd/task-finalization tests.
- `restart-recovery.test.ts` cursor and recovery tests.
- `no-context-injection.test.ts` runner prompt/context boundary tests.

Continue pruning later:
- Collapse repeated `feishu-streaming-card.test.ts` panel order/footer/schema snapshot tests into fewer behavior cases.
- Reduce `runtime-command-registry.test.ts` help text snapshots to parser/availability contract tests.
- Trim route tests that mock the exact helper they claim to validate.

## Handoff

Current status:
- done

Last validation:
- `npm test -- tests/p0-openai-runner-contract.test.ts tests/feishu-connection.test.ts tests/runtime-usage.test.ts`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 61 files / 450 tests.
- `./scripts/review.sh`: passed mechanical review checks.

Next step:
- Continue the next cleanup pass by collapsing repeated card/schema snapshots and adding the remaining Web main-workspace P0 e2e test.
