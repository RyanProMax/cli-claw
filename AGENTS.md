# Cli Claw

> 本文负责：仓库入口、必读顺序、复杂任务执行底线、文档分工入口。模块树只在 `docs/MODULE.md` 维护；架构、运行时、持久化边界、命令说明分别由 `docs/ARCHITECTURE.md`、`docs/RUNTIME.md`、`docs/CONTEXT.md`、`docs/COMMAND.md` 维护。

Cli Claw 是一个多用户、自托管的 CLI Agent 平台。主服务负责消息接入、权限、调度、存储与 Web API；前端负责 Web / PWA 体验；`container/agent-runner/` 负责实际 Agent 执行、工具调用与流式事件。当前运行时包括 `claude`（Claude Agent SDK + Claude Code CLI）和 `codex`（Codex CLI + `codex-acp`）。

## 必读顺序

1. 先读本文件，再读 `docs/ENGINEERING.md`。
2. 按任务补读 owner 文档：
   - 架构与消息流：`docs/ARCHITECTURE.md`
   - 运行时矩阵与外部运行时契约：`docs/RUNTIME.md`
   - 工作区 / Memory / 持久化边界：`docs/CONTEXT.md`
   - 模块树与目录定位：`docs/MODULE.md`
   - 命令行为与入口差异：`docs/COMMAND.md`
3. 复杂任务开始编码前，必须读取并更新本地 `PLANS/ACTIVE.md`；若文件不存在，先基于 `PLANS/_TEMPLATE.md` 创建。
4. 涉及实施、review、handoff 时，分别对照 `RUNBOOKS/Implement.md`、`RUNBOOKS/Review.md`、`RUNBOOKS/Handoff.md`。

## 文档分工

- `docs/ARCHITECTURE.md`：系统分层、关键数据流、主进程与 runner 边界。
- `docs/MODULE.md`：唯一维护的 repo tree / 模块清单。
- `docs/RUNTIME.md`：`agentType` / `executionMode`、runtime identity、外部运行时契约。
- `docs/CONTEXT.md`：工作区身份、记忆路径、持久化与权限边界。
- `docs/ENGINEERING.md`：实施流程、验证、review/commit 规则。
- `docs/COMMAND.md`：统一命令注册表与入口差异。

## 复杂任务底线

1. 复杂任务必须先看并更新 `PLANS/ACTIVE.md`，再开始编码。
2. `PLANS/ACTIVE.md` 是任务执行期间的单一真相源；目标、milestone、scope、验证、阻塞与 handoff 都以它为准。
3. 一次只允许一个 milestone 处于 `in_progress`。
4. 不允许隐式扩 scope；目标、方案、验证方式或涉及文件变化时，先更新 active plan，再继续实现。
5. 每轮实现后都必须运行验证；验证失败时留在当前 milestone 修复，不得跳过。
6. 验证通过后仍必须经过 review gate；只有 validation 和 review 都通过，当前 milestone 才能标记为 `done`。
7. 任务完成后必须回写 `PLANS/ACTIVE.md` 的结果与 handoff，再做最终提交。

## Subagent 规则

- 只有在任务可拆成窄职责、低耦合、可并行的子问题时，才允许显式派生 subagents。
- scope 未锁定、验证标准未写清、或当前主路径立即被阻塞时，不要先派生 subagents。
- 主 agent 负责汇总、决策、最终改动与 milestone 推进，不把主路径责任外包给 subagent。
- 角色定义统一看 `.codex/agents/*.md`：
  - `reader`：只读探索
  - `implementer`：窄写入实施
  - `tester`：复现与验证
  - `reviewer`：diff 审查
- subagent 返回必须结构化，至少包含 `summary`、`files`、`risks`、`next_action`。

## 验证与提交

- 优先执行当前 milestone 写明的验证命令；若仓库提供统一入口，优先使用 `./scripts/validate.sh` 与 `./scripts/review.sh`。
- 至少运行与改动直接相关的测试；涉及构建、类型或跨子项目改动时，补跑对应 `build` / `typecheck`。
- 未验证部分必须在收尾说明中明确指出。
- commit message 使用英文，一次 commit 聚焦一个任务。

## 文档同步触发

出现以下变化时，必须更新对应 owner 文档，而不是在多个入口重复复制说明：

- 架构分层、执行模式、消息流、权限边界变更
- 工作区 / Memory / MCP / Skills / 运行时目录约定变更
- 新增或重命名关键模块、页面、路由、核心 store
- 影响协作入口、验证方式、review / handoff 流程的工程规则变更
