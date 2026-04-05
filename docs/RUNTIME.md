# RUNTIME

## 概览

Cli Claw 不把某一个 SDK 写死在主进程里。主进程只负责多用户隔离、消息路由、队列和持久化；真正的 Agent 会话由 `container/agent-runner/` 按工作区运行时配置调用底层 CLI runtime。

## 运行时矩阵

| `agentType` | 底层运行时 | 支持执行模式 | 当前认证方式 | 备注 |
| --- | --- | --- | --- | --- |
| `claude` | Claude Agent SDK + Claude Code CLI | `host` / `container` | Web 向导配置 Claude Provider（OAuth / setup-token / API Key） | 容器镜像当前只内置这条运行时 |
| `codex` | Codex CLI + `codex-acp` | `host` | 宿主机执行 `codex login` | 不支持 `container` |

## 选择规则

- 工作区的 `agentType` 决定底层 CLI runtime。
- 工作区的 `executionMode` 决定 runtime 在宿主机还是 Docker 中运行。
- `codex` 会被强制约束到 `host`。
- admin 主工作区默认 `host`；member 主工作区默认 `container`。

## 运行时身份

每次助手回复都尽量携带一份 `runtime_identity`：

- `agentType`
- `model`
- `reasoningEffort`
- `supportsReasoningEffort`

这份元数据会沿着 runner -> backend -> DB / WebSocket -> Web / IM 卡片 一路透传，用于：

- Web 消息 footer
- 飞书卡片 footer
- run log / dispatch log 排障
- 区分“请求的运行时”和“实际执行的运行时”

## 外部运行时契约

项目内部记忆统一使用 `AGENTS.md`，但外部 CLI runtime 仍保留各自原生约定：

- `~/.cli-claw/sessions/{folder}/.claude/`
  - Claude Runtime 的隔离会话目录
- `~/.claude/.credentials.json`
  - Claude Runtime 的本地登录态来源之一
- `~/.codex/config.toml`
  - Codex Runtime 的模型 / reasoning effort 配置
- `codex login`
  - Codex Runtime 的宿主机登录态

## 开发约束

- 新增或修改运行时时，必须同步更新：
  - `AGENTS.md`
  - `docs/ARCHITECTURE.md`
  - `docs/CONTEXT.md`
  - `docs/MODULE.md`
  - 本文档
- 不要把项目内部长期记忆文件重新命名回 `CLAUDE.md`；`AGENTS.md` 才是项目内统一记忆入口。
- 不要把某个运行时的专属约定误写成系统级通用规则。
