# Cli Claw

Cli Claw 是一个多用户、自托管的 AI Agent 系统：`src/` 负责消息接入、权限、调度、存储与 Web API，`web/` 是 React 前端，`container/agent-runner/` 负责实际 Agent 执行。项目内部运行时记忆统一使用工作区或用户目录下的 `AGENTS.md`；外部 Claude 生态的 `.claude/CLAUDE.md` 仍按原协议保留。

详细资料见：`docs/ARCHITECTURE.md`（项目结构与核心数据流）、`docs/CONTEXT.md`（持久化架构约束与边界）、`docs/MODULE.md`（后端/前端/runner 模块索引）、`docs/ENGINEERING.md`（开发规范、验证与提交流程）。

强制流程：开始任务前更新本地 `docs/.local/PLAN.md`，结束后回填结果、验证和后续项；每完成一个任务立即提交一个中文 commit。凡是修改架构、模块边界、执行模式、记忆机制或协作文档入口，必须同步更新对应 docs。
