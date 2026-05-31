# 当前任务：将 /kol 完全迁移到工作流体系

## Goal

- 将原本由 `stock-kol-intel` skill 生成 `assistant_prompt` 并进入主 Agent 会话的 `/kol` 流程，迁移为 Cli Claw workflow：slash command 只触发 `workflowId=kol`，工作流内完成白名单读取、X/Twitter 预检、KOL 情报整理和飞书移动端友好日报输出。
- 保留 `/kol [--days=30]` 用户入口与原报告质量规则，为后续定时 workflow 任务复用同一条执行路径打基础。

## Done when

- `/kol [--days=N]` 的 repository skill executor 返回 `reply.type="workflow"`，不再返回 `assistant_prompt`，且非法参数仍返回本地用法提示。
- 新增内置 `kol` workflow、runtime role card 和默认 local task；`/workflow kol ...` 与 scheduled workflow 可以不经过 `/kol` skill executor 直接执行同一套 KOL 情报流程。
- workflow local task 复用 `stock-kol-intel` 白名单和 twscrape 源预检能力，输出结构化 artifact，避免把抓取/预检过程塞进主会话。
- 报告角色继续遵守原 `/kol` 规则：白名单范围、原文链接、主题合并、可跟踪方向、来源可信度、弱证据剔除、不输出买卖建议。
- `docs/COMMAND.md`、`docs/RUNTIME.md`、`docs/MODULE.md` 和必要架构说明已同步 `/kol` 工作流契约。
- 相关回归测试、统一验证和 review gate 通过；完成后按仓库规则提交。

## Milestones

### Milestone 1：红灯测试与迁移边界确认

Objective:
- 为 `/kol` skill workflow trigger、内置 `kol` workflow 配置和 KOL local task 建立失败优先的回归测试，锁定迁移目标。

Allowed scope:
- `PLANS/ACTIVE.md`
- `tests/contracts/skills/**`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`
- 只读检查 `.agents/skills/**`、`.agents/workflows/**`、`.agents/agent-roles/**`、`src/agent/workflow/**`

Validation:
- 新增定向测试在旧实现上失败，失败原因分别证明：`/kol` 仍是 `assistant_prompt` 或外部委托、`kol` workflow 不存在、`stock.kol.prepare_context` local task 未注册。

Status:
- done

Validation status:
- passed：新增红灯测试已运行并失败在预期位置。`tests/contracts/skills/stock-kol-command.test.ts` 单独运行显示 `/kol` 仍返回 `assistant_prompt` 且非法参数没有在 workflow dispatch 前拦截；合并定向测试显示 `kol` workflow 缺失，`stock.kol.prepare_context` 未注册。

Review status:
- passed：测试只覆盖迁移目标，未改生产路径；第一轮并发运行出现过一次旧委托超时噪声，单独重跑 contract 测试确认失败原因稳定为旧 `assistant_prompt`。

Risks / Notes / Handoff:
- 上一轮用户已认可“白名单 KOL 情报流水线”设计；本轮直接实施，不再额外创建 `docs/superpowers/*`，遵守仓库禁止规则。

### Milestone 2：实现 /kol workflow 化

Objective:
- 新增 `kol` workflow、role card、local task，并把 `.agents/skills/stock-kol-intel` 的 `/kol` executor 改为 workflow trigger。

Allowed scope:
- `PLANS/ACTIVE.md`
- `.agents/skills/stock-kol-intel/**`
- `.agents/workflows/kol.json`
- `.agents/agent-roles/kol-intel-reporter.md`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/tools.ts`
- `tests/contracts/skills/**`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`

Validation:
- `npm test -- tests/contracts/skills/stock-kol-command.test.ts`
- `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts`

Status:
- done

Validation status:
- passed：`npm test -- tests/contracts/skills/stock-kol-command.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts` 通过，3 个文件 17 个测试全部通过。

Review status:
- passed：变更集中在 `/kol` skill executor、`kol` workflow/role card、默认 local task 注册与对应测试；未改普通消息主线、scheduler 执行语义或 HKIPO local task 行为。`/kol` 非法参数仍在本地返回用法提示，合法参数只返回 workflow trigger。

Risks / Notes / Handoff:
- local task 只读取公开白名单和 twscrape 预检结果；X 原站不可访问时必须结构化标注 `unavailable/error`，交由报告角色降权处理。

### Milestone 3：文档同步、全量验证与提交

Objective:
- 同步 owner 文档，运行统一 validation/review gate，完成 handoff 与提交。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`（仅当留下跨轮次事项）
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `docs/MODULE.md`
- `docs/ARCHITECTURE.md`
- 本轮已修改文件

Validation:
- `npm test -- tests/contracts/skills/stock-kol-command.test.ts`
- `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts`
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed：定向回归 `npm test -- tests/contracts/skills/stock-kol-command.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts` 通过，3 个文件 17 个测试全部通过；统一验证 `./scripts/validate.sh` 通过，Vitest 76 个文件通过 / 1 个跳过，515 个测试通过 / 1 个跳过，typecheck 和 build 均通过。

Review status:
- passed：`./scripts/review.sh` 通过；`npx prettier --write src/agent/workflow/local-tasks.ts` 修复格式后重跑定向测试、统一验证和 review 均通过。已手动语义 review `git diff`、新增 workflow/role/local task/test/doc 变更、`git diff --check` 和调试残留搜索，未发现阻塞问题。

Risks / Notes / Handoff:
- 若 workflow 调度或飞书私聊定时任务创建需要真实 Feishu open_id / scheduled task 配置，本轮只完成可复用工作流契约，不替用户伪造线上定时任务。
- 无跨轮次实现事项需要同步到 `PLANS/ROADMAP.md`。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 验证失败和 review 失败都留在当前 milestone 修复，不能跳过。
- 只有 `Validation status: passed` 且 `Review status: passed` 后，milestone 才能标记为 `done`。

## Handoff

Current milestone:
- Milestone 3

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `.agents/skills/stock-kol-intel/SKILL.md`
- `.agents/skills/stock-kol-intel/commands.json`
- `.agents/skills/stock-kol-intel/commands/dispatch.py`
- `.agents/workflows/kol.json`
- `.agents/agent-roles/kol-intel-reporter.md`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/tools.ts`
- `tests/contracts/skills/stock-kol-command.test.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`

Last failure summary:
- 已修复：`/kol` executor 改为 workflow trigger；新增 `kol` workflow / `kol-intel-reporter` role / `stock.kol.prepare_context` local task；同步 owner 文档；定向测试、`./scripts/validate.sh` 和 `./scripts/review.sh` 均通过。

Suspected cause:
- 旧 `/kol` executor 仍委托 `stock-kol-intel/commands/kol.py`，返回 `assistant_prompt`，导致命令执行污染主 runtime session，也不能被 scheduled workflow 复用。

Next step:
- 本轮迁移已完成；若后续需要真实 8 点日报或爆点实时推送，需要在 scheduled workflow / Feishu 私聊目标上配置实际投递对象与触发策略。
