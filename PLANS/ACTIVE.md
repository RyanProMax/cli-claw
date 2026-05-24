# 当前任务：股票策略状态驱动自迭代系统

## Goal

- 将 `stock-strategy-discovery-loop` 从固定 30 分钟完整 discovery 升级为状态驱动的股票策略投研自迭代系统：每轮先判断新数据、新证据和设计变化，再决定继续、降频、暂停、切下游验证或请求人工。
- 创建独立“股票策略”工作区承载 stock strategy discovery / validation / review；现有股票策略 scheduled workflow 从主工作区迁出，每次 workflow run 作为该工作区下的 workflow 线程，不再为每次 run 新建工作区。
- 基于外部自迭代 / MLOps / 量化策略生命周期最佳实践，补齐“策略挖掘 -> 回测验证 -> 模拟盘观察 -> 人工审批”的推进节奏：轻量 orchestrator 保持短周期路由，重任务按证据成熟度调度，禁止连续几天只重复挖掘没有候选、回测或模拟盘结论。
- 每天必须输出股票策略当日进度总结，覆盖发现、回测、模拟盘 / paper ledger、阻塞项、下一步和是否需要人工，而不是只在需要人工审批时才有可见结论。

## Research Synthesis

- AWS agentic evaluator / reflect-refine pattern 强调生成与评估解耦、结构化反馈、迭代或收敛阈值；用于自改进 agent 时，循环应由评价结果驱动，而不是单次生成后盲目继续。
- AWS MLOps continuous training checklist 把重训触发分成 schedule、新数据、性能退化和数据分布漂移；对应本系统应优先用 data_version / evidence_signature / performance drift 触发验证或复盘，固定 schedule 只负责兜底巡检。
- LangChain agent improvement loop 的实践重点是生产或类生产环境收集数据、用人工判断校准自动 evaluator；对应本系统应让人类审批边界聚焦在候选通过自动可用标准之后，而不是让人审重复 discovery 噪音。
- QuantConnect backtesting / paper trading 文档把 backtest 定义为历史模拟，paper trading 定义为实时数据 + 虚拟资金，用于检验回测是否过拟合；reconciliation 文档强调 live 与 backtest 会因数据时点、look-ahead bias、费用、滑点、订单成交、状态恢复等产生偏差。对应本系统必须把回测、OOS、成本敏感性和模拟盘观察作为不同阶段，不允许用 discovery 结果替代后续验证。

## Done when

- DB / 启动迁移能 idempotently 创建“股票策略”工作区，并把 `stock-strategy-discovery-loop`、`stock-strategy-loop-review` 等股票策略 scheduled task 迁移到该工作区。
- 30 分钟 discovery 不再无条件完整跑 Agent；scheduler 能读取固定 JSON 决策，执行 `pause`、`slow_down`、`switch_workflow`、`ask_human` 等动作。
- 股票策略 workflow 具备 per-market 状态：`coverage_check -> discovery -> candidate_review -> candidate_validation -> human_review_ready -> approved/rejected/cooldown`，并维护 evidence signature。
- US/HK/CN 拆出可调度工作流：US 候选验证、HK 设计复盘、CN 覆盖检查；当前节奏为 discovery/orchestrator 30m 轻量巡检、US 2h 验证、HK 手动或 6h 设计复盘、CN 覆盖坏时 1h 覆盖检查、长期无源才 6h。
- planner 输出固定 JSON schema，至少包含 `action`、`next_workflow`、`cadence`、`reason`、`evidence_signature`、`requires_human`；原始 JSON 保留在 workflow 审计中。
- planner / scheduler 共同维护 `strategy_usability` 标准：只有策略证据达到可用标准时才允许真正暂停；未通过或未知时只能继续验证、设计复盘、覆盖检查、降频或 cooldown。
- `cadence` 不能再同时控制当前 orchestrator 和下游重任务；scheduler 必须支持当前任务 cadence 与 next workflow cadence 解耦。默认 discovery/orchestrator 短周期保持 30 分钟，US active candidate validation 为 30 分钟到 2 小时，HK 设计复盘为事件触发或 2-6 小时，CN 覆盖坏时 1 小时巡检、确认长期无源后才 6 小时。
- 重复 evidence signature 只能短路完整 Agent / discovery review，不能把 orchestrator 自身降到长周期；短路后仍应按短周期检查新数据、候选状态、覆盖恢复和人工反馈。
- 每日进度总结 workflow 自动调度，默认每天输出一次股票策略进度，包含当日完成、候选推进阶段、回测/OOS、模拟盘或 paper ledger、阻塞原因、下一步节奏与人审需求。
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

### Milestone 7：最佳实践节奏重构与每日进度总结

Objective:
- 按调研结论修正股票策略闭环：将轻量 orchestrator 与下游验证 cadence 解耦，恢复 discovery/orchestrator 30 分钟短周期巡检；新增每日进度总结 workflow，保证策略挖掘、回测、模拟盘验证和阻塞项每天有可见进展输出。

Allowed scope:
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/agent/scheduler/index.ts`
- `src/agent/workflow/command.ts`
- `src/storage/db.ts`
- `src/web/workflow-dashboard.ts`
- `.agents/agent-roles/stock-strategy-iteration-planner.md`
- `.agents/agent-roles/stock-strategy-progress-reporter.md`
- `.agents/workflows/stock-strategy-*.json`
- `tests/unit/agent/scheduler/stock-strategy-decision.test.ts`
- `tests/unit/agent/scheduler/workflow-task.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/storage/stock-strategy-workspace.test.ts`
- `tests/unit/web/workflow-dashboard.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Validation:
- `npm test -- tests/unit/agent/scheduler/stock-strategy-decision.test.ts tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/storage/stock-strategy-workspace.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/web/workflow-dashboard.test.ts`
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
- 当前真实设计缺口：`cadence` 同时控制 discovery-loop 和下游 workflow，导致 planner 输出 2h / 6h 验证节奏时，轻量 orchestrator 也被拖慢；`STOCK_STRATEGY_DEFAULT_COOLDOWN_MS=6h` 还会把 legacy non-usable discovery 恢复成 6 小时 active。
- 本 milestone 必须保留已有 pause gate：策略未达 `stock_strategy_usability_v1` 不能真暂停；但未达标时 discovery/orchestrator 仍要短周期巡检，完整 Agent 才通过 evidence signature 短路。
- 每日总结只报告进度和证据，不审批、不激活、不交易；飞书/微信外部推送允许用于每日总结和人工审批，重复 discovery 仍不外推。
- 已将 planner decision 扩展为 `current_cadence` / `next_cadence`：当前 discovery/orchestrator 默认保持 30m；下游 workflow 独立按 US 2h、HK 6h、CN 1h、daily 24h 调度。重复 evidence signature 只短路完整 Agent review，不再把轻量巡检拖成长周期。
- 已新增 `stock-strategy-daily-progress-summary` 与 `stock-strategy-progress-reporter`，启动迁移会 seed 每日进度总结；Web 股票策略 workflow 集合同步纳入该工作流。
- 已补迁移保护：旧 schema cadence-only 的 US/CN 下游任务会在启动时分别收敛为 US 2h 验证、CN 1h 覆盖修复；已经写入 `current_cadence` / `next_cadence` 的新 planner 结果不被启动迁移覆盖。
- 已通过 targeted scheduler/storage/workflow/web tests（42 tests）、`npm run typecheck:backend`、`./scripts/validate.sh`（527 passed / 1 skipped）与 `./scripts/review.sh`。`review.sh` 第一次因 Prettier 失败，格式化相关 TS 文件后已通过；最终 semantic review 未发现 scope、权限或调度语义回归。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 删除或迁移调度行为时必须沿引用链清理入口、配置、测试、文档和调用方。
- milestone 只有 validation 与 review 都通过后才可标记 `done`。

## Handoff

Current milestone:
- Milestone 7

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/agent/scheduler/index.ts`
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/web/workflow-dashboard.ts`
- `src/agent/workflow/command.ts`
- `src/storage/db.ts`
- `.agents/agent-roles/stock-strategy-iteration-planner.md`
- `.agents/agent-roles/stock-strategy-progress-reporter.md`
- `.agents/workflows/stock-strategy-discovery-loop.json`
- `.agents/workflows/stock-strategy-loop.json`
- `.agents/workflows/stock-strategy-us-candidate-validation.json`
- `.agents/workflows/stock-strategy-hk-design-review.json`
- `.agents/workflows/stock-strategy-cn-coverage-check.json`
- `.agents/workflows/stock-strategy-daily-progress-summary.json`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `tests/unit/agent/scheduler/workflow-task.test.ts`
- `tests/unit/agent/scheduler/stock-strategy-decision.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/web/workflow-dashboard.test.ts`
- `tests/unit/storage/stock-strategy-workspace.test.ts`

Last failure summary:
- Milestone 7 初次 targeted tests 按 TDD 失败在 cadence 解耦、每日总结 workflow seed、command 层保留新字段和 workflow/role 配置缺失；实现后语义审查又发现旧默认 CN 覆盖任务可能保留 6h，已补 migration 与 storage test。最终 targeted tests、backend typecheck、全量 validate 与 review gate 均通过。

Suspected cause:
- 已确认并修复：原设计把 `cadence` 同时用于当前 orchestrator 与下游重任务，导致“US 2h 验证 / HK 6h 复盘”错误地拉长了新证据巡检周期；现在由 `current_cadence` 和 `next_cadence` 拆开。

Next step:
- 安全重启服务并检查真实 DB 中 `stock-strategy-discovery-loop` 仍为 30m、US/HK/CN/daily 下游任务已 seed 到股票策略工作区；下一轮可继续把市场状态持久化为显式 registry，并补 paper trading promotion gate。
