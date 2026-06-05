# 当前任务：精简 Workflow 启动回执并优化 KOL 报告排版

## Goal

- 飞书 workflow 触发后不再额外发送“已启动工作流 / Run / 任务”文本气泡；飞书入口只保留独立 workflow progress card，非飞书或没有进度卡能力的入口保留回执兜底。
- 优化 `/kol` 最终报告排版：去掉重复分割线、减少段落空行、规范来源格式、把长段落拆成可扫读编号要点。

## Done when

- Feishu slash workflow 触发后只创建/更新 workflow progress card，不再保存或发送启动回执文本消息。
- KOL 报告每个观点之间只保留一根分割线，观点内部字段之间没有多余空行。
- 来源列表不再出现 `| x`，改成 `{文章标题} [YYYY-MM-DD]`。
- 结论/总结和“下一步重点核验”等长段落能拆成编号列表，避免单段塞满一整屏。
- 相关单测 / E2E / typecheck / review gate 通过；如影响运行服务，按安全路径重启并健康检查。

## Milestones

### Milestone 1：根因定位与红测

Objective:
- 定位 Feishu workflow 启动回执发送路径和 KOL 报告格式来源。
- 先写失败测试覆盖：Feishu workflow 不发送启动回执、KOL 报告格式归一化。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `.agents/skills/stock-kol-intel/`
- 只读检查 `src/agent/workflow/`、`src/messaging/`、`src/index.ts`
- 相关测试文件

Validation:
- 新增/更新的测试在实现前失败，失败点分别指向旧启动回执仍发送和旧 KOL 报告格式未归一化。

Status:
- done

Validation status:
- red_tests_added

Review status:
- passed

Risks / Notes / Handoff:
- 飞书无 progress reporter 或 CardKit 失败时仍需要有终态消息；本轮只移除“启动回执”，不移除成功/失败终态消息。

### Milestone 2：实现修复

Objective:
- 调整 workflow command / Feishu slash command 触发链路，让 Feishu 有 progress card 时不发启动文本。
- 在 KOL workflow 输出边界增加确定性轻量排版归一化，或强化已有报告提示/后处理，满足来源和段落格式要求。

Allowed scope:
- `PLANS/ACTIVE.md`
- `.agents/skills/stock-kol-intel/`
- `src/agent/workflow/command.ts`
- `src/messaging/`
- `src/index.ts`
- 相关测试
- 必要时同步 `docs/COMMAND.md` / `docs/RUNTIME.md`

Validation:
- Milestone 1 红测变绿。
- `/kol` 和 Feishu workflow 相关 E2E 继续通过。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- KOL 报告来自 OpenAI role 生成，必须在 prompt 约束之外加确定性后处理，避免同类排版回归。

### Milestone 3：完整验证、服务应用与提交

Objective:
- 跑相关测试、typecheck、review gate，提交；如影响运行服务，安全重启并确认健康。

Allowed scope:
- `PLANS/ACTIVE.md`
- 本轮已修改文件
- `PLANS/ROADMAP.md`（仅跨轮次事项）

Validation:
- `npx vitest run` 相关目标测试
- `npm run typecheck:backend`
- `git diff --check`
- `./scripts/review.sh`
- 如重启，`curl -fsS http://127.0.0.1:3000/api/health`

Status:
- done

Validation status:
- passed:
  - 红测：`npx vitest run tests/unit/agent/workflow/command.test.ts -t "normalizes kol final report"` 先失败，命中旧 KOL 输出格式。
  - 红测：`npx vitest run tests/unit/agent/workflow/local-tasks.test.ts -t "prepare_context"` 先失败，命中旧 KOL artifact 模板。
  - 红测：`npx vitest run tests/unit/agent/workflow/config.test.ts -t "KOL intelligence"` 先失败，命中旧 role card。
  - 红测：`npx vitest run tests/integration/messaging/feishu/e2e.test.ts -t "workflow progress card"` 先失败，命中旧 workflow 启动文本。
  - `npx vitest run tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/messaging/slash-command.test.ts`
  - `npx vitest run tests/integration/messaging/feishu/e2e.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`
  - `npx vitest run tests/integration/web/slash-command.test.ts`
  - `npx vitest run tests/integration/messaging/feishu/connection.test.ts`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/review.sh`
  - `./scripts/validate.sh`
  - `curl -fsS http://127.0.0.1:3000/api/health`

Review status:
- passed: `./scripts/review.sh` 通过；按 `RUNBOOKS/Review.md` 人工 diff review 未发现 blocking 问题

Risks / Notes / Handoff:
- `./scripts/validate.sh` 通过；输出中仍有既有 `MaxListenersExceededWarning` 与 Vite chunk size warning，非本轮新增失败。
- 安全重启 intent `restart-2026-06-05T13-37-52-233Z-47e21a46` 状态 `passed`；`curl -fsS http://127.0.0.1:3000/api/health` 返回 `healthy`。
- 本机 GitHub HTTPS / `gh` 凭据当前不可用；上一轮本地 `main` 已 ahead 且未 push。本轮提交后仍可能需要用户恢复 GitHub 登录后 push。

## Handoff

Current milestone:
- Milestone 3 done

Current status:
- validation_and_review_passed，服务已安全重启并健康；本轮改动已通过提交前门禁

Changed files:
- `PLANS/ACTIVE.md`
- `src/messaging/slash-command.ts`
- `src/messaging/providers/feishu/index.ts`
- `src/messaging/providers/wechat/index.ts`
- `src/index.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/engine.ts`
- `.agents/workflows/kol.json`
- `.agents/agent-roles/kol-intel-reporter.md`
- `tests/integration/messaging/feishu/e2e.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`
- `tests/unit/messaging/slash-command.test.ts`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`

Last failure summary:
- 红测已覆盖旧行为：飞书 workflow 仍发送启动文本；KOL 报告仍保留 `| x`、重复分割线、多余空行和单段长总结；local task / role card 仍暴露旧模板约束。
- 修复后 targeted / broadened tests、`npm run typecheck:backend`、`git diff --check`、`./scripts/review.sh`、`./scripts/validate.sh`、安全重启和 health check 已通过。

Suspected cause:
- Feishu workflow 触发路径把 `executeWorkflowCommand(... background: true ...)` 返回值当作普通即时回复继续发送；progress card 是额外卡片，因此形成“启动文本 + 进度卡”双输出。
- KOL 报告格式主要由 role prompt 生成，缺少投递前的确定性格式归一化，导致模型把多个字段之间插入多余空行、来源保留 `| x` 后缀、长总结不拆点。

Next step:
- 提交本轮改动；若需要同步远端，恢复本机 GitHub HTTPS / `gh` 凭据后 push。
