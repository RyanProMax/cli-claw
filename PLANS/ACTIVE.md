# 当前任务：整合任务与工作流入口

> **给 agentic workers：** 本轮计划统一维护在 `PLANS/ACTIVE.md`；不得在 `docs/superpowers/`、`docs/**/plans/` 或 `docs/**/specs/` 新增计划。一次只推进一个 milestone；validation 和 review 均通过后才可提交。

## 背景

Web 侧边栏当前同时存在 `任务` 与 `工作流` 两个一级入口。实际系统中，`任务` 管理 `scheduled_tasks` 计划对象，`工作流` 观察 `workflow_runs` / `workflow_run_steps` 执行审计；而 `execution_type='workflow'` 的定时任务同时落在两边，导致用户在“设置自动跑什么”和“看工作流跑到哪里”之间来回切换，心智割裂。

用户已确认整合方向：把两者收敛到一个 `自动化` 入口，内部按 `计划`、`运行`、`工作流` 分视角承载现有能力。

## 目标

- 侧边栏一级入口从 `任务` + `工作流` 收敛为一个 `自动化`。
- 新增 `/automations` 页面，用 tab 组织三类视角：
  - `计划`：管理所有定时计划，复用现有任务管理能力。
  - `运行`：聚焦当前 running / queued 和今日运行记录。
  - `工作流`：保留 workflow 专属看板、定时 workflow task 和 step 审计。
- 保留旧路由 `/tasks`、`/workflows` 的兼容跳转，避免已有链接失效。
- 不改变 scheduler / workflow engine / 数据库语义；本轮只做 Web 信息架构与路由整合。

## 非目标

- 不新增自动化后端聚合 API；本轮优先复用现有 `/api/tasks` 与 `/api/workflows/dashboard`。
- 不实现 workflow 定义编辑器、checkpoint 查看或失败节点重跑。
- 不改变 `/workflow` slash command、scheduled task 执行语义或运行中删除边界。

## Milestones

### Milestone 1：计划与边界确认

Objective:

- 确认现有页面、路由、导航和数据边界，锁定整合方案。

Allowed scope:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `web/src/App.tsx`
- `web/src/components/layout/nav-items.ts`
- `web/src/pages/**`
- `web/src/components/tasks/**`
- `web/src/stores/**`
- `tests/**`

Validation:

- 已阅读现有 `TasksPage`、`WorkflowsPage`、导航、路由和 owner docs。
- 用户已批准将入口整合为 `自动化`。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- `任务` 是计划管理视角，`工作流` 是 workflow run 审计视角；整合时不能把两者误改成同一个数据模型。
- 本轮优先前端整合，避免扩大到 scheduler 或 workflow engine。

### Milestone 2：自动化页面与路由整合

Objective:

- 新增自动化总入口，整合计划 / 运行 / 工作流视角，并让旧路由兼容跳转。

Allowed scope:

- `web/src/App.tsx`
- `web/src/components/layout/nav-items.ts`
- `web/src/pages/AutomationsPage.tsx`
- `web/src/pages/TasksPage.tsx`
- `web/src/pages/WorkflowsPage.tsx`
- 必要的 owner docs

Validation:

- `npm --prefix web run build`
- `npm run typecheck`
- `git diff --check`

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 已新增 `AutomationsPage`，侧边栏只保留 `自动化` 一级入口。
- `计划` tab 嵌入任务管理页，`运行` tab 同时展示 agent/script 运行中任务和 workflow running / queued，`工作流` tab 保留 workflow 专属审计。
- `/tasks` 与 `/workflows` 已重定向到 `/automations?tab=plans` 和 `/automations?tab=workflows`。

### Milestone 3：文档、验证、review 与提交

Objective:

- 同步 owner docs / roadmap，完成验证和 review gate，提交并安全重启服务。

Allowed scope:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/**`
- 本轮已触及源码与测试

Validation:

- `npm --prefix web run build`
- `npm run typecheck`
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

- 若当前环境仍无法使用浏览器控制工具，收尾需说明截图级浏览器验证缺口，并用 build / typecheck / route-level 检查兜底。
- 提交后按 `docs/COMMAND.md` 走安全重启路径，不直接 kill 服务。
- 已通过 `bun tsc --noEmit`（web）、`npm --prefix web run build`、`npm run typecheck`、`git diff --check`、`./scripts/review.sh`、`./scripts/validate.sh`。
- Review gate 结果：scope / objective / pattern-fit / test / hygiene / docs / route compatibility 均通过；曾发现 tab 内容可能重复挂载轮询，已改为仅挂载当前视图。

## Handoff

Current milestone:

- Milestone 3

Current status:

- done

Changed files:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- `web/src/App.tsx`
- `web/src/components/layout/nav-items.ts`
- `web/src/components/tasks/TaskCard.tsx`
- `web/src/pages/AutomationsPage.tsx`
- `web/src/pages/TasksPage.tsx`
- `web/src/pages/WorkflowsPage.tsx`

Last failure summary:

- n/a

Suspected cause:

- n/a

Next step:

- 提交改动并安全重启服务。后续可继续抽象 `/api/automations/dashboard`，把计划与运行数据在后端统一聚合。
