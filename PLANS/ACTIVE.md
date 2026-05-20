# 当前任务：股票策略自分析 / 自迭代系统重构

> **给 agentic workers：** 本轮计划统一维护在 `PLANS/ACTIVE.md`；不得在 `docs/superpowers/`、`docs/**/plans/` 或 `docs/**/specs/` 新增计划。validation 和 review 均通过后才可提交。

## 目标

- 停用旧股票策略定时链路，避免 1 分钟 task-chain tick / 10 分钟盯盘 / Cli Claw 回推脚本继续并发影响重构。
- 基于 Cli Claw 现有 scheduler / workflow / structured artifact 架构，新增低频闭环：定时 review 任务结果 -> 分析实盘、模拟盘或回测策略价值 -> 规划下一轮只读迭代方向 -> 循环。
- 每次 scheduled agent / scheduled workflow 执行前检查 OpenAI Codex usage；5h 或 7d 剩余额低于 30% 时不启动 Agent，并延后到 reset time 或保守重试。
- 保留交易安全边界：默认只读 / paper-only；不真实下单、不 `unlock_trade`、不自动 approve strategy、不自动 activate strategy。

## 最佳实践依据

- [QuantConnect walk-forward optimization](https://www.quantconnect.com/docs/v2/writing-algorithms/optimization/walk-forward-optimization)：参数应按 trailing window 低频再优化，过高频率会增加过拟合风险。
- [QuantConnect research guide](https://www.quantconnect.com/docs/v2/cloud-platform/backtesting/research-guide)：限制 backtest 次数和参数自由度，把策略研究输出限定为可验证假设。
- [TradingStrategy.ai backtesting guide](https://tradingstrategy.ai/docs/learn/backtesting.html)：区分 in-sample development、walk-forward analysis 和 out-of-sample validation。
- [Bailey 等 PBO paper](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)：把过拟合视为策略选择过程风险，避免把 IS 最优直接当 OOS 可用。
- [OpenAI eval best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)：Agent 结果需要可审计 trace / artifact / eval，而不是一次自然语言判断。

## 已落地状态

- 旧 Cli Claw scheduled tasks 已保持暂停：
  - `stock-loop-progress-notifier` -> `paused`
  - `stock-watch-feishu-20260427-0208` -> `paused`
- 旧 launchd tick 已禁用：
  - `com.ryan.stock-analysis-task-chain` -> `disabled`
- 新 scheduled workflow task 已安装：
  - `stock-strategy-loop-review`
  - `execution_type='workflow'`
  - `script_command='stock-strategy-loop'`
  - `schedule_type='interval'`
  - `schedule_value='21600000'`，即 6 小时一次
  - `status='active'`
  - `next_run='2026-05-20T21:50:29.000Z'`
- `maintenance-loop-heartbeat` 和 `stock-analysis-api` API 服务保留不动。

## 目标架构

```text
Cli Claw scheduled workflow task
  -> usage guard: OpenAI 5h / 7d remaining >= 30%
  -> local_task: stock.strategy.collect_results
  -> role_task: stock-strategy-task-reviewer
  -> local_task: stock.strategy.analyze_value
  -> role_task: stock-strategy-value-analyst
  -> role_task: stock-strategy-iteration-planner
  -> final report + structured artifacts + workflow audit
```

职责边界：

- Cli Claw scheduler：负责定时、usage guard、workflow task 执行、结果投递、run log、billing gate。
- Cli Claw workflow：负责 role 分离、artifact 串联、workflow run/step 审计。
- stock-analysis-api：继续负责只读数据、task-chain 历史、paper/live ledger、alpha daily report、alpha backtest、strategy registry。
- Agent role：只做 review、价值判断和迭代规划；不得直接修改 registry 或 broker。

## Milestones

### Milestone 1：Scheduled Task Usage Guard

Status: `done`

Validation status: `passed`

Review status: `passed`

Result:

- 新增 `src/agent/scheduler/usage-guard.ts`，集中判断 5h / 7d usage 阈值、reset time、usage unavailable 与缺失字段。
- scheduled agent / workflow 启动前会读取 OpenAI usage；低于阈值或不可验证时写 task run log、`last_result`，并延后 `next_run`。
- 补充单测和 scheduler integration test，覆盖 5h 低、7d 低、usage unavailable、usage bucket 缺失和 agent task defer。

### Milestone 2：Scheduled Workflow Task

Status: `done`

Validation status: `passed`

Review status: `passed`

Result:

- `scheduled_tasks.execution_type` 支持 `workflow`。
- `script_command` 存 workflow id，`prompt` 存 workflow prompt；scheduler 复用 `/workflow <id> <prompt>` 同一条执行路径。
- workflow task 写 task run log / next_run / last_result，并保留 billing gate 与 usage guard。
- schema 和类型已同步，补充 workflow scheduled task 单测。

### Milestone 3：Stock Strategy Loop Workflow

Status: `done`

Validation status: `passed`

Review status: `passed`

Result:

- 新增 `.agents/workflows/stock-strategy-loop.json`。
- 新增 readonly role cards：
  - `stock-strategy-task-reviewer`
  - `stock-strategy-value-analyst`
  - `stock-strategy-iteration-planner`
- 新增 workflow local tasks：
  - `stock.strategy.collect_results`
  - `stock.strategy.analyze_value`
- local task 只输出 summary-only artifact；底层 stock-analysis-api CLI 失败时返回 degraded 子结果，不让整条 workflow 编造收益。

### Milestone 4：Install New Loop And Retire Old Entrypoints

Status: `done`

Validation status: `passed`

Review status: `passed`

Result:

- SQLite 已确认旧任务 paused、新 `stock-strategy-loop-review` active。
- `launchctl print-disabled gui/$(id -u)` 已确认 `com.ryan.stock-analysis-task-chain` disabled。
- Owner docs 已同步：
  - `docs/ARCHITECTURE.md`
  - `docs/RUNTIME.md`
  - `docs/COMMAND.md`
  - `docs/MODULE.md`
- `PLANS/ROADMAP.md` 已增加 monitoring 项，追踪第一轮真实运行与后续节奏优化。
- 已通过安全重启：`bun src/cli.ts restart` -> `restart-2026-05-20T16-09-57-934Z-eaf64796`，状态 `passed`；`/api/health` 返回 `healthy`。

## Validation

已运行并通过：

- `npm test -- tests/unit/agent/scheduler/usage-guard.test.ts tests/unit/agent/scheduler/workflow-task.test.ts tests/integration/scheduler/workspace-cwd.test.ts`
- `npm test -- tests/unit/agent/scheduler/usage-guard.test.ts tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/core/schemas.test.ts tests/unit/core/runtime/usage.test.ts tests/integration/scheduler/workspace-cwd.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts`
- `npm run typecheck`
- `./scripts/validate.sh`：75 test files passed、517 tests passed、1 skipped；typecheck、backend build、web build、agent-runner build 均通过。
- `./scripts/review.sh`：diff hygiene 与 Prettier format check 通过。
- 语义 review：补齐 scheduled workflow billing gate；usage snapshot 缺少 5h/7d 任一 bucket 时保守 defer。
- `git diff --check`
- SQLite scheduled task 查询
- `launchctl print-disabled gui/$(id -u)`
- `curl -fsS http://127.0.0.1:3000/api/health`

## Handoff

Current milestone: none

Current status: implemented, validated, reviewed, restarted; awaiting commit.

Next monitoring action:

- 观察 `stock-strategy-loop-review` 第一轮真实运行。若 usage guard defer，记录 defer reason 与 next_run；若 workflow 完成，检查 `task_review`、`strategy_value_review` 和 `next_iteration_plan` 是否 summary-only、不过拟合、且没有交易 / approve / activate 越界。
- 若 6 小时节奏噪声仍偏高，将 workflow task 拆成 HK close / US close 两个更自然的市场节奏。
- 后续可增加 golden dataset / semantic eval，评价 planner 是否持续提出可验证、只读、不过拟合的下一轮迭代任务。
