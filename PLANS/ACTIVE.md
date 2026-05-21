# 当前任务：股票策略 workflow 飞书输出瘦身

> **给 agentic workers：** 本轮计划统一维护在 `PLANS/ACTIVE.md`；不得在 `docs/superpowers/`、`docs/**/plans/` 或 `docs/**/specs/` 新增计划。一次只推进一个 milestone；validation 和 review 均通过后才可提交。

## 背景

`stock-strategy-discovery-loop` 首轮真实运行成功，但飞书终态消息把 planner 的长 JSON / 长段落几乎原样投递出来。结果信息量过大、抽象层级太高，用户难以快速捕捉阶段、进展、策略效果和下一步。

## 目标

- 只优化股票策略 workflow 的飞书终态正文，不改变 workflow state、run log、step artifact 或策略执行逻辑。
- 对 `stock-strategy-discovery-loop` 和 `stock-strategy-loop` 成功结果增加投递摘要层。
- 飞书正文固定输出四块：
  - `🎯 阶段目标`
  - `📍 当前进展`
  - `📈 策略效果`
  - `🧭 后续规划`
- 使用 emoji 和短行突出重点；避免原样输出长 JSON。
- 保留安全边界提示：只读、不可自动 approve / activate / trade。

## 方案

在 `src/agent/workflow/command.ts` 的 `normalizeWorkflowResultForDelivery()` 下游新增 stock strategy 专用 formatter：

- 尝试解析角色输出中的 JSON；支持纯 JSON 和 markdown code fence 中的 JSON。
- 从 `next_iteration_objective`、`candidate_tasks`、`validation_plan`、`stop_conditions` 等常见字段提取摘要。
- 从候选证据中提取少量关键指标，例如 `rank_ic_mean`、`rank_ic_tstat`、`cost_adjusted_quantile_spread`、`turnover`、`observations`；没有指标时明确写“暂无可判定收益/仍处补证阶段”。
- 解析失败时使用文本 fallback：保留前几条有效短行，不把大块原始文本直接投递。

## Milestones

### Milestone 1：Stock Strategy Delivery Formatter

Objective:

- 为股票策略 workflow 成功消息生成飞书友好的结构化摘要。

Allowed scope:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `src/agent/workflow/command.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/integration/scheduler/workspace-cwd.test.ts`（仅修复全量验证暴露的日期敏感断言）

Validation:

- `npm test -- tests/unit/agent/workflow/command.test.ts`
- `npm run typecheck`
- `./scripts/review.sh`
- `git diff --check`
- `./scripts/validate.sh`
- 安全重启并确认 `/api/health`

Status: `done`

Validation status: `passed`

Review status: `passed`

## Handoff

Current milestone: none

Current status: 已完成股票策略 workflow 飞书输出瘦身。`stock-strategy-discovery-loop` / `stock-strategy-loop` 的用户可见成功消息现在固定展示 `🎯 阶段目标`、`📍 当前进展`、`📈 策略效果`、`🧭 后续规划`，并追加只读安全边界；完整原始结果继续保留在 workflow run / step 审计中。

Validation evidence:

- `npm test -- tests/unit/agent/workflow/command.test.ts`：通过，覆盖股票策略结果摘要化且不泄露原始 JSON key。
- `npm test -- tests/integration/scheduler/workspace-cwd.test.ts`：通过，修复 usage guard 日期敏感断言。
- `npm run typecheck`：通过。
- `./scripts/validate.sh`：通过，75 个 test file 通过、1 个 skipped；520 个 test 通过、1 个 skipped；`make typecheck`、backend/web/agent-runner build 均通过。
- `./scripts/review.sh`：通过自动 review helper；语义 review 未发现 blocking finding。
- `git diff --check`：通过。

Review notes:

- Scope stayed within command delivery formatter, docs, plan, and validation-stabilizing test.
- HKIPO delivery normalization remains unchanged.
- Stock strategy formatter only changes user-visible delivery text; workflow state and audit artifacts are not rewritten.
- Formatter has JSON parsing and fallback paths; malformed result will still show short structured sections rather than large raw JSON.
- Safety line remains explicit: readonly, no automatic approve / activate / trade.

Open question:

- 无阻塞。提交后按仓库约定安全重启，让下一轮 scheduled workflow 使用新的投递 formatter。
