# 当前任务：股票策略状态驱动自迭代系统

## Goal

- 将股票策略自动化从固定 30 分钟 discovery 升级为 `stock-strategy-control-loop` 主控心跳 + 动态 worker 的投研自迭代系统：每轮先判断新数据、新证据、质量门、设计变化和人工反馈，再决定继续、降频、暂停、切下游验证或请求人工。
- 创建独立“股票策略”工作区承载 stock strategy discovery / validation / review；现有股票策略 scheduled workflow 从主工作区迁出，每次 workflow run 作为该工作区下的 workflow 线程，不再为每次 run 新建工作区。
- 基于外部自迭代 / MLOps / 量化策略生命周期最佳实践，补齐“策略挖掘 -> 回测验证 -> 模拟盘观察 -> 人工审批”的推进节奏：固定心跳只做主控路由，重任务按证据成熟度动态调度，禁止连续几天只重复挖掘没有候选、回测或模拟盘结论。
- 每天必须输出股票策略当日进度总结，覆盖发现、回测、模拟盘 / paper ledger、阻塞项、下一步和是否需要人工，而不是只在需要人工审批时才有可见结论。

## Research Synthesis

- AWS agentic evaluator / reflect-refine pattern 强调生成与评估解耦、结构化反馈、迭代或收敛阈值；用于自改进 agent 时，循环应由评价结果驱动，而不是单次生成后盲目继续。
- AWS MLOps continuous training checklist 把重训触发分成 schedule、新数据、性能退化和数据分布漂移；对应本系统应优先用 data_version / evidence_signature / performance drift 触发验证或复盘，固定 schedule 只负责兜底巡检。
- LangChain agent improvement loop 的实践重点是生产或类生产环境收集数据、用人工判断校准自动 evaluator；对应本系统应让人类审批边界聚焦在候选通过自动可用标准之后，而不是让人审重复 discovery 噪音。
- QuantConnect backtesting / paper trading 文档把 backtest 定义为历史模拟，paper trading 定义为实时数据 + 虚拟资金，用于检验回测是否过拟合；reconciliation 文档强调 live 与 backtest 会因数据时点、look-ahead bias、费用、滑点、订单成交、状态恢复等产生偏差。对应本系统必须把回测、OOS、成本敏感性和模拟盘观察作为不同阶段，不允许用 discovery 结果替代后续验证。
- LangChain / LangGraph multi-agent 文档把 subagents 定义为由 central main agent / supervisor 统一路由，子 Agent 负责窄领域执行并返回结构化结果；多 Agent 只在工具过多、上下文过长、需要并行或顺序约束时有价值。对应本系统不应简单堆“研究/回测/质量”三个聊天角色，而应设置主控 Agent 管状态和节奏，阶段 Agent 管具体产物，质量 Agent 独立验收。
- LangGraph workflow patterns 区分 predetermined workflow 与 autonomous agent，并给出 orchestrator-worker、evaluator-optimizer 两类适合本系统的模式：主控可动态分配多个 worker，质量验收不通过时必须反馈重做或降级，而不是让 scheduler 继续固定频率重跑。
- Google Cloud MLOps level 1 / CT 文档强调 data validation 可直接决定 retrain 或 stop，model validation 决定能否 promotion，trigger 可来自 schedule、新训练数据、性能退化。对应本系统固定 30m 只能是 control heartbeat；重任务的 next_run 必须由新数据、证据变化、质量门缺口和候选成熟度决定。
- QuantConnect paper trading 与 reconciliation 文档强调 paper 是 live real-time data + 虚拟资金，且要对比 live / OOS backtest equity、order fills、费用、滑点和状态差异。对应“尽快实盘验证”应先落成 paper validation / live-readiness gate：通过回测和人审后尽快进入模拟盘观察，但禁止 Agent 自动 approve、activate 或真实下单。

## Done when

- DB / 启动迁移能 idempotently 创建“股票策略”工作区，并把 `stock-strategy-discovery-loop`、`stock-strategy-loop-review` 等股票策略 scheduled task 迁移到该工作区。
- 30 分钟 discovery 不再无条件完整跑 Agent；scheduler 能读取固定 JSON 决策，执行 `pause`、`slow_down`、`switch_workflow`、`ask_human` 等动作。
- 股票策略 workflow 具备 per-market 状态：`coverage_check -> discovery -> candidate_review -> candidate_validation -> human_review_ready -> approved/rejected/cooldown`，并维护 evidence signature。
- US/HK/CN 拆出可调度 worker：US 候选验证、HK 设计复盘、CN 覆盖检查；固定 30m 只保留给主控心跳，worker 由 `next_workflows[]` / `next_run_at` 动态唤醒，并保留 US 2h、HK 6h、CN 1h、paper 1h 作为 fallback cadence。
- planner 输出固定 JSON schema，至少包含 `action`、`next_workflow`、`cadence`、`reason`、`evidence_signature`、`requires_human`；原始 JSON 保留在 workflow 审计中。
- planner / scheduler 共同维护 `strategy_usability` 标准：只有策略证据达到可用标准时才允许真正暂停；未通过或未知时只能继续验证、设计复盘、覆盖检查、降频或 cooldown。
- `cadence` 不能再同时控制主控和下游重任务；scheduler 必须支持 `current_next_run_at` 与 `next_workflows[]` 解耦。默认只有 control loop 保持 30 分钟心跳，US active candidate validation、HK 设计复盘、CN 覆盖检查、paper validation 都由主控按复杂度与证据成熟度动态安排。
- 重复 evidence signature 只能短路完整 Agent / discovery review，不能触发固定 worker 重跑；短路后仍应由主控按短周期检查新数据、候选状态、覆盖恢复和人工反馈。
- 每日进度总结 workflow 自动调度，默认每天输出一次股票策略进度，包含当日完成、候选推进阶段、回测/OOS、模拟盘或 paper ledger、阻塞原因、下一步节奏与人审需求。
- 股票策略主控不再依赖固定 discovery cadence 推进；planner JSON 支持 `current_next_run_at` / `next_run_at`、`next_workflows[]`、`work_budget` 和 `quality_gate`，scheduler 读取后能动态安排当前任务和多个下游任务。
- 至少具备三层职责：主控 Agent 负责全局状态、证据签名、优先级和节奏；阶段执行 Agent 负责 discovery / validation / design / coverage / paper validation 的只读产物；质量 Agent 负责独立验收、缺口列表和 promotion gate。
- 回测通过后的候选必须能进入 `stock-strategy-paper-validation`，该阶段只读读取 paper/live ledger 与 reconciliation evidence，输出是否可进入人工实盘审批，不允许自动真实交易。
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
- 按当时调研结论先修正股票策略闭环：将轻量巡检与下游验证 cadence 解耦，新增每日进度总结 workflow，保证策略挖掘、回测、模拟盘验证和阻塞项每天有可见进展输出。后续 Milestone 8 已进一步收敛为 `stock-strategy-control-loop` 主控心跳，discovery 改为按需 worker。

Allowed scope:
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/agent/scheduler/index.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
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
- 本 milestone 必须保留已有 pause gate：策略未达 `stock_strategy_usability_v1` 不能真暂停；但未达标时主控巡检仍要保持短周期，完整 Agent 才通过 evidence signature 短路。
- 每日总结只报告进度和证据，不审批、不激活、不交易；飞书/微信外部推送允许用于每日总结和人工审批，重复 discovery 仍不外推。
- 已将 planner decision 扩展为 `current_cadence` / `next_cadence`，先把轻量巡检和下游重任务拆开；Milestone 8 已升级为 `current_next_run_at` / `next_workflows[]`，由 `stock-strategy-control-loop` 保持主控心跳，discovery / validation / design / coverage / paper validation 都按需派工。重复 evidence signature 只短路完整 Agent review，不再把轻量巡检拖成长周期。
- 已新增 `stock-strategy-daily-progress-summary` 与 `stock-strategy-progress-reporter`，启动迁移会 seed 每日进度总结；Web 股票策略 workflow 集合同步纳入该工作流。
- 已补迁移保护：旧 schema cadence-only 的 US/CN 下游任务会在启动时分别收敛为 US 2h 验证、CN 1h 覆盖修复；已经写入 `current_cadence` / `next_cadence` 的新 planner 结果不被启动迁移覆盖。
- 已通过 targeted scheduler/storage/workflow/web tests（42 tests）、`npm run typecheck:backend`、`./scripts/validate.sh`（527 passed / 1 skipped）与 `./scripts/review.sh`。`review.sh` 第一次因 Prettier 失败，格式化相关 TS 文件后已通过；最终 semantic review 未发现 scope、权限或调度语义回归。

### Milestone 8：主控 Agent、质量门与动态调度控制面

Objective:
- 将股票策略自动化从“固定心跳 + 单 planner 文本决策”升级为可执行的多 Agent 控制面：主控 Agent 统一把控节奏和派工，阶段 Agent 产出窄领域证据，质量 Agent 独立验收并决定是否进入下一阶段；scheduler 根据结构化 JSON 动态设置当前任务 next_run、多个下游 workflow、质量门和模拟盘验证入口。

Allowed scope:
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/agent/scheduler/index.ts`
- `src/agent/workflow/command.ts`
- `src/storage/db.ts`
- `src/web/workflow-dashboard.ts`
- `.agents/agent-roles/stock-strategy-chief-orchestrator.md`
- `.agents/agent-roles/stock-strategy-quality-reviewer.md`
- `.agents/agent-roles/stock-strategy-iteration-planner.md`
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
- 当前设计判断：固定 30m 作为“策略推导周期”不合理；它只能是 control heartbeat，用来发现状态变化和接收人工/数据事件。真正的 discovery、回测、设计复盘、覆盖修复、模拟盘验证都必须由主控 Agent 根据证据成熟度、质量门缺口、执行成本和目标时效动态安排。
- 本 milestone 不追求把所有市场研究逻辑重写成复杂多 Agent 聊天；先落地最小可靠控制面：`stock-strategy-control-loop` 作为主控心跳，`stock-strategy-quality-reviewer` 独立输出 `quality_gate`，scheduler 执行 `next_workflows[]` 和 `current_next_run_at`，并新增 `stock-strategy-paper-validation` 作为候选通过后的模拟盘验证入口。
- “尽快实现实盘验证”的安全解释：加速进入 paper/live-readiness 验证与人工审批，不允许 Agent 直接 approve、activate 或下真实订单；质量门必须检查 OOS、champion/challenger、流动性、成本、回撤、换手、样本解释性与 paper/live reconciliation。
- 已新增 `stock-strategy-chief-orchestrator` / `stock-strategy-quality-reviewer`，并把 discovery、US/HK/CN worker、legacy `stock-strategy-loop-review` / `stock-strategy-candidate-validation` 都收敛到主控动态派工；真实 DB 重启迁移后仅 `stock-strategy-control-loop` 与 `stock-strategy-daily-progress-summary` 保持 active，旧固定 worker 均为 paused。
- 已通过 `./scripts/validate.sh`（76 files passed / 1 skipped，531 tests passed / 1 skipped，typecheck 与 build 通过）与 `./scripts/review.sh`（Prettier format check 通过）；semantic review 重点检查固定 discovery 残留、quality gate pause block、legacy task ID 迁移和 docs/runtime 口径，未发现阻塞问题。
- 已按 `docs/COMMAND.md` 使用 repo-local safe restart fallback `bun src/cli.ts restart` 应用变更；`/api/health` 返回 healthy，`current-backend.json` 显示新 PID `66763`，真实 DB 中股票策略工作区为 `web:stock-strategy` / `stock-strategy`。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 删除或迁移调度行为时必须沿引用链清理入口、配置、测试、文档和调用方。
- milestone 只有 validation 与 review 都通过后才可标记 `done`。

## Handoff

Current milestone:
- Milestone 10

Current status:
- done

Changed files:
- `.agents/agent-roles/stock-strategy-chief-orchestrator.md`
- `.agents/agent-roles/stock-strategy-quality-reviewer.md`
- `.agents/agent-roles/stock-strategy-discovery-reviewer.md`
- `.agents/agent-roles/stock-strategy-iteration-planner.md`
- `.agents/workflows/stock-strategy-control-loop.json`
- `.agents/workflows/stock-strategy-paper-validation.json`
- `.agents/workflows/stock-strategy-discovery-loop.json`
- `.agents/workflows/stock-strategy-loop.json`
- `.agents/workflows/stock-strategy-us-candidate-validation.json`
- `.agents/workflows/stock-strategy-hk-design-review.json`
- `.agents/workflows/stock-strategy-cn-coverage-check.json`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/agent/scheduler/index.ts`
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/web/workflow-dashboard.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
- `src/storage/db.ts`
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
- Milestone 10 真实复盘发现 `stock-strategy-paper-setup` 多次派发不存在的 `stock-strategy-design-review`，并且新股票策略 workflow 的外部投递可能带出 `[Scheduler Decision]` / 原始 JSON。已补 alias / allowlist、外部投递剥离、日报 21:00 cron 与精简日报提示。最终 targeted tests、全量 validate、review gate、安全重启与 DB 实态检查均通过。

Suspected cause:
- 已确认并修复：planner 输出的下游 workflow id 没有经过 scheduler 侧校验，外部投递复用了内部 scheduler-readable 结果，日报仍是 24h interval 而不是固定晚 9 点总结。现在未知下游不会建任务，旧 HK 设计复盘 id 会归一，外部只看短摘要，内部审计保留 JSON。

Next step:
- 后续真实策略推进应由 `stock-strategy-control-loop` 派发；日报只在本地 21:00 推送关键进展。若 `paper-setup` 仍缺 watch / paper ledger / simulated trading 基础证据，应继续补这些输入，不再重复 discovery 或刷过程。

### Milestone 9：调度闭环硬化与 E2E 自测

Objective:
- 把 2026-05-25 复盘发现的执行层缺口补成硬机制：Agent 不能输出调度器听不懂的动作而被静默忽略；卡住的 scheduled task / workflow run 必须能自动识别并恢复；模拟盘验证缺口必须拆成真正可派发的准备/补证 workflow；每日总结卡住或无新进展时仍要给出可见诊断；最终用 E2E 自测证明主控能派工、失败能暴露、卡死能恢复、日报能完成。

Allowed scope:
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/agent/scheduler/index.ts`
- `src/storage/db.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
- `.agents/agent-roles/stock-strategy-*.md`
- `.agents/workflows/stock-strategy-*.json`
- `tests/unit/agent/scheduler/stock-strategy-decision.test.ts`
- `tests/unit/agent/scheduler/workflow-task.test.ts`
- `tests/unit/storage/stock-strategy-workspace.test.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/e2e/**`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `docs/E2E.md`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Validation:
- `npm test -- tests/unit/agent/scheduler/stock-strategy-decision.test.ts tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/storage/stock-strategy-workspace.test.ts tests/unit/agent/workflow/config.test.ts`
- `npm test -- tests/e2e/stock-strategy-scheduler.e2e.test.ts`
- `npm run typecheck:backend`
- `./scripts/validate.sh`
- `./scripts/review.sh`
- 安全重启后检查真实 DB：旧 running task log 不再挂住；`stock-strategy-control-loop` 能 active 续跑；paper validation / setup worker 能被合法决策派发；日报没有长期 stale running。

Status:
- done

Validation status:
- Targeted scheduler/storage/workflow config/E2E tests 已通过：`npm test -- tests/unit/agent/scheduler/stock-strategy-decision.test.ts tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/storage/stock-strategy-workspace.test.ts tests/unit/agent/workflow/config.test.ts tests/e2e/stock-strategy-scheduler.e2e.test.ts`（41 passed）。
- `npm run typecheck:backend` 已通过。
- `./scripts/validate.sh` 已通过：77 files passed / 1 skipped，537 tests passed / 1 skipped，并完成 backend、web、agent-runner build。
- `./scripts/review.sh` 已通过格式和 diff hygiene；语义 review 按 `RUNBOOKS/Review.md` 检查 scope、目标、模式、验证、文档和回归风险，结论 passed。
- 安全重启已完成：`restart-2026-05-25T15-56-53-402Z-a731c807` status passed，当前 backend pid `84021`，`/api/health` healthy。
- 真实 DB 检查通过：旧 `stock-strategy-control-loop` 与 `stock-strategy-daily-progress-summary` running task log 已被 watchdog 标成 error；旧 running `stock-strategy-discovery-loop` workflow run 已被标成 watchdog error；当前无股票策略 running task log / workflow run 残留；`stock-strategy-control-loop` 与 `stock-strategy-daily-progress-summary` 均 active，因 OpenAI usage snapshot 临时不可读按 Deferred 续跑到 2026-05-25T16:26:55Z 左右。

Review status:
- passed

Risks / Notes / Handoff:
- 当前真实问题：2026-05-25 看到 `stock-strategy-control-loop` 与 `stock-strategy-daily-progress-summary` 有 stale running task log，但无对应 runner 进程；主控输出了 `dispatch_failed_gate_remediation` 等调度器不认识的 action，导致下游 worker 没被稳定物化。
- 本 milestone 的完成标准不是“测试里能解析 JSON”，而是 E2E 证明：非法动作会变成明确失败/修正请求；合法动作会创建下游任务；过去时间不会让任务立刻反复 due；卡住任务能被 watchdog 标错并恢复 next_run；模拟盘缺口能进入真实 setup/validation 任务；日报在无新进展时也能输出诊断。
- 已实现第一轮硬化：股票策略新调度工作流必须输出白名单 action；非法 action 直接记 task error；past `current_next_run_at` 会回退到未来时间；新增 scheduled workflow timeout 与 stale running watchdog；新增 `stock-strategy-paper-setup`，让 simulated trading / watch / paper ledger 准备与 `stock-strategy-paper-validation` 拆开。
- Handoff：当前不是策略研究本身被证明有效，而是控制面被硬化。下一轮真实推进取决于 OpenAI usage snapshot 恢复后 `stock-strategy-control-loop` 的合法 JSON 输出；若 usage API 继续不可读，scheduler 会继续 Deferred，不会启动重任务或刷外部通知。

### Milestone 10：飞书输出收敛、9 点日报与真实进度复盘

Objective:
- 按 2026-05-26 真实运行复盘修正股票策略闭环的用户可见面：飞书/微信不再推送内部调度 JSON、长过程和原始数据结构；股票策略日报固定每天 21:00 推送关键进展；scheduler 不再创建错误 workflow id 导致空转；同时输出昨天与今天的简明进展结论。

Allowed scope:
- `src/agent/scheduler/index.ts`
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/agent/workflow/command.ts`
- `src/storage/db.ts`
- `.agents/agent-roles/stock-strategy-progress-reporter.md`
- `.agents/workflows/stock-strategy-daily-progress-summary.json`
- `tests/unit/agent/scheduler/workflow-task.test.ts`
- `tests/unit/agent/scheduler/stock-strategy-decision.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/storage/stock-strategy-workspace.test.ts`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Validation:
- `npm test -- tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/agent/scheduler/stock-strategy-decision.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/storage/stock-strategy-workspace.test.ts`
- `npm run typecheck:backend`
- `./scripts/validate.sh`
- `./scripts/review.sh`
- 安全重启后检查真实 DB：`stock-strategy-design-review` 不再 active；`stock-strategy-daily-progress-summary` 为每天 21:00；外部通知不会包含 `[Scheduler Decision]` 或调度 JSON。

Status:
- done

Validation status:
- passed：`npm test -- tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/agent/scheduler/stock-strategy-decision.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/storage/stock-strategy-workspace.test.ts`、`npm run typecheck:backend`、`./scripts/validate.sh` 均通过；`./scripts/validate.sh` 结果为 543 passed / 1 skipped，并完成 backend、web、agent-runner build。

Review status:
- passed：`./scripts/review.sh` 通过格式和 diff hygiene；语义 review 按 scope、目标、模式、验证、文档和回归风险检查，未发现阻塞问题。

Risks / Notes / Handoff:
- 真实复盘发现：`stock-strategy-paper-setup` 曾派发不存在的 `stock-strategy-design-review`，导致 2026-05-25 与 2026-05-26 多次 `workflow not found`。本轮需要把错误 id 纠正到 `stock-strategy-hk-design-review`，并禁止未知 `stock-strategy-*` workflow 被创建成 scheduled task。
- 真实复盘发现：新股票策略 workflow 的结果没有全部走摘要层，飞书可能看到 `[Scheduler Decision]` 与内部 JSON。本轮要保留内部审计和 scheduler 解析能力，但外部 IM 只看短摘要。
- 日报不是高频过程播报；默认每天 21:00 只推“今天做了什么、卡在哪、下一步、是否需要人”。重复 discovery、无新增证据、内部调度字段不外推。
- 已完成并安全重启：`restart-2026-05-26T16-21-39-169Z-4503edef` passed，`/api/health` healthy。真实 DB 当前 `stock-strategy-daily-progress-summary` 为 `cron 0 21 * * *`，next_run=`2026-05-27T01:00:00.000Z`；`stock-strategy-design-review` 已 paused，当前无股票策略 running task log / workflow run 残留。

### Milestone 11：飞书错误刷屏复盘与外部通知降噪

Objective:
- 复盘 2026-05-27 股票策略飞书刷屏根因，并把调度器改成：股票策略 worker 的普通成功、失败、无新增证据和运行时异常只进 Web / 审计；飞书/微信只接收每日 21:00 简报，或真正需要人工处理的短结论，且不输出堆栈、原始 JSON、长过程。

Allowed scope:
- `src/agent/scheduler/index.ts`
- `tests/unit/agent/scheduler/workflow-task.test.ts`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Validation:
- `npm test -- tests/unit/agent/scheduler/workflow-task.test.ts`
- `npm run typecheck:backend`
- `./scripts/validate.sh`
- `./scripts/review.sh`
- 安全重启后检查真实 DB：`stock-strategy-daily-progress-summary` 仍为每天 21:00；非日报、非人工确认的股票策略任务即使失败也不再外推飞书；当前噪声 worker 不再继续刷外部 IM。

Status:
- done

Validation status:
- passed：新增回归先红后绿；`npm test -- tests/unit/agent/scheduler/workflow-task.test.ts` 通过 19 tests；`npm run typecheck:backend` 通过；格式修正后重新跑 `./scripts/validate.sh` 通过，结果为 545 passed / 1 skipped，并完成 backend、web、agent-runner build。

Review status:
- passed：`./scripts/review.sh` 通过 diff hygiene 与格式检查；语义 review 按 scope、目标、模式、验证、文档和回归风险检查，结论 passed。

Risks / Notes / Handoff:
- 今日真实日志显示：2026-05-27 本地日内 `stock-strategy-us-candidate-validation` 4 次失败、`stock-strategy-paper-setup` 4 次失败、`stock-strategy-control-loop` 2 次失败；外部飞书收到的不是策略结论，而是 runtime 中断、缺少 scheduler decision JSON 和重复的非人工阶段总结。
- 当前代码的核心风险是 `decision=null` 时默认外推 `notify_channels`，这对普通 scheduled task 合理，但对股票策略自迭代不合理。股票策略应该默认内部可见、外部静默，只有日报或人工确认才出现在飞书/微信。
- 已修复：股票策略 scheduled task 现在把 Web 主投递与外部 `notify_channels` 分开；worker 普通成功/失败、无新增证据、runtime 堆栈和缺 scheduler decision JSON 不再外推飞书/微信；人工确认和日报才走外部短消息。日报 workflow 如果自身失败，外部收到不含堆栈的短 fallback，原始错误留在 Web 与 task run log。
- 安全重启已完成：PATH 中无安装版 `cli-claw`，按 `docs/COMMAND.md` 使用 repo-local fallback `bun src/cli.ts restart`；restart `restart-2026-05-27T12-20-35-530Z-2b27a773` passed，`/api/health` healthy，当前 backend pid `29819`。真实 DB 检查：`stock-strategy-daily-progress-summary` 仍为 `cron 0 21 * * *`，next_run=`2026-05-28T01:00:00.000Z`；`stock-strategy-paper-setup` 与 `stock-strategy-us-candidate-validation` 已 paused；当前无股票策略 running task log。
