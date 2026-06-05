# 当前任务：优化飞书 Workflow 进度卡样式

## Goal

- 修复飞书 workflow progress card 与启动回执信息挤压、换行差、阅读负担重的问题。
- 明确根因是卡片 markdown 把节点状态、耗时、内容摘要和本地任务拼成单行，启动回执也缺少结构化字段；改成分段字段、稳定换行和适度 emoji 的可扫读样式。

## Done when

- Workflow 进度卡标题、run 摘要、节点详情和 footer 都有清晰 emoji 与字段分隔。
- 节点详情不再出现 `**节点名**状态：...内容：...本地任务：...` 这种连续拼接；长内容摘要有截断和独立行。
- 启动回执不再把 workflow 名和 id 混在标题里，run id、workflow id、任务和通知说明独立成行。
- 相关单测、Feishu workflow E2E、typecheck、review gate 通过；如果影响正在运行服务，按安全路径重启并确认健康。
- 提交并 push。

## Milestones

### Milestone 1：测试锁定展示契约

Objective:
- 为 Feishu workflow 进度卡和 workflow 启动回执补充/更新失败测试，明确换行、emoji 和禁止行内挤压的契约。

Allowed scope:
- `PLANS/ACTIVE.md`
- `tests/unit/messaging/feishu/workflow-progress-card.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- 必要时只读检查相关 integration test

Validation:
- 新增/更新的目标测试在实现前失败，失败点指向旧样式仍在单行拼接。

Status:
- done

Validation status:
- passed: 新样式单测先红，失败点分别指向旧 progress card 字段无 emoji/挤压排版，以及旧启动回执 `已启动工作流 ... (id)` + `Run:` 格式

Review status:
- passed: 红测覆盖最终 payload / 用户可见回执，不依赖内部 helper 细节

Risks / Notes / Handoff:
- 样式变化需要兼顾飞书 markdown 卡片渲染，不引入复杂组件；优先通过 markdown 换行和字段拆分解决。

### Milestone 2：实现样式优化

Objective:
- 调整 workflow progress card 和启动回执的内容组织，保持现有发送/更新流程不变。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/workflow-progress-card.ts`
- `src/agent/workflow/command.ts`
- 相关测试
- 必要时同步 `docs/COMMAND.md` / `docs/RUNTIME.md`

Validation:
- Milestone 1 的红测变绿。
- 相关 Feishu workflow integration tests 继续通过。

Status:
- done

Validation status:
- passed:
  - `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts`
  - `npx vitest run tests/unit/agent/workflow/command.test.ts`
  - `npx vitest run tests/integration/messaging/feishu/e2e.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`
  - `npx vitest run tests/integration/web/slash-command.test.ts tests/integration/messaging/feishu/connection.test.ts`

Review status:
- passed: 样式改动只触及 workflow 启动回执、Feishu progress card 展示、对应测试和 owner 文档；workflow 审计/发送流程未改

Risks / Notes / Handoff:
- 只改展示层，不改变 workflow run/step 审计、进度卡创建和更新时机。

### Milestone 3：完整验证、服务应用与提交

Objective:
- 跑相关测试、typecheck、review gate，提交并 push；如影响运行服务，安全重启并确认健康。

Allowed scope:
- `PLANS/ACTIVE.md`
- 本轮已修改文件
- `PLANS/ROADMAP.md`（仅跨轮次事项）

Validation:
- `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts`
- `npx vitest run tests/integration/messaging/feishu/e2e.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`
- `npm run typecheck:backend`
- `git diff --check`
- `./scripts/review.sh`
- 如重启，`curl -fsS http://127.0.0.1:3000/api/health`

Status:
- done

Validation status:
- passed:
  - 红测：`npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts -t "renders pending"` 先失败，命中旧 progress card 样式。
  - 红测：`npx vitest run tests/unit/agent/workflow/command.test.ts -t "background workflow"` 先失败，命中旧启动回执样式。
  - `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts`
  - `npx vitest run tests/unit/agent/workflow/command.test.ts`
  - `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts`
  - `npx vitest run tests/integration/messaging/feishu/e2e.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`
  - `npx vitest run tests/integration/web/slash-command.test.ts tests/integration/messaging/feishu/connection.test.ts`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/review.sh`
  - `./scripts/validate.sh`

Review status:
- passed: `./scripts/review.sh` 通过；按 `RUNBOOKS/Review.md` 人工 diff review 未发现 blocking/important 问题。由于当前会话规则不允许在用户未明确要求时派生 subagent，未使用 code-reviewer subagent。

Risks / Notes / Handoff:
- `./scripts/validate.sh` 通过；输出中仍有既有 `MaxListenersExceededWarning` 与 Vite chunk size warning，非本轮新增失败。
- 安全重启 intent `restart-2026-06-05T13-15-49-602Z-091f282a` 状态 `passed`；`curl -fsS http://127.0.0.1:3000/api/health` 返回 `healthy`。

## Handoff

Current milestone:
- Milestone 3 done

Current status:
- validation_and_review_passed，服务已安全重启并健康；本地 `main` 已提交但 push 被本机 GitHub HTTPS/`gh` 凭据阻塞

Changed files:
- `PLANS/ACTIVE.md`
- `tests/unit/messaging/feishu/workflow-progress-card.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `src/messaging/providers/feishu/workflow-progress-card.ts`
- `src/agent/workflow/command.ts`
- `tests/integration/messaging/feishu/kol-command-e2e.test.ts`
- `tests/integration/web/slash-command.test.ts`
- `tests/integration/messaging/feishu/connection.test.ts`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`

Last failure summary:
- 红测符合预期：
  - `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts -t "renders pending"` 失败，旧卡片仍是 `Workflow 进度：...`、无字段 emoji、节点为普通换行。
  - `npx vitest run tests/unit/agent/workflow/command.test.ts -t "background workflow"` 失败，旧回执仍是 `🚀 已启动工作流 ... (id)` 与 `Run:`。

Suspected cause:
- Feishu 进度卡旧实现把 step title、status、duration、summary、local task 拼成同一个 markdown 段落，飞书渲染后在窄宽度下自然断行很差；启动回执也没有字段化。

Next step:
- push 到 `origin/main`；当前本机执行 `git push origin main` 失败：`fatal: failed to get: -25308` / `could not read Username for 'https://github.com': Device not configured`，且 `gh auth status` 未登录。需要恢复本机 GitHub 登录后运行 `git push origin main`，或用已授权 GitHub connector 接管远端更新。
