# 当前任务：Web 工作流运行看板

> **给 agentic workers：** 本轮计划统一维护在 `PLANS/ACTIVE.md`；不得在 `docs/superpowers/`、`docs/**/plans/` 或 `docs/**/specs/` 新增计划。一次只推进一个 milestone；validation 和 review 均通过后才可提交。

## 背景

当前 workflow / scheduled workflow 已有运行与 step 审计表，定时任务页也能管理单个 scheduled task，但 Web UI 缺少一个按运行态聚合的工作流看板。用户希望能看到当前正在运行的工作流，特别是定时任务，并体系化展示当天所有运行情况。

Roadmap 中已有 `P2 RM-2026-05-17-01 Workflow Console And Retry Audit`，本轮先落地可观测看板的第一阶段：当天运行概览、当前运行中、定时 workflow 视角、run / step 明细与刷新。

## 目标

- 基于现有 Web UI 设计并落地一个工作流可视化看板。
- 展示当前正在运行的 workflow run，并突出 scheduled workflow / 定时任务。
- 体系化展示当天所有运行情况，包括成功、失败、运行中、排队、耗时、来源任务、下次运行和 step 进度。
- 不改变 workflow 执行语义、调度语义或权限边界；本轮以只读观测为主。

## 非目标

- 本轮不实现失败节点重跑、retry attempt 手工操作或 checkpoint 回滚。
- 本轮不重构 workflow engine / scheduler。
- 本轮不新增长期运行时状态表；优先复用 `workflow_runs`、`workflow_run_steps`、`scheduled_tasks` 和 `task_run_logs`。

## Milestones

### Milestone 1：确认设计与数据边界

Objective:

- 读清现有前端、API、workflow 审计和 scheduled task 数据模型，提出看板设计并取得确认。

Allowed scope:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/MODULE.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `web/src/**`
- `src/web/routes/**`
- `src/storage/db.ts`
- `src/domain/types.ts`
- `src/core/schemas.ts`
- `tests/unit/**`
- `tests/integration/**`

Validation:

- 完成上下文阅读并记录可复用数据源。
- 明确首版看板的信息架构、API contract、前端入口和权限边界。
- 用户以 `/goal` 授权直接设计并落地；首版采用只读观测看板，不扩展到重跑 / checkpoint 操作。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 已确认 Roadmap 中 `Workflow Console And Retry Audit` 与本轮需求重合。
- 现有 `/tasks` 页面偏单任务管理，不满足当天 workflow 运行态聚合。
- `workflow_runs` / `workflow_run_steps` 可提供 run 与 step 审计；`scheduled_tasks` / `task_run_logs` 可提供定时任务配置、运行日志与下次触发时间。
- 看板信息架构确定为：顶部概览、运行中 workflow、定时 workflow task 表、当天 run / step 明细、刷新与日期选择。

### Milestone 2：后端 dashboard API

Objective:

- 增加只读工作流看板 API，按权限返回当天 workflow 运行、运行中 run、scheduled workflow 任务和 step 摘要。

Allowed scope:

- `src/web/routes/**`
- `src/storage/db.ts`
- `src/domain/types.ts`
- `tests/unit/**`
- `tests/integration/**`
- 必要的 owner docs

Validation:

- 针对 API 查询、权限过滤、日期窗口、step 聚合和 scheduled task 关联补测试。
- 运行相关测试。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 需要避免 admin 与普通用户可见范围混淆；普通用户只能看到自己可访问 workspace 的 workflow / task。
- 已新增 `/api/workflows/dashboard`，普通用户按可访问 workspace folder 过滤，admin 不带 folder 过滤；scheduled task 只返回 `execution_type='workflow'`。
- 日期窗口使用前端传入的 `tzOffsetMinutes` 解析本地当天；active `queued/running` run 即使跨日仍保留在看板中。

### Milestone 3：Web 看板页面

Objective:

- 在 Web UI 增加工作流看板入口与页面，展示当天概览、运行中、定时任务日程、run 列表和 step 明细。

Allowed scope:

- `web/src/App.tsx`
- `web/src/components/layout/nav-items.ts`
- `web/src/pages/**`
- `web/src/stores/**`
- `web/src/components/**`
- 必要的 owner docs

Validation:

- `npm run typecheck`
- 前端构建或仓库统一验证入口。
- 使用浏览器打开本地页面检查桌面与移动布局。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- UI 应保持操作型控制台风格，避免营销式页面；首屏直接展示可操作运行情况。
- Web 新增 `/workflows` 路由与导航项 `工作流`；页面每 10 秒刷新一次，支持日期选择和手动刷新。
- 页面展示 summary cards、running run cards、scheduled workflow table、可展开 run / step 明细，并兼容 workflow 类型 scheduled task 的现有任务详情展示。

### Milestone 4：验证、review、文档与提交

Objective:

- 完成验证与 review gate，必要时同步 owner docs / roadmap，并提交本轮改动。

Allowed scope:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/**`
- 本轮已触及源码与测试

Validation:

- `npm run typecheck`
- 相关测试
- `./scripts/review.sh`
- `git diff --check`
- 必要时 `./scripts/validate.sh`

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 若改动影响正在运行服务，提交后按 `docs/COMMAND.md` 走安全重启路径，不直接 kill 服务。
- 验证已通过：`npm test -- tests/unit/agent/workflow/context.test.ts tests/integration/routes/workflows-dashboard.test.ts tests/unit/web/workflow-dashboard.test.ts`、`npm run typecheck`、`npm --prefix web run build`、`git diff --check`、`./scripts/review.sh`、`./scripts/validate.sh`。
- 页面检查已补充：`bun src/cli.ts restart` 安全重启后，使用内置浏览器访问 `http://127.0.0.1:3000/workflows`，桌面视图确认 `工作流看板` / `正在运行` / `定时工作流` / `今日运行记录` / `刷新` 均渲染且无错误横幅；390px 窄屏确认核心区块渲染且页面级 `scrollWidth === innerWidth`。
- Review gate 结果：scope / objective / pattern-fit / test / hygiene / docs / contract checks 均通过；未发现阻塞项。

## Handoff

Current milestone:

- Milestone 4

Current status:

- done

Changed files:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- `src/storage/db.ts`
- `src/web/app.ts`
- `src/web/routes/workflows.ts`
- `src/web/workflow-dashboard.ts`
- `tests/integration/routes/workflows-dashboard.test.ts`
- `tests/unit/agent/workflow/context.test.ts`
- `tests/unit/web/workflow-dashboard.test.ts`
- `web/src/App.tsx`
- `web/src/components/layout/nav-items.ts`
- `web/src/components/tasks/TaskCard.tsx`
- `web/src/components/tasks/TaskDetail.tsx`
- `web/src/pages/WorkflowsPage.tsx`
- `web/src/stores/tasks.ts`
- `web/src/stores/workflows.ts`

Last failure summary:

- 初始实现阶段曾暴露三类问题：缺少 dashboard route / aggregator、dashboard 查询默认 limit 与“当天所有运行”目标不一致、跨日完成 run 未被查询覆盖；均已通过实现和回归测试修复。

Suspected cause:

- n/a，当前无未解决失败。

Next step:

- 本轮实现、验证、review 与服务安全重启均已完成；下一步提交改动并向用户交付。后续若继续 Roadmap，可扩展 checkpoint 查看、失败节点重跑和 retry attempt 细节。
