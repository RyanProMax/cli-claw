# Cli Claw

> 本文负责：仓库入口、必读顺序、复杂任务执行底线、执行协议入口和文档分工入口。模块树只在 `docs/MODULE.md` 维护；架构、运行时、记忆机制、命令说明分别由 `docs/ARCHITECTURE.md`、`docs/RUNTIME.md`、`docs/MEMORY.md`、`docs/COMMAND.md` 维护。

Cli Claw 是一个多用户、自托管的 CLI Agent 平台。主服务负责消息接入、权限、调度、存储与 Web API；前端负责 Web / PWA 体验；`container/agent-runner/` 负责实际 Agent 执行、工具调用与流式事件。当前文档口径只维护 Codex / OpenAI 运行时。

## 必读顺序

1. 先读本文件，再读 `docs/ENGINEERING.md`。
2. 按任务补读 owner 文档：
   - 架构与消息流：`docs/ARCHITECTURE.md`
   - 运行时矩阵与外部运行时契约：`docs/RUNTIME.md`
   - 记忆机制与上下文保留：`docs/MEMORY.md`
   - 模块树与目录定位：`docs/MODULE.md`
   - 命令行为与入口差异：`docs/COMMAND.md`
   - E2E / live smoke 凭据发现与安全边界：`docs/E2E.md`
3. 复杂任务开始前，先查看 `PLANS/ROADMAP.md` 了解长期跟进项，再读取并更新本地 `PLANS/ACTIVE.md`；若 `ACTIVE.md` 不存在，先基于 `PLANS/_TEMPLATE.md` 创建。
4. 涉及实施、review、handoff 时，分别对照 `RUNBOOKS/Implement.md`、`RUNBOOKS/Review.md`、`RUNBOOKS/Handoff.md`。

## 文档分工

- `docs/ARCHITECTURE.md`：系统分层、关键数据流、主进程与 runner 边界。
- `docs/MODULE.md`：唯一维护的 repo tree / 模块清单。
- `docs/RUNTIME.md`：`agentType`、runtime identity、工作区 cwd、外部运行时契约。
- `docs/MEMORY.md`：记忆层级、触发时机、存储路径、读取方式与增长边界。
- `docs/ENGINEERING.md`：实施流程、验证、review/commit 规则。
- `docs/COMMAND.md`：统一命令注册表与入口差异。
- `docs/E2E.md`：E2E / live smoke 入口、凭据发现方式与真实外部消息测试边界。

## 输出语言

- Agent 内部分析、工具调用、代码标识、命令和 commit message 可以使用英文。
- 面向用户输出的执行计划、文档说明、阶段总结、handoff 和最终总结必须使用中文；引用英文 API、命令、字段或错误信息时保留原文，并补充中文说明。
- 新增或更新仓库协作协议、计划和 runbook 时，正文以中文为主；必要的英文术语、文件名、命令名和接口名可保留原文。

## 执行协议文件

- 仓库级执行协议放在 tracked 文件里：`AGENTS.md`、`PLANS/ROADMAP.md`、`PLANS/_TEMPLATE.md`、`RUNBOOKS/*.md`、`.agents/roles/*.md`、`.agents/skills/**/SKILL.md`。
- `PLANS/ROADMAP.md` 负责跨轮次长期跟进；`PLANS/ACTIVE.md` 是当前复杂任务的本地临时计划，不作为长期协议入口。
- 所有 superpowers / spec workflow / plan 产物必须统一落在 `PLANS/`：当前执行计划写 `PLANS/ACTIVE.md`，跨轮次事项写 `PLANS/ROADMAP.md`，模板写 `PLANS/_TEMPLATE.md`。禁止创建或写入 `docs/superpowers/`、`docs/superpowsers/`、`docs/**/plans/`、`docs/**/specs/` 作为计划或规格落盘位置；发现旧文件应迁移或删除。
- `docs/.local/PLAN.md` 若有人自行创建，只能视为个人草稿。

## 复杂任务底线

1. 复杂任务必须先看 `PLANS/ROADMAP.md`，再更新 `PLANS/ACTIVE.md`，然后才开始编码。
2. `PLANS/ACTIVE.md` 是任务执行期间的单一真相源；目标、milestone、scope、验证、阻塞与 handoff 都以它为准。
3. `PLANS/ROADMAP.md` 负责跨轮次的长期迭代跟进；未在本轮完成、但需要继续追踪的事项必须回写到 roadmap。
4. 一次只允许一个 milestone 处于 `in_progress`。
5. 不允许隐式扩 scope；目标、方案、验证方式或涉及文件变化时，先更新 active plan，再继续实现。
6. 删除代码时必须沿引用链清理入口、分发、配置、测试、文档和调用方；允许破坏性重构，以最低复杂度和最小结构为准，不保留兼容壳、死代码或悬空引用。
7. 每轮实现后都必须运行验证；验证失败时留在当前 milestone 修复，不得跳过。
8. 验证通过后仍必须经过 review gate；只有 validation 和 review 都通过，当前 milestone 才能标记为 `done`。
9. 任务完成后必须回写 `PLANS/ACTIVE.md` 的结果与 handoff；若有跨轮次事项，再同步更新 `PLANS/ROADMAP.md`，然后再提交。

## Subagent 规则

- 只有在任务可拆成窄职责、低耦合、可并行的子问题时，才允许显式派生 subagents。
- scope 未锁定、验证标准未写清、或当前主路径立即被阻塞时，不要先派生 subagents。
- 主 agent 负责汇总、决策、最终改动与 milestone 推进，不把主路径责任外包给 subagent。
- 角色定义统一看 `.agents/roles/*.md`：
  - `reader`：只读探索
  - `implementer`：窄写入实施
  - `tester`：复现与验证
  - `reviewer`：diff 审查
- subagent 返回必须结构化，至少包含 `summary`、`files`、`risks`、`next_action`。

## Repository Skills

- 仓库内联 skill 统一放在 `.agents/skills/<skill-id>/SKILL.md`。
- skill 命令只从当前 workspace 的 `.agents/skills` 发现；不要新增用户级 cli-claw skills、host sync 或 legacy fallback 的文档、测试或代码覆盖。
- `.agents/skills` 用于随仓库协作协议一起版本化的轻量命令 skill；Web UI 不再提供用户 Skill 管理、同步、安装、启停或删除入口。
- skill command 的 `/help` 展示格式固定为 `- /command [argumentHint]：description`，没有参数时省略参数占位。
- `commands.json` 的 `description` 只写命令用途，不写参数、默认值或支持选项；参数和默认值只允许放在 `argumentHint`、`argument_hint` 或 `usage`。
- `usage` 可以写完整命令，例如 `/kol [--days=30]`；`argumentHint` / `argument_hint` 只写命令后的参数占位，例如 `[--days=30]`。

## 验证与提交

- 优先执行当前 milestone 写明的验证命令；若仓库提供统一入口，优先使用 `./scripts/validate.sh` 与 `./scripts/review.sh`。
- 至少运行与改动直接相关的测试；涉及构建、类型或跨子项目改动时，补跑对应 `build` / `typecheck`。
- 未验证部分必须在收尾说明中明确指出。
- 除非用户明确要求不要提交，任务完成后默认在 validation 和 review 都通过后自动提交。
- 若任务改动会影响正在运行的 Cli Claw 服务，收尾时默认按 `docs/COMMAND.md` 约定走安全重启路径应用变更，不直接使用 `kill` / `pkill` / `launchctl bootout`。
- commit message 使用英文，一次 commit 聚焦一个任务。

## 文档同步触发

出现以下变化时，必须更新对应 owner 文档，而不是在多个入口重复复制说明：

- 架构分层、执行路径、消息流、权限边界变更
- 工作区 / Memory / MCP / Skills / 运行时目录约定变更
- 新增或重命名关键模块、页面、路由、核心 store
- 影响协作入口、验证方式、review / handoff 流程的工程规则变更
