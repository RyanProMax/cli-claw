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

### P1 RM-2026-05-18-03 HKIPO Official Document Parser

- Status: `monitoring`
- Source: 2026-05-18 `/hkipo` 核心结构与估值证据增强 E2E
- Summary: `/hkipo` 官方文件解析与核心因子 evidence v1 已上线：`stock.hkipo.fetch_official_docs` 会调用 stock-analysis-api `scripts/hkipo_official_docs.py`，从 HKEX title search 与 HKEX “新上市资料”表格定位招股章程/新上市公告等文件，下载到统一 cache namespace 后解析正文并输出结构化 evidence；`stock.hkipo.scan_heat` 已覆盖致富证券新股详情页 live snapshot，可补同日认购倍数、保荐、主营、发行市值和 PE。2026-05-18 真实 E2E run `wfrun_095c276e-e33d-4b37-a8fe-5a497552e04f` 中 4 只当前 IPO `same_day_heat_count=4`，官方文件 8 个，workflow 9 节点全成功，最终飞书消息已验证中文来源、具体认购倍数、无内部短码。2026-05-19 追加 TradeSmart IPO Tracker 孖展脉搏 source-specific parser，真实 smoke 已从公开页面解析当前 02723/03310/06872/00901 的 `margin_multiple`、`margin_amount_hkd_yi` 和观测时间；报告口径同步拆分 `margin_multiple=融资/孖展超额倍数` 与 `subscription_multiple=认购倍数`。
- Durable contract:
  - `/hkipo` workflow 与报告字段见 `docs/COMMAND.md`。
  - workflow local task artifact 边界见 `docs/RUNTIME.md`。
  - stock-analysis-api heat scanner schema 见 `/Users/ryan/projects/stock-analysis-api/docs/specs/hkipo-heat-scan-cli.md`。
  - stock-analysis-api official docs parser schema 见 `/Users/ryan/projects/stock-analysis-api/docs/specs/hkipo-official-docs-cli.md`。
- Next action:
  - 监控真实 `/hkipo` 输出中绿鞋、基石、回拨、公开发售比例、保荐、孖展/融资倍数、公开认购倍数、一手中签率、暗盘与估值区间字段覆盖率；针对缺口补 source-specific parser。
  - TradeSmart/AiPO 孖展脉搏可作为当前多券商聚合补充，但 AiPO 页面提示服务将关闭，不能作为唯一长期主源；继续补券商新股中心、AAStocks/ETNet 新闻与可验证聚合源 fallback。
  - 优化官方 PDF 解析耗时和 artifact 摘要预算；当前 cold cache 下官方 docs local task 使用 300s 有界预算。
  - 真实网页/PDF 结构变化时继续输出 source-level error 并降级，禁止最终报告编造字段。

### P2 RM-2026-05-18-02 HKIPO Name Alias Source Automation

- Status: `proposed`
- Source: 2026-05-18 `/hkipo` report readability regression
- Summary: Futu/OpenD 当前 HK IPO pool 会返回正确代码和申购状态，但部分 IPO 的中文名字段为空，只给英文简称；本轮先在 `stock-analysis-api` 数据层用 alias map 补齐当前池中文展示名，避免最终报告主标题显示英文。后续应把 alias map 改成可审计的自动化来源刷新，而不是长期手工维护。
- Durable contract:
  - `ipo-list --market HK` 输出名称分离字段见 `/Users/ryan/projects/stock-analysis-api/docs/specs/futu-internal-cli-contract.md`。
  - `/hkipo` workflow 最终报告中文名优先和普通文本气泡格式见 `docs/COMMAND.md`。
- Next action:
  - 增加只读名称补全来源，例如 HKEX/AAStocks/ETNet IPO 页面或官方文件元数据，输出 `name_source` 与更新时间。
  - 对 alias 过期或缺失建立降级提示，避免新 IPO 上架时再次退回英文主标题。

### P2 RM-2026-05-18-01 HKIPO Backtest Artifact Budget

- Status: `proposed`
- Source: 2026-05-18 `/hkipo` full-chain E2E
- Summary: `/hkipo` workflow 已能完整成功，但 `backtest_calibrator` 在线上 E2E 中耗时约 119 秒，并产生约 100KB step artifact。当前不会打断 workflow，但它会显著拉长用户等待时间，也会增加 role node 读取 structured artifacts 的 token 和解析负担。
- Durable contract:
  - Workflow local task 与 structured artifact 边界见 `docs/RUNTIME.md`。
  - `/hkipo` 用户入口与 9 节点 crew 见 `docs/COMMAND.md`。
- Next action:
  - 为 `stock.hkipo.run_backtest` 增加 summary-only 输出或 artifact 裁剪，只保留评分分桶、样本数量、首日胜率/中位数等报告必要字段。
  - 把 backtest local task 的预算和降级条件显式测试化，避免未来再次接近 workflow 长等待。

### P2 RM-2026-05-17-01 Workflow Console And Retry Audit

- Status: `proposed`
- Source: 2026-05-17 Workflow/Crew Graph Engine v1
- Summary: v1 已支持 `/workflow` 触发、独立 workflow context、LangGraph 编排、run/step 审计和 role tool allowlist；后续需要把运行记录、checkpoint、失败节点重跑和 retry attempt 展示成可操作控制台。
- Durable contract:
  - Workflow 上下文隔离见 `docs/MEMORY.md`。
  - Workflow 配置与 runner 边界见 `docs/RUNTIME.md`。
  - `/workflow` 用户入口见 `docs/COMMAND.md`。
- Next action:
  - 为 `workflow_run_steps` 补真实 retry attempt 递增，避免 LangGraph retry 覆盖同一 node attempt。
  - 在 `/workflow` 触发时记录 `triggerMessageId`，便于控制台从 run 回溯到触发消息。
  - 增加 Web 工作流控制台，展示 workflow runs、checkpoints、失败节点和重跑入口。

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
  - Add regression tests for `@Name With Space /status`, slash command with images/files, group mention gating, and managed command phrases.
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
  - 2026-05-16: Live retry after restart confirmed the stock handoff scheduled task now records `status=error`, completes the once task row, and does not rerun on the next scheduler cycle. The stock handoff remains `pending` because the scheduled task workspace still receives Codex login failure text before it can claim the handoff.
- Next action:
  - Fix scheduled-task workspace Codex login/readiness, then retry or requeue the pending stock handoff and verify the scheduled agent writes a final KOL report back through `handoff complete`.
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
