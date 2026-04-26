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
- Summary: 飞书消息链路已经具备 lifecycle、delivery-gated cursor、startup recovery、runner residue cleanup、streaming-card progress、shutdown partial suppression 和 interrupted-resume confirmation gate；下一步只保留真实流量观察和更完整 E2E 覆盖。
- Durable contract:
  - Message reliability and visibility contracts live in `docs/ARCHITECTURE.md`.
  - Restart/recovery context boundaries live in `docs/MEMORY.md`.
  - Self-restart/operator command contracts live in `docs/COMMAND.md` and `docs/RUNTIME.md`.
- Current state:
  - Latest applied evidence: commit `357f756 Gate interrupted context resume`; safe restart `restart-2026-04-26T11-34-00-685Z-5b68e5d4` passed; `/api/health` was healthy for PID `14317`.
  - Post-restart process check showed one backend and current runner group only; no historical orphan runner group was visible.
  - Feishu E2E harness exists for inbound SDK event handling, lifecycle DB writes, notifier wakeup, duplicate/stale/mention cases, and managed restart phrase handling.
  - Feishu E2E success-path coverage now drives a real inbound SDK event through real `GroupQueue`, a deterministic fake runner, real `StreamingCardController` card create/update, lifecycle evidence from `queued` through `cursor_committed`, and persisted cursor state.
- Next action:
  - Monitor the next real Feishu turn that has interrupted residue; expected behavior is a confirmation prompt, not automatic stale-context replay.
  - Add retry/failure E2E cases only for concrete remaining gaps found in real incidents or lifecycle evidence.

### P1 RM-2026-04-25-03 Feishu Answer/Commentary Presentation Contract

- Status: `proposed`
- Source: 2026-04-25 user request items `3` and `4`; visible Feishu/Web process-text incidents
- Summary: 飞书主正文只展示最终答案；commentary、工具过程、内部诊断、主动模式收敛检查和长日志必须进入独立折叠区、Web 调试区或 run log，默认不能挤占正文。
- Current state:
  - Shared stream presentation already has answer/commentary concepts and Feishu cards can render auxiliary progress.
  - Graceful shutdown partials and known Codex transport/model diagnostics are suppressed from user-visible正文.
  - Codex-specific prompt policy and `send_message` visible-tool policy still need hardening.
- Next action:
  - Inject the minimal reply policy into Codex ACP prompts and add tests proving Claude/Codex receive equivalent visible-reply guidance.
  - Tighten `shared/stream-presentation.ts`, `src/reply-visibility.ts`, `src/feishu-streaming-card.ts`, and `container/agent-runner/src/mcp-tools.ts` so process text cannot become Feishu main body by default.
  - Add per-channel concise reply budgets for Feishu final answers.

### P1 RM-2026-04-25-04 First-Turn Session Isolation And Context Leakage

- Status: `proposed`
- Source: 2026-04-25 user request item `5`; restart recovery and resume-gate incidents
- Summary: 激活/重启/clear 后的首轮回复必须只回答当前消息，除非用户显式要求恢复上下文；历史上下文和 recovery context 不能让 agent “继续上一轮”。
- Current state:
  - Startup recovery ignores internal prompt/command/assistant/system rows.
  - Interrupted residual context now requires explicit user confirmation before old context can be replayed.
  - `docs/MEMORY.md` documents the current recovery and resume boundaries.
  - Runtime sessions are still keyed by `(folder, agentId)`, not by runtime slot; this limitation is documented in `docs/RUNTIME.md`.
- Next action:
  - Split “crash recovery for uncommitted pending work” from ordinary activation after idle/restart; only true crash recovery may inject compact history.
  - Add regression tests for restart first-turn, `/clear` first-turn, autopilot/no-op history, and Codex context-window auto-reset.
  - Revisit session-slot design for `(folder, agentId, agentType)` before supporting per-runtime session restoration.

### P1 RM-2026-04-25-05 Workspace Autopilot Resource Governance

- Status: `proposed`
- Source: 2026-04-25 task-run logs; 2026-04-26 interrupted autopilot visible reply incident
- Summary: 主动模式不能长期占用 Codex、制造过程性文本、消耗上下文或影响飞书回复；它需要更窄的 health-check contract、短超时和独立会话/模型策略。
- Current state:
  - Autopilot is a low-priority background task, skips busy/pending IM work, backs off repeated failures, and suppresses preempted visible replies.
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
