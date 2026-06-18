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

### P1 RM-2026-06-18-01 GitHub Email History Remote Push

- Status: `proposed`
- Source: 2026-06-18 user request to replace `627311610@qq.com` with the GitHub-associated email in local config and historical commits.
- Summary: 当前设备全局 / local git author 与 committer identity 已为 `Ryan <ryan.pro.1024@gmail.com>`；`agent-skills`、`balance-master`、`ryanpromax.github.io`、`stock-analysis-api`、`vscode-settings` 已创建 bundle 备份并本地重写历史，只替换 author/committer email。远端更新仍被本机 GitHub HTTPS credential helper / SSH 连接状态阻塞：`git push --dry-run --force-with-lease` 仍报 `failed to get: -25308` / `could not read Username for 'https://github.com': terminal prompts disabled`；`gh auth status` 显示未登录；带 `BatchMode` / `ConnectTimeout` 的 SSH probe 报 `Could not resolve hostname github.com`。
- Durable contract:
  - 本轮备份目录：`/tmp/agent-fabric-email-rewrite-20260618100606`
  - rewrite 后推送必须使用 `--force-with-lease`，并以备份中的 `*.refs.before` 作为旧 refs 核对依据。
- Next action:
  - 恢复本机 GitHub HTTPS 凭据或 SSH 连接后，依次执行以下安全推送：
    - `/Users/ryan/projects/agent-skills`: `git push --force-with-lease=refs/heads/main:fbfd007a770acbfe16ea4706782b615804b3fbed origin main:refs/heads/main`
    - `/Users/ryan/projects/balance-master`: `git push --force-with-lease=refs/heads/main:d37ec100aeb7e9d9e25ade91161f9269b69879f4 origin main:refs/heads/main`
    - `/Users/ryan/projects/balance-master`: `git push --force-with-lease=refs/heads/develop:2f3b648e60a3cd092e5414c9d7a6e0e5679f6a99 origin develop:refs/heads/develop`
    - `/Users/ryan/projects/ryanpromax.github.io`: `git push --force-with-lease=refs/heads/main:7cfb559fabe3c72344acf9d0627287bde3f8296e origin main:refs/heads/main`
    - `/Users/ryan/projects/stock-analysis-api`: `git push --force-with-lease=refs/heads/main:0f8497c8de3376efe1ae086405661a1016bbb8e3 origin main:refs/heads/main`
    - `/Users/ryan/projects/vscode-settings`: `git push --force-with-lease=refs/heads/master:2ece51f4b045767f58bc1d9db9a12c12fba2133b origin master:refs/heads/master`
  - 推送后重新扫描相关 repo 的远端 refs，确认 `627311610@qq.com` 不再出现在目标历史中。

### P1 RM-2026-05-24-01 Workspace Thread Router UX

- Status: `monitoring`
- Source: 2026-05-24 user request to collapse the product mental model to workspace + task, hide conversation/session management, and make Feishu/WeChat private chats route across multiple workspaces.
- Summary: 已新增工作区线程与入口路由基础层：`threads` 记录主线、任务线程与 workflow 线程；`im_entry_routes` 记录飞书 / 微信入口默认工作区和活跃目标；Context Router 支持 `/where`、`/use`、`/to`、`/threads`、`/back`，并让 `/bind <workspace>` 退化为 `/use` 兼容别名。Web 文案收敛为“主线 / 任务线程 / 入口路由”，workflow context 创建时会关联 workflow 线程，静态 Web/IM 最终回复会追加工作区/线程来源 footer。
- Durable contract:
  - 工作区、线程与入口路由边界见 `docs/ARCHITECTURE.md`。
  - 线程与 runtime session / runner 对应关系见 `docs/RUNTIME.md`。
  - IM 入口路由命令见 `docs/COMMAND.md`。
  - workflow 与主线记忆隔离见 `docs/MEMORY.md`。
- Next action:
  - 真实飞书 / 微信私聊验证自然语言切换、“继续刚才那个任务”、回复带来源 footer 的 workflow 消息和 `/to` 单次投递；发现多候选歧义时应反问而不是静默串台。
  - 后续把内部 conversation-agent API 进一步重命名为 thread API，减少实现命名和产品心智的错位；本轮 Web 用户心智已先收敛。
  - 飞书 streaming card 的实时卡片 footer 仍主要展示 runtime 信息；如需要完全统一来源 footer，可继续把路由元数据下沉到 streaming card builder。

### P1 RM-2026-05-20-01 Retired Stock Strategy Self-Iteration Workflow

- Status: `monitoring`
- Source: 2026-05-20 user request to explore a stock strategy self-iteration workflow; 2026-05-27 user decision to remove it as a high-effort, low-confidence workflow.
- Summary: 股票策略自迭代已从活跃路线中移除。本轮删除 `stock-strategy-*` 内置 workflow、role card、scheduler 专用决策控制面、Web 状态聚合和相关 E2E；启动迁移清理未来 `stock-strategy-*` scheduled task 及其外键关联的 `task_run_logs`，历史 `workflow_runs` / `workflow_run_steps` 审计保留。旧本机股票定时链路、`stock-loop-progress-notifier`、`stock-watch-feishu-20260427-0208` 和 `maintenance-loop-heartbeat` 也保持冻结/删除状态。
- Durable contract:
  - scheduled workflow 的通用入口见 `docs/COMMAND.md`。
  - workflow local task 与 usage guard 边界见 `docs/RUNTIME.md`。
  - 当前内置股票相关 workflow 只保留 `/hkipo` 路径；文件定位见 `docs/MODULE.md`。
- Next action:
  - 仅监控是否还有 `stock-strategy-*` workflow 配置、role card、scheduled task 或文档入口被重新引入；除非重新定义目标、数据来源、验证标准和人工审批边界，不恢复该自迭代闭环。

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

- Status: `monitoring`
- Source: 2026-05-17 Workflow/Crew Graph Engine v1
- Summary: v1 已支持 `/workflow` 触发、独立 workflow context、LangGraph 编排、run/step 审计和 role tool allowlist；后续需要把运行记录、checkpoint、失败节点重跑和 retry attempt 展示成可操作控制台。
- Durable contract:
  - Workflow 上下文隔离见 `docs/MEMORY.md`。
  - Workflow 配置与 runner 边界见 `docs/RUNTIME.md`。
  - `/workflow` 用户入口见 `docs/COMMAND.md`。
- Next action:
  - 2026-05-22 已落地 Web `工作流` 看板 v1，并已将侧边栏 `任务` / `工作流` 整合为 `自动化` 一级入口：`/automations?tab=plans` 管理 workflow schedule 计划，`/automations?tab=runs` 查看当前运行，`/automations?tab=workflows` 聚合 `workflow_runs`、`workflow_run_steps`、`scheduled_tasks` 和 `task_run_logs` 展示 workflow 审计；单实例 session 登录后可查看全部工作区运行。看板同时支持编辑 / 删除定时 workflow task，但不修改 workflow 定义、不强制中断已启动 run。
  - 为 `workflow_run_steps` 补真实 retry attempt 递增，避免 LangGraph retry 覆盖同一 node attempt。
  - 在 `/workflow` 触发时记录 `triggerMessageId`，便于控制台从 run 回溯到触发消息。
  - 后续控制台增强可继续补 checkpoint 查看、失败节点重跑入口和 retry attempt 细节；v1 看板不改变调度或 checkpoint 状态。

### P0 RM-2026-04-25-02 Service Launch Command Contract

- Status: `monitoring`
- Source: 2026-04-25 user request item `2`; `/self-status` and safe restart hardening
- Summary: 长期运行和安全重启入口必须收敛到 `agent-fabric start` / `agent-fabric restart`；开发直启路径只能作为调试入口，并且状态面必须清楚标注差异。
- Durable contract:
  - Canonical command behavior lives in `docs/COMMAND.md`.
  - Runtime launch/source/build-state semantics live in `docs/RUNTIME.md`.
- Next action:
  - Monitor the next `/self-status` / `/self-restart` cycle for launch-source drift.
  - Decide whether this dev machine should install/link `agent-fabric` onto PATH so operator shells do not need repo-local fallback commands.

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
- Summary: 激活/重启/clear 后的首轮回复必须只回答当前消息；连续性只由底层 agent runtime session 提供，Agent Fabric 消息数据库只用于审计和溯源。
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
- Summary: IM `/self-status` and backend health/status APIs should expose the operator truth: launch mode, exact restart command, Feishu channel readiness, queue/dead-letter state, active runners, recent delivery failures and current runtime identity. 2026-05-23 精简 WebUI 时移除 Web Monitor 页面；后续若恢复 operator UI，应重新评估是否真的需要独立看板。
- Next action:
  - Build a compact health summary API consumed by `/self-status` and backend `/status` consumers.
  - Add recent failure timelines for Feishu lifecycle, queue dead letters, runner exits, and restart intents.
  - Include safe commands: canonical start, canonical restart, current saved launch command, and warning when they differ.
