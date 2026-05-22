# 当前任务：自动化入口破坏性收敛与股票 loop 回推任务清理

> **给 agentic workers：** 本轮计划统一维护在 `PLANS/ACTIVE.md`；不得在 `docs/superpowers/`、`docs/**/plans/` 或 `docs/**/specs/` 新增计划。一次只推进一个 milestone；validation 和 review 均通过后才可提交。

## 背景

上一轮已把侧边栏 `任务` 与 `工作流` 收敛到 `自动化`，但仍保留 `/tasks` 与 `/workflows` 旧路由跳转。用户明确要求不再兼容旧入口，允许破坏性重构；同时指出自动化页 tab 出现滚动条，需要截图确认原因并修复；另需删除“股票系统 loop 进展回推”定时任务，删除前先确认是否有值得保留的进展。

## 目标

- 删除 `/tasks`、`/workflows` 旧入口兼容路由，只保留 `/automations`。
- 截图复现并定位自动化页 tab 滚动条原因，修复布局。
- 删除股票系统 loop 进展回推定时任务；删除前检查任务定义与运行记录，必要进展写入长期跟进记录。
- 同步 owner docs / roadmap / handoff，完成验证、review、提交与安全重启。

## 非目标

- 不改变 scheduler / workflow engine / DB schema。
- 不新增自动化后端聚合 API。
- 不重做股票系统 loop 策略本身；本轮只清理该回推定时任务并保留必要信息。

## Milestones

### Milestone 1：截图定位与任务进展确认

Objective:

- 在当前服务上截图复现 tab 滚动条，定位原因。
- 查找股票系统 loop 进展回推定时任务，读取任务定义和近期运行记录，判断是否有进展需要保留。

Allowed scope:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- 只读查询 Web 页面、数据库、任务运行记录和相关源码

Validation:

- 已保存自动化页截图或明确记录无法截图的原因。
- 已确认目标定时任务 ID、状态、近期运行记录和需保留信息。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 已截图复现：桌面宽度无明显页面滚动条，用户暗色截图和本地窄宽度截图显示 tab 胶囊右侧出现自身滚动条。
- 根因是 `TabsList` 上的 `overflow-x-auto` 把 tab 列表变成滚动容器，结合固定高度触发纵向 overflow 展示。
- 已确认 `stock-loop-progress-notifier`：状态 `paused`，最后运行 `2026-05-20T15:30:59.605Z`；共 7690 条运行日志，54 条非空结果、0 条错误。最近有效结果是旧 task-chain 的 2026-05-20 日终链路，信息已覆盖在 roadmap 的新 workflow loop 迁移记录中。

### Milestone 2：破坏性路由收敛与 tab 布局修复

Objective:

- 移除旧路由兼容跳转。
- 修复 tab 滚动条布局问题。
- 同步相关 owner docs，不再宣称旧入口兼容。

Allowed scope:

- `web/src/App.tsx`
- `web/src/pages/AutomationsPage.tsx`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- 必要的前端测试或截图脚本

Validation:

- 截图确认 tab 不再出现异常滚动条。
- `bun tsc --noEmit`
- `npm --prefix web run build`
- `git diff --check`

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 旧 `/tasks`、`/workflows` 访问将按全局 fallback 处理，不再做自动化页跳转。
- 已移除旧路由兼容跳转。
- 已把 tab 布局改为移动端三等分、桌面自适应宽度，并移除可滚 overflow；截图确认 `TabsList` 不再出现自身滚动条。

### Milestone 3：删除股票 loop 回推定时任务

Objective:

- 在保留必要进展后删除目标定时任务及相关本地任务记录。

Allowed scope:

- 本地 Cli Claw 运行数据库 / 任务记录
- `PLANS/ROADMAP.md`
- `PLANS/ACTIVE.md`

Validation:

- 删除后查询不到目标定时任务。
- 若有长期跟进信息，已写入 `PLANS/ROADMAP.md`。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 任务删除是本地运行数据变更，不一定产生 git diff；需在最终总结中明确说明。
- 已通过 Web API 删除 `stock-loop-progress-notifier`，复查 `scheduled_tasks` 与 `task_run_logs` 均已清空该任务。
- 旧任务最后有效进展已写入 `PLANS/ROADMAP.md`。

### Milestone 4：验证、review、提交与安全重启

Objective:

- 完成 validation / review gate，提交源码与文档变更，并按安全路径重启 Cli Claw 服务。

Allowed scope:

- 本轮已触及源码、文档、计划和本地任务数据

Validation:

- `bun tsc --noEmit`
- `npm --prefix web run build`
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

- 已通过 `bun tsc --noEmit`（web）、`npm --prefix web run build`、`git diff --check`、`npm run typecheck`、`./scripts/review.sh`、`./scripts/validate.sh`。
- `./scripts/validate.sh` 结果：78 个 test files passed、1 skipped；531 tests passed、1 skipped；全量 build 通过。
- Review gate：scope 与用户要求一致；路由删除不保留旧入口兼容；tab 布局不再使用 scroll overflow；股票旧回推任务删除前已保留最后有效进展；未发现需要继续阻塞的问题。

## Handoff

Current milestone:

- Milestone 4

Current status:

- done

Changed files:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `web/src/App.tsx`
- `web/src/pages/AutomationsPage.tsx`

Last failure summary:

- n/a

Suspected cause:

- n/a

Next step:

- 提交改动并最终安全重启服务。
