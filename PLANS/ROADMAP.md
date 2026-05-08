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
  - 2026-05-08: Codex `text_delta` is now routed to `commentaryText` / “过程” instead of answer/`partialText`; Feishu process text is sentence-split in its own panel while terminal raw final remains the only main-body answer source.
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
