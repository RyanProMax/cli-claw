# Iteration Roadmap

> 只记录跨轮次仍需推进的迭代任务。已完成的实现证据不在这里长期滚动堆积；稳定契约沉淀到 `docs/` owner 文档，当前执行细节放在 `PLANS/ACTIVE.md`。

## Status

- `proposed`: 已记录，尚未进入某一轮 `ACTIVE.md`
- `in_progress`: 当前正在推进
- `monitoring`: 已上线，等待真实使用观察或只在复发时重开

## Priority Rules

- P0: 直接影响飞书是否回复、是否能安全启动/重启、是否会误提交游标导致消息丢失。
- P1: 直接影响飞书使用体验、回复可读性、上下文隔离和资源占用。
- P2: 运行时健康、诊断可观测性、长期一致性。

## Live Items

### P0 RM-2026-04-25-02 Service Launch Command Contract

- Status: `monitoring`
- Source: 2026-04-25 user request item `2`; current `/self-status`; current shell check after milestone 25
- Summary: 长期运行和安全重启入口必须收敛到 `cli-claw start` / `cli-claw restart`；`bun src/index.ts` / `bun start` 只能是开发直启路径，并且所有状态面都要说清楚差异。
- Current state:
  - Owner docs already define canonical launcher behavior in `docs/COMMAND.md` and `docs/RUNTIME.md`.
  - `make start` and the default LaunchAgent installer path now route through `cli-claw start`.
  - `package.json` `start` now delegates to `bun src/cli.ts start`, so repo-local `bun start` / `npm start` enters the same launcher layer instead of direct `src/index.ts`.
  - `/self-status` warns when the running service is `direct_backend` and shows the recommended canonical entrypoint.
  - `/self-status` also marks source-launched services with source/build artifact mode so dist freshness is not presented as the live TypeScript backend freshness signal.
  - `/self-check` validates the backend-captured authoritative launch spec.
  - `docs/COMMAND.md` documents repo-local `bun src/cli.ts start` / `bun src/cli.ts restart` fallback for shells where `cli-claw` is not yet on PATH.
  - Current LaunchAgent now runs `/Users/ryan/.bun/bin/bun /Users/ryan/projects/cli-claw/src/cli.ts start`.
  - Current backend state reports `source: cli_start`, `artifactMode: source`, PID `26433`, and `/api/health` healthy after the launchd migration.
  - `ops/install-launch-agent.sh` now retries `launchctl bootstrap` once after `bootout` before failing, covering the transient `Bootstrap failed: 5` observed during migration.
- Next action:
  - Monitor the next `/self-status` / `/self-restart` cycle to confirm it stays on `cli_start`.
  - Decide whether the development environment should install/link `cli-claw` onto PATH so future operator shells do not need the repo-local fallback.

### P0 RM-2026-04-25-01 Feishu Message Reliability Control Plane

- Status: `monitoring`
- Source: 2026-04-25 user request item `1`; 2026-04-26 Feishu incidents
- Summary: 飞书消息链路必须以真实消息输入/输出流程作为回归基线，覆盖 inbound SDK event、DB、queue、runner output、Feishu payload、cursor 和 lifecycle；类似“正文混入历史上下文”的问题不能只靠函数级测试或人工查日志定位。
- Durable contract:
  - Message reliability and visibility contracts live in `docs/ARCHITECTURE.md`.
  - Restart/recovery context boundaries live in `docs/MEMORY.md`.
  - Self-restart/operator command contracts live in `docs/COMMAND.md` and `docs/RUNTIME.md`.
- Current state:
  - Latest applied evidence: commit `357f756 Gate interrupted context resume`; safe restart `restart-2026-04-26T11-34-00-685Z-5b68e5d4` passed; `/api/health` was healthy for PID `14317`.
  - Post-restart process check showed one backend and current runner group only; no historical orphan runner group was visible.
  - Feishu E2E harness exists for inbound SDK event handling, lifecycle DB writes, notifier wakeup, duplicate/stale/mention cases, and managed restart phrase handling.
  - Feishu E2E success-path coverage now drives a real inbound SDK event through real `GroupQueue`, a deterministic fake runner, real `StreamingCardController` card create/update, lifecycle evidence from `queued` through `cursor_committed`, and persisted cursor state.
  - Feishu stale-output regression now simulates a real inbound message, stale Codex presentation state, final visibility resolution, static Feishu card send, lifecycle rows, and asserts the delivered card payload contains only the current raw final answer.
  - Message-chain diagnostics must include correlatable `chatJid`, inbound `messageId`, `turnId`, `runId`/session id where available, `sourceKind`, runtime identity, final raw length, presentation buffer lengths, delivery type, and cursor commit decision at the boundaries that can affect visible output.
- Next action:
  - Promote real-flow E2E to the required gate for any Feishu message visibility, restart recovery, streaming card, cursor, or output-boundary change.
  - Add negative E2E cases for stale presentation buffer, restart first turn, pending-message recovery, and mixed source turns before changing those paths again.
  - Add/review structured logs at every output-affecting boundary so a single `messageId` can reconstruct inbound -> queued -> runner -> visible text resolution -> Feishu payload -> cursor commit without manual guessing.

### P1 RM-2026-04-25-03 Feishu Answer/Commentary Presentation Contract

- Status: `proposed`
- Source: 2026-04-25 user request items `3` and `4`; visible Feishu/Web process-text incidents
- Summary: 飞书主正文只展示当前 turn 的 runtime answer；reasoning/commentary、工具过程、内部诊断、主动模式收敛检查和长日志必须进入独立折叠区、Web 调试区或 run log，默认不能挤占正文；final send 不应依赖跨 turn presentation `answerText`。
- Current state:
  - Shared stream presentation already has answer/commentary concepts and Feishu cards can render auxiliary progress.
  - Graceful shutdown partials and known Codex transport/model diagnostics are suppressed from user-visible正文.
  - Claude and Codex ACP turns now share the same minimal necessary reply-policy block; Codex prompts are wrapped with that policy while preserving the raw user message.
  - Final visible replies now pass through a `reply-visibility` internal-context guard that strips raw prompt XML wrappers and restart recovery summaries before Feishu/Web delivery.
  - `reply-visibility` now ignores Codex presentation `answerText` for final visible bodies; current runtime raw/final output is the only final-send source, with warn logs when presentation answer is present.
  - Feishu stale-output E2E proves delivered static card markdown equals current raw final and excludes stale hkipo/history content.
  - `answerText` is now a transitional presentation buffer, not an authoritative final-send source.
  - `send_message` visible-tool policy still needs hardening.
- Next action:
  - Continue tightening per-turn streaming buffers so `answerText`-like state is scoped to live card rendering and destroyed after completion.
  - Tighten `shared/stream-presentation.ts`, `src/reply-visibility.ts`, `src/feishu-streaming-card.ts`, and `container/agent-runner/src/mcp-tools.ts` so process text cannot become Feishu main body by default.
  - Add per-channel concise reply budgets for Feishu final answers.

### P1 RM-2026-04-25-04 First-Turn Session Isolation And Context Leakage

- Status: `monitoring`
- Source: 2026-04-25 user request item `5`; restart recovery and resume-gate incidents
- Summary: 激活/重启/clear 后的首轮回复必须只回答当前消息；连续性完全由底层 agent runtime session 提供，cli-claw 不维护、不总结、不拼接历史上下文，只保留消息数据库用于审计和溯源。
- Current state:
  - Startup recovery ignores internal prompt/command/assistant/system rows.
  - Interrupted residual context is not replayed by cli-claw; pending confirmation state stores metadata only, and any "continue" reply is sent as the current user message for the runtime session to interpret.
  - `docs/MEMORY.md` documents the current recovery and resume boundaries.
  - Milestone 38 replaces IM source runtime isolation with one primary runtime session per workspace.
  - Primary and conversation-agent turn selection now process contiguous same-source pending messages in DB order; different sources wait for the next turn instead of being regrouped or mixed into the active source. Example: `A1/A2/B1/A3/B2/B3` becomes `A1+A2 -> A`, `B1 -> B`, `A3 -> A`, `B2+B3 -> B`.
  - Restart recovery resumes the saved runtime session and pending messages; it no longer clears the primary session or injects compact DB history.
  - Main workspace reset paths delete only the primary runtime slot while preserving conversation agent sessions.
  - Skill slash commands that return `assistant_prompt` are tagged as `assistant_prompt` messages and clear the workspace primary runtime session before execution, so command-generated tasks do not inherit stale runtime transcript context.
- Next action:
  - Interrupted resume no longer replays or stores old user message bodies; conversation-agent recovery now requires a committed cursor and will not fall back to all virtual-chat history.
  - Remove any remaining cli-claw-owned historical prompt/replay/summary injection path; restart must send only pending user messages and rely on saved runtime session id for context.
  - Add real-flow E2E for restart first turn and interrupted pending recovery proving no DB history/recovery summary reaches agent input or user-visible output.
  - Monitor real Feishu/Web mixed-channel turns; expected behavior is ordered contiguous-source turns for ordinary messages, with assistant-prompt skill commands starting from a fresh runtime session.

### P1 RM-2026-04-25-05 Workspace Autopilot Resource Governance

- Status: `proposed`
- Source: 2026-04-25 task-run logs; 2026-04-26 interrupted autopilot visible reply incident
- Summary: 主动模式不能长期占用 Codex、制造过程性文本、消耗上下文或影响飞书回复；它需要更窄的 health-check contract、短超时和独立会话/模型策略。
- Current state:
  - Autopilot is a low-priority background task, skips busy workspace queues, backs off repeated failures, suppresses preempted visible replies, and no longer injects recent chat history into hidden prompts.
  - `docs/ARCHITECTURE.md` documents the current autopilot execution and preemption contract.
- Next action:
  - Convert autopilot from general agent prompt into bounded health-check jobs that emit structured `no_op | action | risk`.
  - Use a dedicated runtime session or no-session mode so autopilot cannot pollute the main conversation/session.
  - Add a visible `/autopilot status` reason trail: last run, skip reason, failure streak, next run, quota pause, and last published action.

### P1 RM-2026-04-25-06 Feishu Mention, Slash Command, And Binding UX

- Status: `proposed`
- Source: 2026-04-25 user “还有一些点想不起来了”; local DB examples
- Summary: 飞书群聊里的 @机器人 slash command、绑定/建群引导和不可处理原因必须明确可见，不能静默失败。
- Current state:
  - Known risk: display-name regex stripping can fail for bot names with spaces, e.g. `@Co仔 (mac) /where`.
  - Bot-added group guidance is still less explicit than Telegram.
- Next action:
  - Strip Feishu mention prefixes using Feishu mention metadata rather than display-text regex.
  - Add regression tests for `@Name With Space /where`, slash command with images/files, group mention gating, and managed command phrases.
  - Send concise visible reasons for mention policy, missing binding, unknown command, or authorization skips when safe.

### P2 RM-2026-04-25-07 Codex Runtime Health And Model Guardrails

- Status: `proposed`
- Source: 2026-04-25 local logs; Codex model picker and diagnostic leakage follow-ups
- Summary: Codex model discovery, metadata refresh, context-window errors and runtime diagnostics need proactive guardrails so user-facing Feishu replies do not expose raw JSON/errors or silently degrade.
- Current state:
  - `/model` uses live `codex debug models` before cache/preset fallback and preserves the current effective model in UI options.
  - Known Codex model metadata and WebSocket transport diagnostics are stripped from assistant-visible output.
  - `docs/RUNTIME.md` documents effective Codex model/effort resolution.
- Next action:
  - Preflight effective Codex model before dispatch; if unavailable or metadata refresh hangs, fail fast with concise operator guidance.
  - Add final-send boundary classifiers for context-window/raw JSON errors so they are never persisted or sent as final user-visible正文.
  - Add runtime health cache with TTL and error budget to avoid per-turn slow model discovery.

### P2 RM-2026-04-25-08 Operator Observability Surface

- Status: `proposed`
- Source: 2026-04-25 cross-cutting reliability work
- Summary: Web Monitor and IM `/self-status` should expose the same operator truth: launch mode, exact restart command, Feishu channel readiness, queue/dead-letter state, active runners, autopilot state, recent delivery failures and current runtime identity.
- Current state:
  - `/status` and `/self-status` expose compact Feishu lifecycle issue summaries.
  - `/self-status` exposes restartability, launch source, exact command, build state, self-check result, and direct-backend warnings.
  - Web Monitor still does not present all of the same operator truth in one place.
- Next action:
  - Build a compact health summary API consumed by `/self-status`, `/status`, and Web Monitor.
  - Add recent failure timelines for Feishu lifecycle, queue dead letters, runner exits, and restart intents.
  - Include safe commands: canonical start, canonical restart, current saved launch command, and warning when they differ.
