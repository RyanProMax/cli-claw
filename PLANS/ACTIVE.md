# 当前任务：Workflow 实时进度飞书独立卡片

## Goal

- 在触发 workflow 时，额外创建一张独立飞书消息卡片，用于实时展示并更新 workflow 进度。
- 卡片必须展示 workflow 每个节点的内容、状态和耗时，并随 workflow run / step 状态变化更新。
- 完成卡片样式设计、代码落地、类似线上环境的 E2E 测试、sub-agent review、验证、提交、push，并在需要时安全重启服务和清理孤儿进程。

## Done when

- `main` 已 push 到 `origin/main`，包括上一轮已提交修复和本轮最终实现。
- workflow 被触发后，触发会话除启动回执 / 终态结果外，还有独立进度卡片。
- 进度卡片能随节点 lifecycle 更新，至少覆盖 pending / running / success / failed / degraded / skipped 等状态，并显示每个节点标题、摘要内容和耗时。
- 进度卡片与普通 Agent streaming card 分离，不污染最终回复正文、不破坏 workflow thread / context 隔离。
- 有 in-process、类似线上环境的飞书 E2E 测试验证触发、卡片创建、节点更新、终态状态和失败场景。
- 派生 sub-agent 做代码 review，review 无 blocking 问题。
- 计划内验证命令通过，完成 review gate。
- 提交、push；如影响运行服务，按 `docs/COMMAND.md` 安全重启并确认健康。

## Milestones

### Milestone 1：上下文探索与设计确认

Objective:
- 阅读 workflow engine、workflow run/step 审计、Feishu card builder/updater、IM command/workflow trigger 和现有 E2E 路径。
- 给出卡片样式与数据流设计，覆盖实时更新、失败降级和测试策略。
- 在用户确认设计前不写生产实现代码。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `src/agent/workflow/`
- 只读检查 `src/messaging/providers/feishu/`
- 只读检查 `src/index.ts`
- 只读检查 `tests/integration/messaging/feishu/`
- 只读检查 `docs/ARCHITECTURE.md`、`docs/RUNTIME.md`、`docs/COMMAND.md`、`docs/E2E.md`

Validation:
- 记录现有数据流、可复用模块、缺口和推荐方案。
- 设计得到用户确认。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 已完成第一项：当前 `main` 已 push 到 `origin/main`，远端从 `36c2610` 更新到 `3094e02`。
- `docs/ARCHITECTURE.md` 当前只规定 workflow 触发回执和终态结果，没有独立实时进度卡片。
- `docs/RUNTIME.md` 当前已有 workflow run/step 审计和 Feishu streaming card 契约；新卡片必须作为 workflow 展示层，不成为 runtime session 或记忆边界。
- `src/agent/workflow/engine.ts` 已在 role/local task 节点运行前后调用 `recordStep`，但事件只进 `workflow_run_steps`，没有飞书展示层订阅。
- `src/agent/workflow/command.ts` 的 background 模式只返回启动回执并通过 `onBackgroundResult` 发送终态文本，缺少 progress reporter 生命周期。
- `src/storage/db.ts` 的 `workflow_run_steps.started_at/completed_at` 当前不会自动填充；若调用方不显式传入时间，节点耗时无法从审计数据恢复。
- `src/index.ts` 的 `/workflow`、repository skill workflow rewrite 和 scheduler `runWorkflowCommand` 都汇入同一个 `handleWorkflowSlashCommand`，应在统一入口挂进度 reporter，避免只覆盖手动 slash。
- 现有 `tests/integration/messaging/feishu/e2e.test.ts` 已有 CardKit mock，可捕获 `createdCards` / `updatedCards`，适合扩展为进度卡 in-process E2E。
- 用户继续 active goal，按推荐方案 A 进入 TDD 实现：在统一 workflow command 入口挂 Feishu-only progress reporter。
- 仓库协议禁止把 superpowers/spec 产物写到 `docs/superpowers`；本轮设计/计划统一写在 `PLANS/ACTIVE.md`，需要长期沉淀的稳定契约再同步 owner docs。

### Milestone 2：TDD 实现 workflow 进度卡片

Objective:
- 先写失败测试，覆盖 workflow 触发时进度卡片创建、节点状态更新、耗时展示和终态更新。
- 实现最小可维护方案，沿用现有 Feishu card / workflow 审计边界。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/agent/workflow/`
- `src/messaging/providers/feishu/`
- `src/index.ts`
- `src/storage/`
- `tests/integration/messaging/feishu/`
- `tests/unit/` 或 `tests/integration/` 中必要新增测试
- 必要时同步 `docs/ARCHITECTURE.md`、`docs/RUNTIME.md`、`docs/COMMAND.md`

Validation:
- 新增定向测试先红后绿。
- 相关 workflow / Feishu E2E 测试通过。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 不允许只靠最终静态消息假装“实时”；E2E 必须看到至少一次运行中更新和一次终态更新。
- 不允许把节点详情塞进普通最终回复正文；进度卡片必须独立。
- 已实现 workflow progress reporter：run 创建、run 状态更新、step lifecycle 都会驱动独立飞书 CardKit 卡片更新；普通 Agent streaming card 仍保持分离。
- 已修复相邻可靠性风险：若 `card.create` 成功但 `message.create` 短暂失败或无 `message_id`，后续更新会继续尝试发送 card reference，不会永久更新一张用户不可见的卡。
- 已把 `workflow_run_steps.started_at/completed_at` 在 running/terminal upsert 时自动补齐，保证节点耗时可从审计数据恢复。
- 已提升节点摘要展示：local task artifact 优先展示 `result/summary/message/title/description`，避免 `{ status: "ok", result: ... }` 只显示 `ok`。
- 已同步 owner docs，scheduled workflow 的飞书进度卡口径收窄为“执行会话本身是已连接飞书入口时”。
- 验证通过：定向 workflow/Feishu 单测、完整 Feishu in-process E2E、`npm run typecheck:backend`、`git diff --check`、`./scripts/review.sh`。
- sub-agent reviewer 初审发现 1 个 blocking 与 3 个相邻问题；修复后复审通过，无 blocking/important 问题。

### Milestone 3：sub-agent review、完整验证、提交 push 与服务应用

Objective:
- 派生 sub-agent review 本轮 diff，修复 blocking/important 问题。
- 运行完整验证和 review gate。
- 提交、push；如影响当前服务，安全重启并确认健康，必要时清理孤儿 runner。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`（仅跨轮次事项）
- 本轮已修改文件

Validation:
- 与实现相关的定向测试
- `npm run typecheck:backend`
- `git diff --check`
- `./scripts/review.sh`
- sub-agent review 结果无 blocking 问题
- push 后 `git status -sb` 显示本地与 `origin/main` 对齐
- 如重启，`/api/health` 返回 healthy

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 若真实 Feishu live smoke 需要发消息，遵守 `docs/E2E.md` 的 `[e2e]` 前缀和凭据安全边界。
- 若安全重启发现真正孤儿 runner，按现有 self-restart 孤儿清理路径处理，不直接粗暴 `pkill`。
- sub-agent 语义 review 已通过；仓库 review 脚本已通过。
- 已通过 repo-local safe launcher `bun src/cli.ts restart` 请求安全重启；restart intent `restart-2026-06-04T16-28-59-887Z-a85aee94` 状态为 `passed`。
- 重启后 `/api/health` 返回 healthy；旧 backend PID `28931` 已退出，当前 backend PID 为 `8932`；未发现残留 `agent-runner` 进程。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 验证失败和 review 失败都留在当前 milestone 修复，不能跳过。
- 只有 `Validation status: passed` 且 `Review status: passed` 后，milestone 才能标记为 `done`。

## Handoff

Current milestone:
- Milestone 3 done

Current status:
- implementation, validation, semantic review, commit, push, and safe service restart are complete

Changed files:
- `PLANS/ACTIVE.md`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
- `src/agent/workflow/progress.ts`
- `src/index.ts`
- `src/messaging/channel.ts`
- `src/messaging/manager.ts`
- `src/messaging/providers/feishu/index.ts`
- `src/messaging/providers/feishu/workflow-progress-card.ts`
- `src/storage/db.ts`
- `tests/integration/messaging/feishu/e2e.test.ts`
- `tests/unit/agent/workflow/context.test.ts`
- `tests/unit/messaging/feishu/workflow-progress-card.test.ts`

Findings:
- 已 push 当前 `main` 到 `origin/main`。
- 根因：workflow run/step lifecycle 只持久化和最终文本通知，没有独立 Feishu progress card 的创建、状态订阅、更新和失败降级链路。
- 相邻缺口已修复：step 审计时间戳自动填充，CardKit 发送失败会重试可见消息引用，artifact 摘要展示真实结果，workflow E2E 覆盖 manager/channel wiring。
- 验证已通过：
  - `npm test -- tests/unit/agent/workflow/context.test.ts tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/engine.test.ts --run`
  - `npm test -- tests/integration/messaging/feishu/e2e.test.ts --run`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/review.sh`
- sub-agent reviewer 复审通过，无 blocking/important 问题。
- 服务已按 `docs/COMMAND.md` 走安全重启路径应用源码变更；`/api/health` healthy，current backend PID `8932`。
- 最终实现已提交并 push 到 `origin/main`；实现提交为 `0d31a38 Add Feishu workflow progress cards`，后续仅有计划 handoff 文案更新。

Next step:
- 无，本轮目标已完成。
