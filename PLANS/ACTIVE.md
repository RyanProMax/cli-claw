# 当前任务：股票策略状态驱动自迭代系统

## Goal

- 将 `stock-strategy-discovery-loop` 从固定 30 分钟完整 discovery 升级为状态驱动的股票策略投研自迭代系统：每轮先判断新数据、新证据和设计变化，再决定继续、降频、暂停、切下游验证或请求人工。
- 创建独立“股票策略”工作区承载 stock strategy discovery / validation / review；现有股票策略 scheduled workflow 从主工作区迁出，每次 workflow run 作为该工作区下的 workflow 线程，不再为每次 run 新建工作区。

## Done when

- DB / 启动迁移能 idempotently 创建“股票策略”工作区，并把 `stock-strategy-discovery-loop`、`stock-strategy-loop-review` 等股票策略 scheduled task 迁移到该工作区。
- 30 分钟 discovery 不再无条件完整跑 Agent；scheduler 能读取固定 JSON 决策，执行 `pause`、`slow_down`、`switch_workflow`、`ask_human` 等动作。
- 股票策略 workflow 具备 per-market 状态：`coverage_check -> discovery -> candidate_review -> candidate_validation -> human_review_ready -> approved/rejected/cooldown`，并维护 evidence signature。
- US/HK/CN 拆出可调度工作流：US 候选验证、HK 设计复盘、CN 覆盖检查；当前节奏为 US 2h 验证、HK 手动或 6h 设计复盘、CN 6h 覆盖检查，全局 30m discovery 改为轻量 orchestrator 或暂停。
- planner 输出固定 JSON schema，至少包含 `action`、`next_workflow`、`cadence`、`reason`、`evidence_signature`、`requires_human`；原始 JSON 保留在 workflow 审计中。
- planner / scheduler 共同维护 `strategy_usability` 标准：只有策略证据达到可用标准时才允许真正暂停；未通过或未知时只能继续验证、设计复盘、覆盖检查、降频或 cooldown。
- Web 自动化看板能展示每个市场状态，飞书/微信只推真正需要人的结论，重复无新增不刷完整发现摘要。
- `docs/ARCHITECTURE.md`、`docs/RUNTIME.md`、`docs/COMMAND.md`、`docs/MODULE.md` 同步新的工作区、状态机、调度决策和 workflow 边界。

## Milestones

### Milestone 1：工作区迁移与调度决策基础

Objective:
- 建立股票策略工作区迁移入口、planner decision schema parser、scheduler 决策执行基础；先停止当前 30m discovery 空转，并为后续 US/HK/CN workflow 分流提供可测试接口。

Allowed scope:
- `src/domain/types.ts`
- `src/storage/db.ts`
- `src/storage/scheduler.ts`
- `src/storage/workspaces.ts`
- `src/agent/scheduler/*`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
- `src/agent/workflow/local-tasks.ts`
- `tests/unit/agent/scheduler/*`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/storage/*`
- `PLANS/ACTIVE.md`

Validation:
- `npm test -- tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/agent/scheduler/stock-strategy-decision.test.ts tests/unit/storage/stock-strategy-workspace.test.ts tests/unit/agent/workflow/command.test.ts`
- `npm run typecheck:backend`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 当前真实 DB 证据：`stock-strategy-discovery-loop` 和 `stock-strategy-loop-review` 都在 `main`，目标 chat 为飞书私聊；2026-05-24 多轮 discovery 反复输出同一 US/HK/CN 判断。允许本 milestone 对真实 DB 做一次性暂停/迁移，后续再用代码迁移保证重启后幂等。
- scope 补充 `tests/unit/agent/workflow/command.test.ts`：scheduler 当前只能拿到 `executeWorkflowCommand` 的返回文本，因此 command 层需要保留精简 `[Scheduler Decision]` JSON 给 scheduler 读取，同时不回投完整 planner JSON。
- 已通过 `npm test -- tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/agent/scheduler/stock-strategy-decision.test.ts tests/unit/storage/stock-strategy-workspace.test.ts tests/unit/agent/workflow/command.test.ts` 与 `npm run typecheck:backend`。Review gate 已检查 scope、diff、测试和无临时调试残留。

### Milestone 2：US/HK/CN 工作流与本地证据任务

Objective:
- 拆出 `stock-strategy-us-candidate-validation`、`stock-strategy-hk-design-review`、`stock-strategy-cn-coverage-check`，补本地只读任务产出候选验证、设计复盘、覆盖检查结构化 artifact。

Allowed scope:
- `.agents/workflows/*.json`
- `.agents/agent-roles/*.md`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/tools.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`

Validation:
- `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts`
- `npm run typecheck:backend`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- US 验证必须覆盖 OOS 分段、`alpha_topn_momentum_5d.20260524` vs `alpha_topn_momentum_20d.20260520` champion/challenger、行业/主题集中度、`average_amount_5d` / `turnover_rate`、回撤、换手、成本敏感性和更可解释 universe；缺少底层 CLI 时返回 degraded artifact，不伪造结论。
- 已新增 `stock-strategy-us-candidate-validation`、`stock-strategy-hk-design-review`、`stock-strategy-cn-coverage-check` 三个只读 workflow；local task artifact 都包含 `market_state` 与 `evidence_signature`。已通过 `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts` 与 `npm run typecheck:backend`；review gate 已检查只读边界、degraded 行为和固定 JSON schema。

### Milestone 3：Web 看板、通知降噪与文档同步

Objective:
- Web 自动化看板展示股票策略每市场状态；飞书/微信投递只在 `requires_human` 或状态推进时发人类可读结论；同步 owner 文档。

Allowed scope:
- `src/agent/scheduler/index.ts`
- `src/web/workflow-dashboard.ts`
- `src/web/routes/workflows.ts`
- `web/src/stores/workflows.ts`
- `web/src/pages/WorkflowsPage.tsx`
- `web/src/components/**`
- `tests/unit/web/*`
- `tests/unit/agent/scheduler/workflow-task.test.ts`
- `tests/integration/routes/workflows-dashboard.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `PLANS/ROADMAP.md`

Validation:
- `npm test -- tests/unit/web/workflow-dashboard.test.ts tests/integration/routes/workflows-dashboard.test.ts`
- `npm --prefix web run build`
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Web 自动化看板已新增股票策略状态区，展示全局 decision、US/HK/CN 市场状态、evidence signature、下一步 workflow、cadence、原因和是否需要人工；scheduler 对非人工股票策略决策只回投工作区，不再刷飞书/微信重复发现。
- 已通过 `npm test -- tests/unit/web/workflow-dashboard.test.ts tests/integration/routes/workflows-dashboard.test.ts`、`npm --prefix web run build`、`npm test -- tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/agent/scheduler/stock-strategy-decision.test.ts tests/unit/storage/stock-strategy-workspace.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/unit/web/workflow-dashboard.test.ts tests/integration/routes/workflows-dashboard.test.ts`、`npm run typecheck:backend`、`./scripts/validate.sh` 与 `./scripts/review.sh`。浏览器 DOM 冒烟确认 `/automations?tab=workflows` 可见 `股票策略状态`、US 待人工、HK 阻塞、CN 与下游 workflow；截图 API 超时但 DOM 校验通过。

### Milestone 4：evidence signature 防空转前置短路

Objective:
- scheduler 在启动完整 discovery workflow 前读取最近 planner 决策；若连续两轮 `evidence_signature` 相同且不需要人工，则不再调用 Agent / 不再跑完整 discovery，只记录“无新增证据”并把 discovery 置入 cooldown / 下游验证。

Allowed scope:
- `src/agent/scheduler/index.ts`
- `src/web/workflow-dashboard.ts`
- `tests/unit/agent/scheduler/workflow-task.test.ts`
- `tests/unit/web/workflow-dashboard.test.ts`
- `PLANS/ACTIVE.md`

Validation:
- `npm test -- tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/web/workflow-dashboard.test.ts`
- `npm run typecheck:backend`
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- scheduler 已在完整 workflow 执行前读取最近成功 planner decision；当 `stock-strategy-discovery-loop` 连续两轮 `evidence_signature`、action、下游 workflow 与 cadence 相同且无需人工时，会直接记录 `No new evidence`、不调用 workflow runner / usage guard / Agent，并应用 `pause_discovery` + 下游 cadence。Web dashboard 同步识别真实 workflow run metadata 中的 `initialInput.scheduledTaskId`，避免 scheduled run 关联丢失。
- 已通过 `npm test -- tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/web/workflow-dashboard.test.ts`、`npm run typecheck:backend`、`./scripts/validate.sh` 与 `./scripts/review.sh`；第一次 `review.sh` 因 Prettier 格式失败，已格式化 `src/agent/scheduler/index.ts` 后重跑通过。

### Milestone 5：US/HK/CN 下游 scheduled task seed

Objective:
- 启动迁移不只迁移旧股票策略任务，还要在缺失时创建 US 候选验证、HK 设计复盘、CN 覆盖检查三个 scheduled workflow task，确保真实运行节奏符合 US 2h、HK 6h、CN 6h 的状态机拆分。

Allowed scope:
- `src/storage/db.ts`
- `tests/unit/storage/stock-strategy-workspace.test.ts`
- `PLANS/ACTIVE.md`

Validation:
- `npm test -- tests/unit/storage/stock-strategy-workspace.test.ts`
- `npm run typecheck:backend`
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 启动迁移现在会在缺失时 seed `stock-strategy-us-candidate-validation`（2h）、`stock-strategy-hk-design-review`（6h）、`stock-strategy-cn-coverage-check`（6h），并把它们归属到 `web:stock-strategy` / `stock-strategy`；若已有任务则不覆盖用户配置，只补齐 workspace 归属和空 notify channel。
- 已通过 `npm test -- tests/unit/storage/stock-strategy-workspace.test.ts`、`npm run typecheck:backend`、`./scripts/validate.sh` 与 `./scripts/review.sh`。

### Milestone 6：策略可用标准与 pause gate

Objective:
- 回顾当前股票策略闭环的可优化点，定义 `stock_strategy_usability_v1` 策略可用标准，并让 scheduler 对 `pause` / `pause_discovery` 做标准门控：只有 `strategy_usability.status=passed` 时才真正暂停；未通过或未知时保持任务 active，通过降频、cooldown 或下游 workflow 继续迭代。

Allowed scope:
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/agent/scheduler/index.ts`
- `src/agent/workflow/local-tasks.ts`
- `src/storage/db.ts`
- `.agents/agent-roles/stock-strategy-iteration-planner.md`
- `.agents/workflows/stock-strategy-*.json`
- `tests/unit/agent/scheduler/stock-strategy-decision.test.ts`
- `tests/unit/agent/scheduler/workflow-task.test.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`
- `tests/unit/storage/stock-strategy-workspace.test.ts`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `docs/ARCHITECTURE.md`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Validation:
- `npm test -- tests/unit/agent/scheduler/stock-strategy-decision.test.ts tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/unit/storage/stock-strategy-workspace.test.ts`
- `npm run typecheck:backend`
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 当前可优化点：`pause` 语义过宽，重复证据、blocked、候选待人审和真正策略可用都可能映射为暂停；scheduler 只信 planner action，没有结构化核验策略是否满足可用门槛。
- `pause_discovery` 应避免 30 分钟 discovery 空跑，但不能等同于“策略已经可用”。若策略未达标，应保留 active 调度并降频，或转入 US 验证 / HK 设计复盘 / CN 覆盖检查。
- 已落地 `stock_strategy_usability_v1`：artifact 完整性、OOS 分段、champion/challenger 同口径对比、流动性与执行字段、回撤/换手/成本敏感性、可解释 universe、人工审批边界。planner 必须输出 `strategy_usability`，scheduler 只有在 `status=passed` 时才真正 pause；缺失/failed/unknown 会转成 active cooldown / slow_down。
- 启动迁移会把旧的非可用 discovery 暂停态（包括 `Paused by Codex: stock strategy discovery is being migrated...`）恢复为 6 小时低频 active，以便当前真实系统也被新规则接管。
- 已通过 milestone targeted tests、`npm run typecheck:backend`、`./scripts/validate.sh` 与 `./scripts/review.sh`；semantic review 按 scope、目标、文档、测试覆盖和回归风险检查通过。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 删除或迁移调度行为时必须沿引用链清理入口、配置、测试、文档和调用方。
- milestone 只有 validation 与 review 都通过后才可标记 `done`。

## Handoff

Current milestone:
- Milestone 6

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `src/agent/scheduler/index.ts`
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/web/workflow-dashboard.ts`
- `web/src/stores/workflows.ts`
- `web/src/pages/WorkflowsPage.tsx`
- `src/agent/workflow/command.ts`
- `src/storage/db.ts`
- `.agents/agent-roles/stock-strategy-iteration-planner.md`
- `.agents/workflows/stock-strategy-discovery-loop.json`
- `.agents/workflows/stock-strategy-loop.json`
- `.agents/workflows/stock-strategy-us-candidate-validation.json`
- `.agents/workflows/stock-strategy-hk-design-review.json`
- `.agents/workflows/stock-strategy-cn-coverage-check.json`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/tools.ts`
- `tests/unit/agent/scheduler/workflow-task.test.ts`
- `tests/unit/agent/scheduler/stock-strategy-decision.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`
- `tests/unit/web/workflow-dashboard.test.ts`
- `tests/integration/routes/workflows-dashboard.test.ts`
- `tests/unit/storage/stock-strategy-workspace.test.ts`

Last failure summary:
- Milestone 6 初次全量验证发现 `tests/unit/agent/workflow/config.test.ts` 仍期待旧 prompt “暂停同配置 30 分钟 discovery 原样重跑”；已改为断言 `strategy_usability` 与“未达可用标准时应降频”。真实 DB 检查还发现旧暂停原因 `Paused by Codex: stock strategy discovery is being migrated...`，已补迁移识别和 storage 回归测试。

Suspected cause:
- 已确认并修复：暂停动作缺少策略可用标准门控，旧迁移也会把非可用 discovery 停在 paused 状态。

Next step:
- 提交后按安全重启路径应用变更，并确认真实 `stock-strategy-discovery-loop` 从旧 paused 恢复为 6 小时低频 active；后续观察 planner 是否稳定填充 `strategy_usability`，以及只有 `status=passed` 的策略才进入真正暂停/人工评审。
