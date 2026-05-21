# 当前任务：股票策略定时任务失败修复与调研效率评估

> **给 agentic workers：** 本轮计划统一维护在 `PLANS/ACTIVE.md`；不得在 `docs/superpowers/`、`docs/**/plans/` 或 `docs/**/specs/` 新增计划。一次只推进一个 milestone；validation 和 review 均通过后才可提交。

## 背景

股票策略自迭代链路已经切到 Cli Claw scheduled workflow：

- `stock-strategy-discovery-loop`：探索期 30 分钟一次，负责短间隔 alpha discovery、审阅候选、规划下一步。
- `stock-strategy-loop-review`：成熟/候选复盘期 6 小时一次，负责 review task-chain / ledger / backtest evidence 并规划迭代。

用户反馈当前定时任务存在报错失败；同时策略调研效率仍偏低，需要回顾今天完整链路，估算按当前效率多久能产出一条可用策略，并提出优化方案。

## 调试原则

- 使用 systematic debugging：先读错误、复现/收集证据、定位根因，再改代码。
- 不在根因未确认前调整调度间隔或跳过失败。
- 禁止引入真实交易、自动 approve、自动 activate。

## 目标

- 找出当前失败的 scheduled task / workflow run / step，并定位失败层级。
- 修复会导致定时任务报错失败的根因，避免下一轮继续失败。
- 保持 usage guard、workflow 审计、只读安全边界不退化。
- 基于今天真实链路评估当前策略调研效率：
  - 30 分钟 discovery 实际发现了什么。
  - 哪些步骤重复消耗但没有新增证据。
  - 按当前效率多久可能生成一条可用策略。
  - 提出可落地优化方案，并把跨轮次事项同步到 roadmap。

## 非目标

- 本轮不直接上线实盘策略。
- 本轮不绕过人工 review，也不把候选自动 approve / activate。
- 未确认根因前不批量重排所有定时任务。

## Milestones

### Milestone 1：定位并修复失败定时任务

Objective:

- 让当前报错的股票策略定时任务恢复到可运行、可审计、失败可解释的状态。

Allowed scope:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `.agents/agent-roles/*stock-strategy*.md`
- `.agents/workflows/stock-strategy-*.json`
- `src/core/runtime/**`
- `src/agent/scheduler/**`
- `src/agent/workflow/**`
- `tests/unit/core/runtime/**`
- `tests/unit/agent/scheduler/**`
- `tests/integration/scheduler/**`
- `tests/unit/agent/workflow/**`

Validation:

- 读取真实 scheduled task / workflow run / step log，记录根因证据。
- 针对修复点补充或更新测试。
- 运行相关测试。
- `npm run typecheck`
- `./scripts/review.sh`
- `git diff --check`
- 必要时 `./scripts/validate.sh`
- 若影响运行服务，提交后安全重启并确认 `/api/health`

Status: `done`

Validation status: `passed`

Review status: `passed`

## 根因证据

- 真实 `workflow_runs`（2026-05-21）显示：`stock-strategy-discovery-loop` 16 次 success / 4 次 error，`stock-strategy-loop` 1 次 success / 1 次 error；error 均发生在最终 `plan_next_iteration`，上游 `collect_results`、`discover_candidates` / `analyze_value`、review 节点已完成。
- 失败类型为 OpenAI runtime transient：`server_is_overloaded`、`service_unavailable_error`、`server_error`、`ECONNRESET` / `UND_ERR_SOCKET`。旧 transient 判断漏掉 overload/server_error，导致最终 planner 直接打断整轮。
- `task_run_logs`（2026-05-21）显示 `stock-strategy-discovery-loop` 20 次 success / 12 次 error，`stock-strategy-loop-review` 2 次 success / 1 次 error；最新 error 多为 `OpenAI usage guard unavailable... socket connection was closed unexpectedly`。这类情况本质是“未启动/延期”，不应污染为任务失败。
- scheduler 之前没有识别 `/workflow` 命令返回的 `❌ 工作流 ... 失败：...` 文本，导致真实 workflow 失败可能被 task run 记为 success。

## 调研效率评估

- 今天 discovery 实际只产出 1 个可人工复核的候选：US `alpha_topn_momentum_5d.20260521`。它仍是 `candidate_only`，有效扫描仅 5 个符号，OOS/backtest.periods 未展开，且与既有 `momentum_20d` 同属动量家族，需要 champion/challenger 验证。
- HK 多轮仍围绕 `momentum_5d`、`momentum_20d`、`volume_change_5d`，有效 universe 约 4 个符号且全部 blocked；CN 多轮 `scanned=0` / `strategy_proposal_missing`，属于覆盖或链路前置问题；KOL 情报为 `agent_required` 且 `content_chars=0`。
- 按当前链路效率，30 分钟高频 discovery 可以较快暴露“一个候选/一批缺口”，但无法自动把候选推进到可用策略。若不加入候选验证状态机，连续几天也可能只是在重复包装同一批证据；要生成一条可用策略，需要先补 candidate validation，而不是继续堆 discovery 轮次。
- 优化方向已同步 `PLANS/ROADMAP.md`：增加 discovery -> candidate_validation -> paper_trial -> mature_review 状态推进、evidence signature 去重、CN/HK coverage 修复、US 动量家族候选验证，以及本地 `stock.strategy.validate_candidate` 任务。

## Handoff

Current milestone: Milestone 1

Current status: 已完成修复、效率复盘、验证与 review gate。

Validation evidence:

- 已通过：`npm test -- tests/unit/agent/workflow/engine.test.ts tests/unit/agent/scheduler/workflow-task.test.ts tests/integration/scheduler/workspace-cwd.test.ts tests/unit/core/runtime/openai-codex-usage.test.ts`
- 已通过：`npm run typecheck`
- 已通过：`./scripts/review.sh`
- 已通过：`git diff --check`
- 已通过：`./scripts/validate.sh`（全量 Vitest 75 passed / 1 skipped，524 passed / 1 skipped；typecheck；backend/web/agent-runner build）

Review notes:

- Scope check passed：改动均在 Milestone 允许范围内，且已补入 `src/core/runtime/**` 与 `tests/unit/core/runtime/**`。
- Objective check passed：usage guard 延期不再误报 task error，workflow 失败文本会落成 task error，OpenAI transient overload/server/socket 错误会重试或对股票策略最终 planner 降级输出只读计划。
- Docs check passed：`docs/RUNTIME.md`、`docs/COMMAND.md` 已同步 usage guard、workflow failure、股票策略 planner fallback 口径；`PLANS/ROADMAP.md` 已记录调研效率优化后续项。

Open question:

- 是否立即实现 `stock.strategy.validate_candidate` 本地任务属于下一轮 scope；本轮只把跨轮次事项写入 roadmap。
