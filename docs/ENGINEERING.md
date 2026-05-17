# ENGINEERING

> 本文负责：实施流程、验证、review / commit 规则，以及什么时候必须同步文档。架构、运行时和持久化边界不在这里重复。

## 工作流

1. 复杂任务开始前先查看 `PLANS/ROADMAP.md` 了解长期项，再创建或更新本地 `PLANS/ACTIVE.md`；若 `ACTIVE.md` 不存在，先从 `PLANS/_TEMPLATE.md` 复制。
2. `PLANS/ACTIVE.md` 是复杂任务执行的单一真相源；目标、milestone、scope、验证、阻塞与 handoff 都先回写这里。
3. `PLANS/ROADMAP.md` 负责跨轮次长期跟进；本轮没完成但需要继续追踪的事项必须同步回写 roadmap。
4. 一次只推进一个 milestone；未完成当前 milestone 前，不得隐式扩 scope 或提前推进下一项。
5. 每轮实现后必须运行验证；验证失败时停留在当前 milestone 修复，不得跳过。
6. 验证通过后仍需经过 review gate；只有 validation 和 review 都通过，milestone 才能标记为 `done`。
7. 连续修复仍失败、当前线程阻塞、需要换线程继续或交接给下一个 Codex 会话时，必须写 handoff。
8. 实施、review、handoff 的具体循环分别按 `RUNBOOKS/Implement.md`、`RUNBOOKS/Review.md`、`RUNBOOKS/Handoff.md` 执行。

## 修改约束

- 先读上下文再改代码；优先沿用现有模块边界与命名风格。
- 搜索优先用 `rg` / `rg --files`。
- 手工修改代码或文档时优先用 `apply_patch`；避免用脚本粗暴重写整个文件。
- 不回滚用户已有改动；遇到冲突先理解再兼容。
- 禁止使用破坏性 git 命令（如 `reset --hard`、`checkout --`），除非用户明确要求。
- 运行时、记忆和外部契约的细节分别见 `docs/RUNTIME.md` 与 `docs/MEMORY.md`。

## 文档同步要求

出现以下改动时，必须更新对应 owner 文档，而不是在多个入口重复写一遍：

- 架构分层、执行路径、消息流、权限边界变更
- 工作区 / Memory / MCP / Skills / 运行时目录约定变更
- 新增或重命名关键模块、页面、路由、核心 store
- 影响协作入口、提交流程、验证方式、review / handoff 流程的工程规则变更

## 验证

- 优先执行当前 milestone 明确写出的验证命令；若仓库提供统一入口，优先使用 `./scripts/validate.sh`。
- milestone 完成前要补跑 `./scripts/review.sh` 或等价 review helper，再按 `RUNBOOKS/Review.md` 做语义审查。
- 至少运行与改动直接相关的测试。
- 涉及构建、类型或跨子项目改动时，补跑对应 `build` / `typecheck`。
- 未验证的部分必须在收尾说明里明确指出。

## 提交约定

- 除非用户明确要求不要提交，完成任务时默认在验证通过并完成 review gate 后自动提交。
- 若任务改动影响正在运行的 Cli Claw 服务，提交后默认走安全服务重启路径应用变更；使用 `cli-claw restart` 或 IM `/self-restart`，不要直接执行 `kill` / `pkill` / `launchctl bootout` 之类的停机命令。
- commit message 使用英文。
- 一次 commit 聚焦一个任务，避免把无关清理混进去。
- 若任务涉及文档入口、架构边界或运行时记忆，commit 前确认 `AGENTS.md` / `docs/` 已同步。
