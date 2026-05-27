# 当前任务：移除股票策略自迭代工作流

## Goal

- 移除股票策略自迭代 workflow、动态调度控制面、专用看板状态和启动 seed，避免系统继续围绕 alpha 因子挖掘做高成本低收益的自动循环。
- 清理当前真实数据库中已暂停且冗余无用的股票策略计划，确保重启后不会被代码迁移再次创建或恢复。

## Done when

- `.agents/workflows/stock-strategy-*.json` 与对应股票策略 role card 不再作为内置工作流入口存在。
- 启动迁移不再创建 `web:stock-strategy` 工作区或 seed / 迁移 `stock-strategy-*` scheduled workflow。
- scheduler 不再解析或执行股票策略 planner decision、`next_workflows[]`、quality gate、evidence signature 短路、外部通知特判等专用逻辑；普通 workflow task 行为保持不变。
- Workflow command / local task / Web 自动化看板 / owner docs 不再暴露股票策略自迭代契约。
- 真实 DB 中当前已暂停/活跃的股票策略 scheduled task 与明显遗留错误计划被删除；关联 `task_run_logs` 随 schedule 清理，历史 `workflow_runs` / `workflow_run_steps` 审计保留。
- 验证与 review gate 通过，任务结果与 handoff 已写回本文件；若有长期事项，再同步 `PLANS/ROADMAP.md`。

## Milestones

### Milestone 1：删除内置 workflow 与调度控制面

Objective:
- 从代码、配置、测试和文档中移除股票策略自迭代 workflow 入口、启动 seed、scheduler 专用决策逻辑、Web 股票策略状态聚合与相关 owner 文档描述。

Allowed scope:
- `.agents/workflows/stock-strategy-*.json`
- `.agents/agent-roles/stock-strategy-*.md`
- `src/storage/db.ts`
- `src/agent/scheduler/index.ts`
- `src/agent/scheduler/stock-strategy-decision.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/tools.ts`
- `src/web/workflow-dashboard.ts`
- `web/src/pages/WorkflowsPage.tsx`
- `web/src/stores/workflows.ts`
- `tests/unit/agent/scheduler/*`
- `tests/unit/agent/workflow/*`
- `tests/unit/core/*`
- `tests/unit/storage/*`
- `tests/unit/web/*`
- `tests/e2e/stock-strategy-scheduler.e2e.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `docs/E2E.md`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Validation:
- `npm test -- tests/unit/agent/scheduler/workflow-task.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/core/schemas.test.ts tests/unit/storage/stock-strategy-workspace.test.ts tests/unit/web/workflow-dashboard.test.ts`
- `npm run typecheck:backend`
- `npm --prefix web run build`
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed：targeted tests、`npm run typecheck:backend`、`npm --prefix web run build` 和 `./scripts/validate.sh` 均通过。

Review status:
- passed：`./scripts/review.sh` 通过；语义复核已检查 diff、残留引用和退休清理边界，未发现阻塞问题。

Risks / Notes / Handoff:
- 用户已明确判断股票策略自迭代是伪命题，本轮不保留兼容壳、不继续维护 alpha 挖掘闭环。
- 仍保留通用 `/workflow`、workflow audit、scheduled workflow task、HK IPO workflow 和 stock-analysis repository skill；只删除股票策略自迭代这条内置自动循环。
- 启动清理会删除退役 `stock-strategy-*` scheduled task 及其 `task_run_logs`，避免外键留下半清理状态；历史 `workflow_runs` / `workflow_run_steps` 审计不删除。

### Milestone 2：清理真实暂停计划并完成收口

Objective:
- 在代码不再重建股票策略计划后，清理本机真实 DB 中已暂停的股票策略 scheduled task 和明显错误遗留计划，运行验证、review gate、安全重启检查，并提交。

Allowed scope:
- `~/.cli-claw/db/messages.db`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Validation:
- 查询真实 DB：不存在 active/paused 的 `stock-strategy-*` scheduled task；旧错误 id `stock-strategy-design-review` 不存在。
- `./scripts/validate.sh`
- `./scripts/review.sh`
- 如代码改动影响运行服务，按 `docs/COMMAND.md` 使用安全重启路径并检查 `/api/health`。

Status:
- done

Validation status:
- passed：真实 DB `scheduled_tasks` 为 0，`stock-strategy-*` / paused scheduled task 为 0；`./scripts/validate.sh` 通过；安全重启后 `/api/health` 返回 healthy。

Review status:
- passed：`./scripts/review.sh` 通过；语义复核确认 owner docs / runtime 配置不再暴露股票策略自迭代入口，残留仅为退休清理 SQL。

Risks / Notes / Handoff:
- DB 清理只删除后续调度计划；若直接删除 scheduled task，关联 `task_run_logs` 也需同步删除以满足外键约束。历史 workflow run / step 审计不删除。
- `~/.cli-claw/db/messages.db` 当前 `scheduled_tasks` 为 0 条，没有 active/paused 的 `stock-strategy-*` 或其他 paused 计划需要删除；本轮已清理对应 `task_run_logs` 以满足 scheduled task 外键，历史 `workflow_runs` / `workflow_run_steps` 审计保留。
- 已扫 `~/.cli-claw` 与当前仓库 `.cli-claw` 下 SQLite 文件，未发现其他包含 paused / `stock-strategy-*` scheduled task 的活动库。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 删除代码时必须沿引用链清理入口、配置、测试、文档和调用方，不保留兼容壳或悬空引用。
- milestone 只有 validation 与 review 都通过后才可标记 `done`。

## Handoff

Current milestone:
- complete

Current status:
- done

Changed files:
- `.agents/workflows/stock-strategy-*.json` 已删除
- `.agents/agent-roles/stock-strategy-*.md` 已删除
- `src/storage/db.ts`
- `src/agent/scheduler/index.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/tools.ts`
- `src/web/workflow-dashboard.ts`
- `web/src/pages/WorkflowsPage.tsx`
- `web/src/stores/workflows.ts`
- 相关测试与 owner docs
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Last failure summary:
- `./scripts/review.sh` 首次因 `src/storage/db.ts` prettier 格式失败；已运行 prettier 后通过。后续完整验证发现退休 task 删除前未删除 `task_run_logs` 会触发外键失败；已改为先删日志再删 scheduled task，并重跑 targeted/full validation 通过。

Suspected cause:
- 退役 scheduled task 清理需要同时处理 `task_run_logs` 外键；最终实现已对齐。

Next step:
- 提交本轮改动。
