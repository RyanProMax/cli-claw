# 当前任务：股票策略自迭代调度节奏修正

> **给 agentic workers：** 本轮计划统一维护在 `PLANS/ACTIVE.md`；不得在 `docs/superpowers/`、`docs/**/plans/` 或 `docs/**/specs/` 新增计划。一次只推进一个 milestone；validation 和 review 均通过后才可提交。

## 背景与问题

上一轮把 `stock-strategy-loop-review` 设成 6 小时一次，适合成熟策略复盘，但不适合“还没有成熟策略”的前期策略发现。当前 stock-analysis-api 已有 `alpha_scan.py`、`alpha_research_loop.py`、strategy registry、judge gate 和 task-chain 记录；因此更合理的做法是把调度拆成阶段化闭环，而不是让单个 6h review 承担策略挖掘。

用户指出的问题成立：

- 没有成熟策略时，6h review 容易空转，策略推演和回测推进太慢。
- 前期策略挖掘应使用更短间隔，但必须受 usage、数据新鲜度、重复运行和风控边界约束。
- 成熟策略后再降频复盘是合理的，但不应提前套用成熟期节奏。

## 修正目标

- 保留旧股票定时链路暂停状态，不恢复分钟级脚本 tick。
- 新增短间隔 discovery workflow task，用于策略发现期：
  - 默认 30 分钟一次。
  - 先运行确定性 local task：`alpha_scan` + 离线 `alpha_research_loop`。
  - 再由 readonly role 做候选审阅和下一步验证计划。
  - 不 approve、不 activate、不下单、不 `unlock_trade`。
- 保留 6h `stock-strategy-loop-review`，但明确定位为“成熟策略 / 候选策略复盘”，不再作为前期挖掘主循环。
- 在文档和 roadmap 中明确阶段化节奏：
  - Discovery：30 分钟。
  - Candidate validation：约 2 小时或由 discovery 输出触发。
  - Paper/live observation：盘中 5-15 分钟确定性脚本观察，不启动 Agent 推理。
  - Mature review：6 小时或盘后复盘。
- scheduled workflow 继续受 OpenAI 5h / 7d usage guard 保护；低于 30% 自动延后。

## 目标架构

```text
探索期：stock-strategy-discovery-loop (30m)
  -> usage guard
  -> local_task: stock.strategy.collect_results
  -> local_task: stock.strategy.discovery_cycle
  -> role_task: stock-strategy-discovery-reviewer
  -> role_task: stock-strategy-iteration-planner

成熟/候选复盘：stock-strategy-loop-review (6h)
  -> usage guard
  -> collect_results
  -> task review
  -> analyze_value
  -> value analyst
  -> iteration planner
```

关键边界：

- discovery local task 可以读本地行情仓、运行 summary-only scan/research/backtest CLI。
- discovery 默认不写 strategy registry；只有显式 input `recordToRegistry=true` 时，才允许记录 candidate/evaluation/proposal，不允许 approve/activate。
- Agent role 只消费 structured artifacts 并输出中文审阅/计划。
- 盘中 paper/live 观察应优先走确定性脚本，避免每 5-15 分钟消耗 Agent quota。

## Milestones

### Milestone 1：Discovery Workflow And Local Task

Objective:

- 新增 `stock-strategy-discovery-loop` workflow 和 `stock.strategy.discovery_cycle` local task，支持短间隔策略候选发现和离线研究循环。

Allowed scope:

- `PLANS/ACTIVE.md`
- `.agents/workflows/stock-strategy-discovery-loop.json`
- `.agents/agent-roles/stock-strategy-discovery-reviewer.md`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/tools.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`

Validation:

- TDD 红测：workflow config discovery 接受 `stock.strategy.discovery_cycle`。
- TDD 红测：`discovery_cycle` 调用 `alpha_scan.py` 与 `alpha_research_loop.py`，任一市场失败时返回 degraded 子结果而不打断 workflow。
- `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts`
- `npm run typecheck`

Status: `done`

Validation status: `passed`

Review status: `passed`

### Milestone 2：Install Phase-Aware Scheduling

Objective:

- 安装 `stock-strategy-discovery-loop` scheduled workflow task，默认 30 分钟一次；保留 `stock-strategy-loop-review` 6 小时成熟复盘任务；确认旧任务继续 paused / disabled。

Allowed scope:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- local SQLite scheduled task state

Validation:

- SQLite 查询确认：
  - `stock-loop-progress-notifier` paused
  - `stock-watch-feishu-20260427-0208` paused
  - `stock-strategy-discovery-loop` active interval 1800000
  - `stock-strategy-loop-review` active interval 21600000
- `launchctl print-disabled gui/$(id -u)` 确认 `com.ryan.stock-analysis-task-chain` disabled。
- `./scripts/validate.sh`
- `./scripts/review.sh`
- 安全重启并确认 `/api/health`。

Status: `done`

Validation status: `passed`

Review status: `passed`

## Handoff

Current milestone: none

Current status: 本轮节奏修正已完成。旧股票脚本定时链路保持冻结；新增 `stock-strategy-discovery-loop` scheduled workflow 作为策略发现期主循环，默认 30 分钟一次；保留 `stock-strategy-loop-review` 作为成熟/候选复盘，默认 6 小时一次。

Validation evidence:

- `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts`：通过，覆盖 discovery workflow 配置和 degraded market 子结果。
- `./scripts/validate.sh`：通过，75 个 test file 通过、1 个 skipped；519 个 test 通过、1 个 skipped；`make typecheck`、backend/web/agent-runner build 均通过。
- `./scripts/review.sh`：通过自动 review gate；人工语义 review 未发现 blocking finding。
- `git diff --check`：通过。
- SQLite scheduled task 查询确认：
  - `stock-loop-progress-notifier`：`paused`
  - `stock-watch-feishu-20260427-0208`：`paused`
  - `stock-strategy-discovery-loop`：`workflow` / `interval=1800000` / `active`
  - `stock-strategy-loop-review`：`workflow` / `interval=21600000` / `active` / `next_run=2026-05-20T21:50:29.000Z`
- `launchctl print-disabled gui/$(id -u)`：`com.ryan.stock-analysis-task-chain => disabled`。
- 安全重启：`bun src/cli.ts restart` 创建 `restart-2026-05-20T16-27-51-233Z-512e725f.json`，随后 `/api/health` 返回 `healthy`。
- 首轮真实运行：`stock-strategy-discovery-loop` 于 `2026-05-20T16:30:52.323Z` 触发，`duration_ms=136491`，状态 `success`；workflow run `wfrun_841f8fd4-5ad8-458e-a41f-a45bb1528cba` 四个节点均为 `success`，下一次 `next_run=2026-05-20T17:00:00.000Z`。

Review notes:

- Scope stayed inside the milestone allowed scope plus local SQLite scheduled state.
- Discovery workflow is phase-specific and readonly: local deterministic scan/research first, Agent role only reviews structured artifacts and plans validation.
- `recordToRegistry` default is `false`; explicit `true` only passes `--record-to-registry` to research loop and role cards still forbid approve / activate / broker actions.
- Degraded market or CLI result is preserved as a sub-artifact instead of aborting the whole workflow.
- 首轮 planner 输出符合阶段化节奏：US `momentum_5d` 进入补证候选验证，HK 暂停相同配置重复重跑，CN 因 `scanned=0` 先补 universe / 扫描链路证据。

Open question:

- 无阻塞。下一步继续观察后续 discovery 是否按 `next_run=2026-05-20T17:00:00.000Z` 循环；若 usage 消耗过快，再改为“本地 discovery 每 30 分钟 + Agent review 每 2 小时”。
