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
- Source: 2026-04-25 user request item `2`; `/self-status` and safe restart hardening
- Summary: 长期运行和安全重启入口必须收敛到 `cli-claw start` / `cli-claw restart`；开发直启路径只能作为调试入口，并且状态面必须清楚标注差异。
- Durable contract:
  - Canonical command behavior lives in `docs/COMMAND.md`.
  - Runtime launch/source/build-state semantics live in `docs/RUNTIME.md`.
- Next action:
  - Monitor the next `/self-status` / `/self-restart` cycle for launch-source drift.
  - Decide whether this dev machine should install/link `cli-claw` onto PATH so operator shells do not need repo-local fallback commands.

### P0 RM-2026-04-25-01 Feishu Message Reliability Control Plane

- Status: `monitoring`
- Source: 2026-04-25 user request item `1`; 2026-04-26 Feishu incidents
- Summary: 飞书消息链路必须以真实输入/输出流程作为回归基线，覆盖 inbound SDK event、DB、queue、runner output、Feishu payload、cursor 和 lifecycle。
- Durable contract:
  - Message flow and visibility contracts live in `docs/ARCHITECTURE.md`.
  - Restart/recovery context boundaries live in `docs/MEMORY.md`.
  - Runtime/card output boundaries live in `docs/RUNTIME.md`.
- Next action:
  - Keep real-flow E2E as the required gate for Feishu message visibility, restart recovery, streaming card, cursor, or output-boundary changes.
  - Add/review structured logs at output-affecting boundaries so one inbound `messageId` can reconstruct inbound -> queued -> runner -> visible text -> Feishu payload -> cursor commit.

### P1 RM-2026-04-25-03 Feishu Answer/Commentary Presentation Contract

- Status: `monitoring`
- Source: 2026-04-25 user request items `3` and `4`; visible Feishu/Web process-text incidents; 2026-04-29 streaming card parity work
- Summary: 飞书主正文只展示当前 turn 的 runtime answer；thinking、commentary、工具步骤、内部诊断和长日志必须进入独立折叠区、Web 调试区或 run log，默认不能挤占正文。
- Durable contract:
  - Feishu streaming card presentation lanes and fallback rules live in `docs/RUNTIME.md`.
  - Final visible reply filtering lives in `reply-visibility` and is documented in `docs/RUNTIME.md`.
- Recent progress:
  - 2026-05-08: Codex ACP thought/message events are classified at ingress: `agent_thought_chunk` stays in `Thinking`, the current `agent_message_chunk` / `text_delta` is the live body candidate, and older assistant messageIds are demoted into `Thinking`.
  - 2026-05-08: Feishu/Web merged Codex process/commentary with model thinking into a single `Thinking` section; there is no separate “过程” panel, and process-only terminal finals stay out of正文.
  - 2026-05-08: Fixed a Codex `/research` regression where long process narration plus a structured report title was classified entirely as `Thinking`; strong report titles now split the preamble into `Thinking` and keep the report正文 visible.
  - 2026-05-09: Reopened the same-message/no-commentary variant after local Codex transcript review showed formal assistant `phase` values. Codex `phase: "commentary"` now routes to unified `Thinking`, and `phase: "final_answer"` routes to正文 / terminal final output; natural-language progress-prefix classification is no longer the normal presentation contract.
  - 2026-05-09: Real Feishu regression showed `codex-acp` chunks can omit phase even though Codex native JSONL transcript has it. Runner now uses the transcript `event_msg.payload.phase` as the authoritative fallback source for current-turn commentary/final reconstruction.
- Next action:
  - Monitor real Feishu turns for stale steps, missing live body, or process preambles entering the main body.
  - Harden `send_message` visible-tool policy so tool-sent content follows the same answer/commentary boundary.
  - Add per-channel concise reply budgets for Feishu final answers.

### P1 RM-2026-04-25-04 First-Turn Session Isolation And Context Leakage

- Status: `monitoring`
- Source: 2026-04-25 user request item `5`; restart recovery and resume-gate incidents
- Summary: 激活/重启/clear 后的首轮回复必须只回答当前消息；连续性只由底层 agent runtime session 提供，Cli Claw 消息数据库只用于审计和溯源。
- Durable contract:
  - Memory/recovery boundaries live in `docs/MEMORY.md`.
  - Runtime session and channel/source boundaries live in `docs/RUNTIME.md`.
- Next action:
  - Keep real-flow E2E for restart first turn and interrupted pending recovery as a required regression gate.
  - Monitor real Feishu/Web mixed-channel turns; expected behavior is ordered contiguous-source turns, with assistant-prompt skill commands starting from a fresh runtime session.

### P1 RM-2026-04-25-06 Feishu Mention, Slash Command, And Binding UX

- Status: `proposed`
- Source: 2026-04-25 user “还有一些点想不起来了”; local DB examples
- Summary: 飞书群聊里的 @机器人 slash command、绑定/建群引导和不可处理原因必须明确可见，不能静默失败。
- Next action:
  - Strip Feishu mention prefixes using Feishu mention metadata rather than display-text regex.
  - Add regression tests for `@Name With Space /where`, slash command with images/files, group mention gating, and managed command phrases.
  - Send concise visible reasons for mention policy, missing binding, unknown command, or authorization skips when safe.

### P1 RM-2026-05-16-01 Stock KOL Agent Handoff For Strategy Iteration

- Status: `in_progress`
- Source: 2026-05-16 user feedback that scans are not useful before a strategy/self-iteration chain is actually running
- Summary: `stock-analysis-api` task-chain can now pause `strategy_iteration` when `kol_scan` returns `agent_required`, but Cli Claw still needs an operator-safe handoff that executes the `stock-kol-intel` assistant prompt and writes a final KOL report back to the task-chain evidence stream.
- Durable contract:
  - Task-chain scheduling semantics live in `/Users/ryan/projects/stock-analysis-api/docs/specs/task-chain-worker.md`.
  - Cli Claw presentation and Agent execution boundaries should stay aligned with `docs/RUNTIME.md`.
- Recent progress:
  - 2026-05-16: Added `scripts/stock-handoff-agent-bridge.mjs`, which creates deterministic `execution_type=agent`, `schedule_type=once` tasks from stock P1b handoffs without pre-claiming them; the scheduled agent claims the exact handoff id at runtime before complete/fail. The bridge supports stock SQLite input and exported JSON fixtures, and is covered for deterministic task creation plus idempotency.
  - 2026-05-16: Ran the bridge against the real stock task-chain DB and Cli Claw DB; it returned `created=0`, `skipped_existing=0`, `ignored=0` because the stock handoff queue is currently empty.
  - 2026-05-16: Generated a real `kol_scan` handoff probe and bridged it into Cli Claw task `stock-handoff-7a966070-7522-4eb1-90c4-a41682bf3fa1`. Scheduler execution exposed that Codex login failures can surface as final text (`Not logged in · Please run /login`), so `runTask()` now classifies that runtime text as a task error, finalizes the scheduled task row with the error, and keeps the task in `runningTaskIds` until the agent process exits.
- Next action:
  - Restart Cli Claw, ensure Codex login/readiness is available for scheduled task workspaces, then retry or requeue the pending stock handoff and verify the scheduled agent writes a final KOL report back through `handoff complete`.
  - Add execution-log sweep / retry handling for scheduled agent tasks that fail before calling stock `handoff fail`.

### P2 RM-2026-04-25-07 Codex Runtime Health And Model Guardrails

- Status: `proposed`
- Source: 2026-04-25 local logs; Codex model picker and diagnostic leakage follow-ups
- Summary: Codex model discovery, metadata refresh, context-window errors and runtime diagnostics need proactive guardrails so user-facing replies do not expose raw JSON/errors or silently degrade.
- Recent update:
  - 2026-05-06: Added classifiers for Codex remote compact `unknown_parameter safety_identifier` errors at runner and host boundaries so raw JSON no longer reaches Feishu/Web正文.
- Next action:
  - Preflight effective Codex model before dispatch; if unavailable or metadata refresh hangs, fail fast with concise operator guidance.
  - Continue expanding final-send boundary classifiers for remaining context-window/raw JSON errors so they are never persisted or sent as final user-visible正文.
  - Add runtime health cache with TTL and error budget to avoid per-turn slow model discovery.

### P2 RM-2026-04-25-08 Operator Observability Surface

- Status: `proposed`
- Source: 2026-04-25 cross-cutting reliability work
- Summary: Web Monitor and IM `/self-status` should expose the same operator truth: launch mode, exact restart command, Feishu channel readiness, queue/dead-letter state, active runners, recent delivery failures and current runtime identity.
- Next action:
  - Build a compact health summary API consumed by `/self-status`, `/status`, and Web Monitor.
  - Add recent failure timelines for Feishu lifecycle, queue dead letters, runner exits, and restart intents.
  - Include safe commands: canonical start, canonical restart, current saved launch command, and warning when they differ.
