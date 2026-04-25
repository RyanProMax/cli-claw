# Iteration Roadmap

> 记录用户下发、需要跨轮次跟进的迭代任务。`PLANS/ACTIVE.md` 只负责当前轮正在执行的临时计划。

## Status

- `proposed`: 已记录，尚未进入某一轮 `ACTIVE.md`
- `in_progress`: 当前正在推进
- `verified`: 已实现并有验证证据
- `monitoring`: 已上线，继续观察真实使用

## Priority Rules

- P0: 直接影响飞书是否回复、是否能安全启动/重启、是否会误提交游标导致消息丢失。
- P1: 直接影响飞书使用体验、回复可读性、上下文隔离和资源占用。
- P2: 运行时健康、诊断可观测性、长期一致性和已验证项的继续观察。

## Items

### P0 RM-2026-04-25-01 Feishu Message Reliability Control Plane

- Status: `in_progress`
- Source: 2026-04-25 user request item `1`; subagent Feishu reliability analysis; local launchd/backend logs
- Summary: 飞书消息必须有一条可观测、可重试、可恢复的端到端生命周期，覆盖 receive/backfill/slash/queue/runner/streaming card/static send/delivery/cursor commit，解决“自启动后经常不回消息”。
- Evidence:
  - User-reported recurring symptom: autostart/restart 后飞书消息不回。
  - Before 2026-04-25 milestone 1, `src/feishu.ts` called `markSeen(messageId)` before stale `ignoreMessagesBefore` filtering; stale WS delivery could poison startup backfill dedupe.
  - `src/index.ts` routed IM fallback path still uses fire-and-forget `sendImWithFailTracking()` for some web-routed Feishu replies; outbound failure can happen after DB/web already treat the turn as processed.
  - `src/group-queue.ts` retry exhaustion currently logs “Max retries exceeded” and waits for a later trigger; pending work has no durable dead-letter/visible operator state.
  - `src/index.ts` calls startup recovery before all IM channels finish connecting; early direct Feishu delivery depends on incidental queue retry timing.
  - `connectUserChannels()` builds Feishu startup backfill from `getGroupsByOwner(userId)`, so ownerless/stale-owner/transferred Feishu rows may be omitted until a live event arrives.
  - Local DB/log evidence on 2026-04-24/25 shows Feishu user messages followed by `interrupt_partial`, context-window errors, host timeouts, or no immediately visible Feishu answer.
- Progress:
  - 2026-04-25 milestone 1: added a regression test for stale live WS delivery overlapping startup backfill, and moved Feishu inbound dedupe marking until after stale-window filtering. Validation passed with `npm test -- --run tests/feishu-connection.test.ts`, `npm run typecheck`, `git diff --check`, and `./scripts/review.sh`.
  - 2026-04-25 milestone 2: added durable `im_message_lifecycle_events`, Feishu inbound lifecycle events for `received`, `stored`, `notified`, and skipped reasons, plus a compact Feishu `/status` lifecycle line. Validation passed with lifecycle, Feishu connection, IM command formatter tests, `npm run typecheck`, `git diff --check`, and `./scripts/review.sh`.
  - 2026-04-25 milestone 3: added post-store Feishu lifecycle instrumentation for routed messages: `queued`, `runner_started`, `finalized`, `im_delivered`, and `cursor_committed`. Validation passed with `npm test -- --run tests/im-message-lifecycle.test.ts`, `npm run typecheck`, `git diff --check`, and `./scripts/review.sh`.
  - 2026-04-25 milestone 4: queue max-retry exhaustion now records durable `dead_lettered` lifecycle events for pending Feishu-origin messages. Validation passed with `npm test -- --run tests/im-message-lifecycle.test.ts`, `npm run typecheck`, `git diff --check`, and `./scripts/review.sh`.
  - 2026-04-25 milestone 5: main-session routed static IM replies now await Feishu delivery, record `im_delivered` lifecycle success/failure, and block cursor commit when delivery fails after retries so the turn remains retryable. Validation passed with `npm test -- --run tests/restart-recovery.test.ts`, `npm test -- --run tests/im-message-lifecycle.test.ts`, `npm run typecheck`, `git diff --check`, and `./scripts/review.sh`.
- Iteration plan:
  - Extend message lifecycle instrumentation keyed by inbound message id and chat jid to remaining later stages, especially `stream_started`.
  - Add failing tests for routed IM send failure preventing cursor commit, startup recovery waiting for IM readiness, and backfill ownership coverage.
  - Extend the delivery-gated cursor commit behavior from the main-session routed static IM path to conversation agents and other remaining direct/routed IM delivery paths; when delivery is impossible, keep retryable state or emit a clear operator-visible dead-letter.
  - Gate startup recovery/backfill drain on channel readiness, or queue pending outbound until Feishu is connected.
  - Add a compact `/status` or `/self-status` section for recent Feishu lifecycle failures.
- Next action:
  - Continue with the next smallest reliability fix behind the lifecycle contract: conversation-agent delivery/cursor semantics, startup recovery readiness, or Feishu backfill ownership coverage.

### P0 RM-2026-04-25-02 Service Launch Command Contract

- Status: `proposed`
- Source: 2026-04-25 user request item `2`; startup subagent analysis; local `~/.cli-claw/ops/current-backend.json`
- Summary: 明确边界：用户/长期运行/安全重启统一使用 `cli-claw start`；`bun start` / `bun src/index.ts` 只保留为开发直启路径，不能作为默认生产或 LaunchAgent 路径。
- Evidence:
  - Owner docs already describe the public service launcher as `cli-claw start` (`docs/ARCHITECTURE.md`, `docs/RUNTIME.md`, `docs/COMMAND.md`).
  - Current live backend on 2026-04-25 is actually launched by `/Users/ryan/.bun/bin/bun /Users/ryan/projects/cli-claw/src/index.ts`, `source = direct_backend`, under `launchd`.
  - `package.json` has `"start": "bun src/index.ts"`.
  - `Makefile start` uses `bun src/index.ts` when Bun exists, but `node dist/index.js` otherwise, so one command has different launch semantics by host.
  - `ops/install-launch-agent.sh` defaults to `bun src/index.ts`, although docs recommend reusing `/self-status` validated launch command.
  - `/self-check` validates a candidate backend by defaulting to `node dist/index.js`, which can differ from the real direct Bun launch command.
- Decision:
  - Canonical service startup: `cli-claw start`.
  - Canonical service restart: `cli-claw restart` outside IM, `/self-restart` inside IM.
  - Direct backend launch (`bun src/index.ts` / `node dist/index.js`) remains a dev/internal escape hatch and should be visibly labeled as such.
- Iteration plan:
  - Change `make start`, release docs, and LaunchAgent defaults to route through the launcher after build/bootstrap.
  - Keep `bun start` only as `dev-backend` or rename it to make the direct-backend nature explicit.
  - Make `/self-status` and Web Monitor show launch source, exact restart command, canonical recommended command, and warning when running in direct backend mode.
  - Make `/self-check` validate the saved/current launch spec or clearly say it is only checking the default dist backend.
  - Make build-staleness reporting source-aware so direct Bun source mode does not misleadingly report dist freshness as runtime freshness.
- Next action:
  - Plan implementation across `Makefile`, `package.json`, `ops/install-launch-agent.sh`, `src/startup-launch.ts`, `src/self-check.ts`, `src/im-command-utils.ts`, docs, and launch/restart tests.

### P0 RM-2026-04-25-03 Feishu Answer/Commentary Presentation Contract

- Status: `proposed`
- Source: 2026-04-25 user request items `3` and `4`; presentation subagent analysis; local message DB evidence
- Summary: 飞书主正文只展示最终答案；commentary、工具过程、内部诊断、主动模式收敛检查和长日志必须进入独立折叠区、Web 调试区或 run log，默认不能挤占正文。
- Evidence:
  - `container/agent-runner/src/index.ts` returns early to `runCodexLoop()` before Claude path builds `systemPromptAppend`; `codexPromptBlocks()` only forwards the user prompt/images, so `MINIMAL_NECESSARY_REPLY_POLICY` does not apply to Codex today.
  - `shared/stream-presentation.ts` classifies every `text_delta` as `answer`; Codex answer/commentary separation depends on ACP `messageId` 边界。
  - `src/index.ts` Feishu streaming path intentionally uses cumulative `streamText` for Codex card body, so process text can live-stream in main body and only later be cleaned on terminal card.
  - `container/agent-runner/src/mcp-tools.ts` `send_message` description still encourages progress/multiple visible messages and bypasses final reply filtering.
  - Local DB evidence contains visible process prefixes such as “我先快速看一下工程文档...”, runtime diagnostics such as `Model metadata for gpt-5.5 not found...`, and long tool/process traces in Feishu-facing turns.
- Iteration plan:
  - Inject the minimal reply policy into Codex ACP prompts and add tests proving both Claude and Codex receive the same policy.
  - Change stream presentation into an explicit typed contract: `answer`, `commentary`, `thinking`, `tool_output`, `diagnostic`; do not infer only by message id when better metadata exists.
  - Change Feishu Codex streaming main body to render answer candidate only; commentary/process text goes to a dedicated auxiliary panel and should default collapsed after completion.
  - Add per-channel message budgets: Feishu final answer defaults to concise summary plus validation/risk lines; long details go to card panels or Web.
  - Restrict `send_message` visible usage and route scheduled/progress messages through the same visibility policy.
- Next action:
  - Start with `container/agent-runner/src/index.ts`, `shared/stream-presentation.ts`, `src/reply-visibility.ts`, `src/feishu-streaming-card.ts`, `container/agent-runner/src/mcp-tools.ts`, and related presentation tests.

### P1 RM-2026-04-25-04 First-Turn Session Isolation And Context Leakage

- Status: `proposed`
- Source: 2026-04-25 user request item `5`; local inspection of restart recovery, context compaction, sessions table, and message DB
- Summary: 激活/重启/clear 后的首轮回复必须只回答当前消息，除非用户显式要求恢复上下文；历史上下文和 recovery context 不能让 agent “继续上一轮”。
- Evidence:
  - Existing RM-2026-04-24-10 fixed one class of startup recovery predicate leakage, but user still reports first activation can carry previous context.
  - `src/index.ts` recovery mode clears runtime session but injects compact recent history via `buildRecoveryContext()`.
  - `src/context-compaction.ts` recovery prompt explicitly says service just restarted and supplies recent assistant/user lines; this is useful for pending crash recovery but risky for ordinary activation.
  - Current DB still has a Codex main session id for `main`; long-running Codex sessions can hit context-window failures and retain stale intent.
  - Local Feishu DB evidence on 2026-04-25 shows a follow-up IPO task hitting Codex context window and carrying large previous-task context.
- Iteration plan:
  - Split “crash recovery for uncommitted pending work” from “activation after idle/restart”; only the former may inject compact history.
  - Add a turn intent boundary: first user message after activation/reset starts from current message plus minimal workspace identity, not recent chat history.
  - Make `/clear` and runtime auto-reset advance both accepted and committed cursors consistently and clear per-runtime session slots.
  - Add session-slot design for `(folder, agentId, agentType)` or explicitly document/guard current single-slot tradeoff.
  - Add regression tests for restart first-turn, `/clear` first-turn, autopilot/no-op history, and Codex context-window auto-reset.
- Next action:
  - Start with recovery-mode tests in `tests/restart-recovery.test.ts` and session/reset tests around `src/commands.ts`, `src/index.ts`, `src/context-compaction.ts`, and `docs/MEMORY.md`.

### P1 RM-2026-04-25-05 Workspace Autopilot Resource Governance

- Status: `proposed`
- Source: 2026-04-25 local task-run logs; continuation of RM-2026-04-24-09
- Summary: 主动模式不能长期占用 Codex、制造过程性文本、消耗上下文或影响飞书回复；它需要更窄的 health-check contract、短超时和独立会话/模型策略。
- Evidence:
  - Recent `task_run_logs` show repeated `autopilot:workspace:main` errors: `Host Agent timed out after 1800000ms` and `Process crashed before completion`.
  - Recent autopilot results begin with process text such as “我先做一次只读收敛检查...”，说明 no-op 检查仍会诱导 agent 读计划/roadmap/git 并长时间运行。
  - Current task remains active with interval `300000`, though backoff now pushes `next_run` later after failures.
  - `src/task-scheduler.ts` has backoff and busy-skip logic, but no strict no-op budget or specialized lightweight checker.
- Iteration plan:
  - Convert autopilot from general agent prompt into bounded health-check jobs: inspect known state, emit structured `no_op | action | risk`, hard cap runtime.
  - Use a dedicated runtime session or no-session mode so autopilot cannot pollute main conversation/session.
  - Disable or pause autopilot automatically after repeated timeouts until an explicit operator resume.
  - Add a visible `/autopilot status` reason trail: last run, skip reason, failure streak, next run, quota pause, and last published action.
- Next action:
  - Plan around `src/workspace-autopilot.ts`, `src/task-scheduler.ts`, `src/group-queue.ts`, `tests/workspace-autopilot.test.ts`, and `tests/task-scheduler-host-cwd.test.ts`.

### P1 RM-2026-04-25-06 Feishu Mention, Slash Command, And Binding UX

- Status: `proposed`
- Source: 2026-04-25 user “还有一些点想不起来了” plus local message DB evidence
- Summary: 飞书群聊里的 @机器人 slash command、绑定/建群引导和不可处理原因必须明确可见，不能静默失败。
- Evidence:
  - Local DB contains user example `@Co仔 (mac) /where` in a Feishu group without a corresponding assistant reply.
  - `src/feishu.ts` normalizes slash command text with `text.trim().replace(/^@\S+\s+/, '')`; bot display names with spaces such as `@Co仔 (mac)` leave `(mac) /where`, so `/where` is not recognized.
  - Feishu `onBotAddedToGroup` reuses `buildOnNewChat()` and does not send the welcome/binding guidance that Telegram sends.
  - Mention gating and unknown/unbound workspace states mostly log or rely on later normal processing; users do not get a concise explanation.
- Iteration plan:
  - Strip Feishu mention prefixes using Feishu mention metadata, not regex over display text.
  - Add regression tests for `@Name With Space /where`, slash command with images/files, group mention gating, and managed command phrases.
  - Send a Feishu group welcome/bind guidance message on bot added, matching Telegram’s operator guidance.
  - When a message is ignored due to mention policy, missing binding, unknown command, or authorization, send a short visible reason when safe.
- Next action:
  - Start with `src/feishu.ts`, `src/im-slash-command.ts`, `src/im-command-utils.ts`, and `tests/feishu-connection.test.ts`.

### P2 RM-2026-04-25-07 Codex Runtime Health And Model Guardrails

- Status: `proposed`
- Source: 2026-04-25 local logs; continuation of RM-2026-04-24-08 and RM-2026-04-24-11
- Summary: Codex model discovery, metadata refresh, context-window errors and runtime diagnostics need proactive guardrails so user-facing Feishu replies do not expose raw JSON/errors or silently degrade.
- Evidence:
  - Historical logs show repeated `failed to refresh available models: timeout waiting for child process to exit`.
  - DB still contains previous visible `Model metadata for gpt-5.5 not found...` leakage despite later stripping.
  - Feishu message on 2026-04-25 persisted raw Codex JSON context-window error as `sdk_final` error.
  - RM-2026-04-24-08 still has an unfinished next action to validate inherited Codex model availability and downgrade/prompt safely.
- Iteration plan:
  - Preflight effective Codex model before dispatch; if unavailable or metadata refresh hangs, fail fast with a concise operator action.
  - Add context-window classifier at backend final-send boundary so raw JSON is never persisted/sent as final body.
  - Add automatic session reset option for repeated Codex context-window errors, with a concise Feishu recovery hint.
  - Add runtime health cache with TTL and error budget to avoid per-turn slow model discovery.
- Next action:
  - Start with `src/runtime-model-options.ts`, `src/runtime-identity.ts`, `container/agent-runner/src/codex-session-runtime.ts`, `src/agent-output-parser.ts`, and runtime tests.

### P2 RM-2026-04-25-08 Operator Observability Surface

- Status: `proposed`
- Source: 2026-04-25 cross-cutting analysis
- Summary: Web Monitor and IM `/self-status` should expose the same operator truth: current launch mode, exact restart command, Feishu channel readiness, queue/dead-letter state, active runners, autopilot state, recent delivery failures and current runtime identity.
- Evidence:
  - Launch mode is currently visible in saved state and `/self-status`, but not clearly surfaced in Web/admin workflows.
  - Message reliability, startup, autopilot, stream presentation and runtime model failures all need a shared operator timeline to avoid log spelunking.
- Iteration plan:
  - Build a compact health summary API consumed by `/self-status`, `/status`, and Web Monitor.
  - Add recent failure timelines for Feishu lifecycle and runner exits.
  - Include safe commands: canonical start, canonical restart, current saved launch command, and warning if they differ.
- Next action:
  - Design after P0 launch/reliability contracts land, so observability exposes stable state names rather than temporary implementation details.

## Existing Follow-Ups Preserved

### RM-2026-04-24-01 Feishu Streaming Card Terminal State

- Priority: P2
- Status: `monitoring`
- Source: 2026-04-24 user request
- Summary: 任务完成但无最终可见文本时，飞书卡片也必须冻结到终态，不能停在 `Working on it`
- Evidence:
  - commit `bcfc5c9 Freeze Feishu cards on silent completion`
  - safe restart `restart-2026-04-24T05-27-34-063Z-3bdb642e.json`
- Next action:
  - 继续观察真实飞书使用；后续若复发，并入 RM-2026-04-25-03 的 terminal fallback 合同。

### RM-2026-04-24-07 Safe Restart Reply Recovery

- Priority: P0
- Status: `monitoring`
- Source: 2026-04-24 user request
- Summary: 共享 runner 异常退出或安全重启后，IM 消息不能只留下 interrupted partial，必须从真实来源 chat 继续补发后续回复
- Evidence:
  - `src/group-queue.ts`
  - `src/index.ts`
  - `tests/group-queue.test.ts`
  - `tests/restart-recovery.test.ts`
  - `npm test -- tests/group-queue.test.ts tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `src/feishu.ts`
  - `tests/feishu-connection.test.ts`
  - startup connect now backfills known Feishu chats once after WS readiness
  - 2026-04-24 afternoon RCA: `web:main` autopilot relaunched before a Feishu source whose `last_agent_timestamp` had advanced but `last_committed_cursor` had not; added DB-pending IM sibling priority before web/autopilot work
  - 2026-04-25 monitoring follow-up: startup backfill now treats Feishu `230002 Bot/User can NOT be out of the chat` as a stale chat signal, removes it from the active backfill set, and retires the registered IM source row while preserving message history
  - commit `ff4b073 Clean up stale Feishu backfill chats`; safe restart `restart-2026-04-25T05-46-40-632Z-f0516103`
  - 2026-04-25 post-restart log evidence: PID `62077` classified the next `230002` backfill as `Feishu chat unavailable during backfill; removed from active backfill set` and did not emit the previous generic `Feishu chat backfill failed` for that event
- Next action:
  - 继续观察真实 IM 流量；若仍有“飞书消息不回”，优先并入 RM-2026-04-25-01 的 lifecycle/dead-letter/retry 合同。

### RM-2026-04-24-08 Codex Model Picker Real CLI Discovery

- Priority: P2
- Status: `verified`
- Source: 2026-04-24 user request (`/model` 未显示 GPT-5.5)
- Summary: `/model` 需要尽量对齐当前 Codex CLI 的真实模型列表，而不是仅依赖本地 cache/preset 回退
- Evidence:
  - `src/runtime-model-options.ts` 当前优先读取 `~/.codex/models_cache.json`，缓存缺失时回退 preset
  - real-world report: `/model` missing GPT-5.5
  - 2026-04-24 Feishu recovery runner inherited `~/.codex/config.toml` `model = "gpt-5.5"` while `~/.codex/models_cache.json` no longer listed it, causing `codex-acp` to fail with `The model gpt-5.5 does not exist or you do not have access to it`
  - 2026-04-24 live catalog fix: backend `/model` now queries `codex debug models` before cache/preset fallback, and picker options include the current effective Codex model when it differs from the live catalog
  - safe restart `restart-2026-04-24T14-01-56-608Z-14ce081a`
- Next action:
  - 评估是否在 workspace 未显式配置模型时校验 inherited Codex model 是否仍在可用列表内；若不可用，提示/降级到安全默认模型，并补契约测试。此项并入 RM-2026-04-25-07。

### RM-2026-04-24-09 Workspace Autopilot Background Contract

- Priority: P1
- Status: `verified`
- Source: 2026-04-24 user request
- Summary: 主动模式不能每 5 分钟把固定 prompt 当普通消息塞进主对话；应改为低优先级后台 run，真实用户/飞书消息优先，no-op 不污染对话历史
- Evidence:
  - current implementation: `src/task-scheduler.ts` group-context task stores the autopilot prompt as a regular source workspace message
  - current live task: `autopilot:workspace:main` interval `300000`
  - implemented: autopilot uses low-priority background queue task, does not call `storePromptMessage`, skips busy/pending IM work, and suppresses no-op visible replies
  - tests: `tests/group-queue.test.ts`, `tests/task-scheduler-host-cwd.test.ts`, `tests/workspace-autopilot.test.ts`
  - validation: `npm test -- --run tests/workspace-autopilot.test.ts tests/group-queue.test.ts tests/task-scheduler-host-cwd.test.ts`, `npm run typecheck`, `git diff --check`, `./scripts/review.sh`
  - safe restart `restart-2026-04-24T14-41-19-260Z-c027f9a3`
  - post-restart monitoring: task run log `143` started at `2026-04-24T14:45:21.375Z`; `messages` had no rows after backend restart `2026-04-24T14:41:20.738Z`, and all persisted `[WORKSPACE_AUTOPILOT]` prompt rows predated the restart
  - 2026-04-25 follow-up evidence: recent task runs repeatedly ended with `Host Agent timed out after 1800000ms` / `Process crashed before completion`; added consecutive-error exponential backoff capped at 6h while successful runs keep the normal interval
  - commit `803fcc3 Back off failing workspace autopilot runs`; validation: `npm test -- --run tests/workspace-autopilot.test.ts tests/group-queue.test.ts tests/task-scheduler-host-cwd.test.ts`, `npm run typecheck`, `git diff --check`, `./scripts/review.sh`, `npm run build`
  - safe restart `restart-2026-04-25T07-03-20-240Z-b02b0c4d` passed; current backend PID `68604` started at `2026-04-25T07:03:26.484Z` and `/api/health` is `healthy`
- Next action:
  - 继续观察真实 autopilot task run logs；若成功 no-op 仍长时间占用 Codex，再收窄提示词或 session 隔离策略。此项并入 RM-2026-04-25-05。

### RM-2026-04-24-10 Restart First-Turn Context Leakage

- Priority: P1
- Status: `monitoring`
- Source: 2026-04-24 user request
- Summary: 服务重启后首次问答不应因内部历史 prompt / 命令镜像被误判为待恢复输入而自动注入最近历史上下文
- Evidence:
  - `recoverPendingMessages()` currently recovers on any `getMessagesSince()` row after `lastCommittedCursor`
  - `getMessagesSince()` returns user-side rows but does not expose/filter `source_kind`, so `scheduled_task_prompt` / `user_command` rows can trigger recovery
  - implemented: startup recovery now filters through `isRecoverableRestartPendingMessage()` and ignores `scheduled_task_prompt`, `user_command`, assistant, and system rows
  - tests: `tests/restart-recovery.test.ts`
  - validation: `npm test -- --run tests/restart-recovery.test.ts`, `npm run typecheck`, `git diff --check`, `./scripts/review.sh`
  - safe restart `restart-2026-04-24T15-45-15-537Z-7d38d20e`
  - supplemental replay filter: recovery replay applies the same recoverable-pending filter before formatting pending rows for the fresh agent session
  - supplemental validation: `npm test -- --run tests/restart-recovery.test.ts`, `npm run typecheck`, `git diff --check`, `./scripts/review.sh`
  - supplemental safe restart `restart-2026-04-24T15-51-48-791Z-d77107e0`
  - supplemental commit `df5e8f8 Filter restart recovery replay messages`
- Next action:
  - 继续观察真实重启后的首轮飞书/Web 问答；若仍带入历史，再检查 runtime session 复用与 `/clear` 边界。此项并入 RM-2026-04-25-04。

### RM-2026-04-24-11 Codex GPT-5.5 Metadata Diagnostic Leakage

- Priority: P2
- Status: `monitoring`
- Source: 2026-04-24 user request
- Summary: Codex/ACP 会把 `Model metadata for gpt-5.5 not found...` 作为 assistant text chunk 输出，cli-claw 不能把这类运行时诊断堆进用户可见正文
- Evidence:
  - `codex --version`: `codex-cli 0.124.0`
  - `codex debug models` 当前返回 `gpt-5.5`
  - `~/.codex/models_cache.json` 当前也包含 `gpt-5.5`
  - historical host log `host-2026-04-24T14-15-01-332Z.log` shows the diagnostic as `eventType=text_delta` and final `success.result` prefix
  - implemented: Codex ACP runner strips this runtime diagnostic before stream emission and final answer accumulation
  - tests: `tests/codex-session-runtime.test.ts`
  - validation: `npm test -- --run tests/codex-session-runtime.test.ts`, `npm run typecheck`, `npm --prefix container/agent-runner run build:runner`, `git diff --check`, `./scripts/review.sh`
  - safe restart `restart-2026-04-24T15-58-12-695Z-705a3f74`
- Next action:
  - 继续观察下一次真实 `gpt-5.5` Codex 回复；若底层仍频繁报 metadata 缺失但已不外显，再进一步查 ACP session/model metadata load path。此项并入 RM-2026-04-25-07。

## Verified Baseline

### RM-2026-04-24-02 Workspace Autopilot Quota Pause Thresholds

- Status: `verified`
- Summary: `5h < 20%` 暂停，`week < 10%` 也暂停
- Evidence: `src/runtime-usage.ts`, `tests/workspace-autopilot.test.ts`
- Next action: 无

### RM-2026-04-24-03 Footer Remaining Threshold Alignment

- Status: `verified`
- Summary: 飞书/通用 footer 仅在 `5h < 20%` 或 `week < 10%` 时展示 remaining
- Evidence: `src/runtime-usage.ts`, `tests/assistant-meta-footer.test.ts`
- Next action: 无

### RM-2026-04-24-04 Task Reply Milestone Progress Suffix

- Status: `verified`
- Summary: 任务类回复末尾追加 `ACTIVE.md` milestone 进度，完成项打 `✓`
- Evidence: `src/active-plan-progress.ts`, `tests/active-plan-progress.test.ts`
- Next action: 无

### RM-2026-04-24-05 Feishu Outbound Message Contract

- Status: `verified`
- Summary: 飞书对外消息必须严格区分用户可见回复与内部 commentary / tool steps，补足端到端契约测试
- Evidence:
  - `shared/stream-presentation.ts`
  - `src/feishu-streaming-card.ts`
  - `src/index.ts`
  - `tests/stream-presentation.test.ts`
  - `tests/chat-streaming-store.test.ts`
  - `tests/feishu-streaming-card.test.ts`
  - `tests/feishu-connection.test.ts`
  - `tests/im-channel.test.ts`
  - `tests/reply-visibility.test.ts`
  - `tests/restart-recovery.test.ts`
  - safe restart `restart-2026-04-24T15-36-30-227Z-556983dc`
- Next action:
  - 无；new presentation hardening tracked by RM-2026-04-25-03.

### RM-2026-04-24-06 Minimal Necessary Reply Policy

- Status: `verified`
- Summary: 回复默认遵循“最小必要原则”，只输出影响决策的关键信息，不外泄过程性执行细节
- Evidence:
  - `container/agent-runner/src/reply-policy.ts`
  - `container/agent-runner/src/index.ts`
  - `tests/minimal-reply-policy.test.ts`
  - validation: `npm test -- --run tests/minimal-reply-policy.test.ts`, `npm run typecheck`, `npm --prefix container/agent-runner run build:runner`, `git diff --check`, `./scripts/review.sh`
- Next action:
  - 无；Codex-specific policy injection gap tracked by RM-2026-04-25-03.
