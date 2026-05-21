# 当前任务：股票策略 workflow 飞书卡片精修与重复输出优化

> **给 agentic workers：** 本轮计划统一维护在 `PLANS/ACTIVE.md`；不得在 `docs/superpowers/`、`docs/**/plans/` 或 `docs/**/specs/` 新增计划。一次只推进一个 milestone；validation 和 review 均通过后才可提交。

## 背景

上一轮已为 `stock-strategy-discovery-loop` / `stock-strategy-loop` 增加飞书摘要层，但用户反馈：

- `当前进展` 应改成 `本轮完成`，表达本轮实际产出而不是泛泛进展。
- 卡片要更优雅：每个要点标题加粗，要点上方留出换行，便于飞书里快速扫读。
- 连续几轮结果几乎一样，说明 planner / 摘要层没有足够突出“本轮增量”和“重复判断”。

最近真实运行证据显示，30 分钟 discovery 多轮重复相同输入与相同候选：US 仍是 `alpha_topn_momentum_5d.20260521`，HK 同三因子重复 blocked，CN 仍 `scanned=0`，KOL handoff 仍 `agent_required`。本轮不扩大到调度引擎重构，只先修复用户可见卡片和 planner 输出契约，让后续结果能够优先呈现增量、重复原因和降频/转验证建议。

## 目标

- 将股票策略飞书摘要四块改为：
  - `🎯 阶段目标`
  - `📍 本轮完成`
  - `📈 策略效果`
  - `🧭 后续规划`
- 每个要点标题使用加粗标签，例如 `- **目标：** ...`、`- **结论：** ...`。
- 每个 section 标题与要点之间保留空行，提升飞书卡片可读性。
- formatter 优先读取 `change_summary` / `repeat_decision` 等增量字段；没有字段时仍保持短摘要 fallback。
- planner role / workflow prompt 明确要求输出本轮增量、重复判断、停止重复同配置 discovery 的建议。
- 自测格式输出，确认不再泄露原始 JSON key，且文本结构符合预期。

## 非目标

- 本轮不修改 scheduled task 的触发间隔。
- 本轮不新增条件调度、自动暂停重复 workflow 或跨 run 对比数据库。
- 本轮不改策略研究 CLI、回测逻辑或交易/审批边界。

## Milestones

### Milestone 1：飞书摘要样式与重复判断契约

Objective:

- 让股票策略 workflow 的最终飞书正文更像可扫读的结构化卡片，并让后续几轮优先输出增量和重复结论。

Allowed scope:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `.agents/agent-roles/stock-strategy-iteration-planner.md`
- `.agents/workflows/stock-strategy-discovery-loop.json`
- `.agents/workflows/stock-strategy-loop.json`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `src/agent/workflow/command.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/agent/workflow/config.test.ts`

Validation:

- `npm test -- tests/unit/agent/workflow/command.test.ts`
- 自测输出样式，检查 `📍 本轮完成`、加粗标签、section 空行和无原始 JSON key。
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

Current status: 已完成股票策略 workflow 飞书卡片精修与重复输出优化。终态消息已从 `📍 当前进展` 改为 `📍 本轮完成`，要点使用加粗标签并在 section 标题下留空行；formatter 优先读取 `change_summary` / `repeat_decision`，并去掉重复指标与重复市场前缀。planner role 和两个股票策略 workflow prompt 已收紧为先输出本轮增量和重复判断，连续无新增时明确等待、降频、补证或转候选验证。

Validation evidence:

- `npm test -- tests/unit/agent/workflow/command.test.ts`：通过，覆盖 `📍 本轮完成`、加粗标签、section 空行、不泄露原始 JSON key。
- `npm test -- tests/unit/agent/workflow/config.test.ts`：通过，覆盖内置股票策略 workflow / planner 契约包含 `change_summary` 与 `repeat_decision`。
- 样式自测预览：确认正文展示 `🎯 阶段目标`、`📍 本轮完成`、`📈 策略效果`、`🧭 后续规划`，要点形如 `- **本轮：** ...` / `- **重复判断：** ...`，并且指标不再重复抽取。
- `npm run typecheck`：通过。
- `./scripts/review.sh`：通过自动 review helper；语义 review 通过。
- `git diff --check`：通过。
- `./scripts/validate.sh`：通过，75 个 test file 通过、1 个 skipped；520 个 test 通过、1 个 skipped；`make typecheck`、backend/web/agent-runner build 均通过。

Review notes:

- Scope 已包含 formatter、测试、内置 role/workflow prompt、owner 文档与 plan/roadmap；没有修改 scheduled task 间隔、交易、approve 或 activate 边界。
- 连续几轮输出相似的直接原因是短间隔 discovery 多轮输入与候选未变化，而原 planner 没把“无新增/重复/应转验证或降频”前置；本轮通过 `change_summary` / `repeat_decision` 契约和投递摘要优先级缓解。
- 条件调度、跨 run 去重和自动降频仍需要调度状态支持，已写入 `PLANS/ROADMAP.md` 作为后续项。
- `docs/COMMAND.md` 与 `docs/RUNTIME.md` 已同步新的用户可见摘要口径。

Open question:

- 无阻塞。提交后按仓库约定安全重启，让下一轮 scheduled workflow 使用新的 formatter 与 planner prompt。
