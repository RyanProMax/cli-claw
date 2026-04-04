# Architecture Context

## 项目定位

cli-claw 是一个自托管、多用户的 AI Agent 协作系统。它接收 Web 与 IM 消息，在宿主机或 Docker 中运行 Agent，并把流式结果、文件和任务状态回传给用户。

## 系统分层

- `src/`：主服务。负责认证、RBAC、消息路由、队列、定时任务、工作区管理、Memory API、MCP Server 配置、运行时存储。
- `web/`：React + Vite 前端。负责聊天、设置、监控、Memory、任务、MCP Server 和用户管理界面。
- `container/agent-runner/`：执行引擎。负责调用 Claude/Codex 运行时、流式事件、MCP 工具、上下文压缩、后台任务通知。
- `data/`：运行时数据。包含数据库、工作区目录、用户全局记忆、日期记忆、会话缓存、IPC、环境变量和配置。

## 核心数据流

1. 用户从 Web / 飞书 / Telegram / QQ / 钉钉发来消息。
2. 主进程把消息写入数据库，并按工作区路由到 `GroupQueue`。
3. 队列选择宿主机进程或 Docker 容器启动 `agent-runner`。
4. `agent-runner` 调用 Agent SDK，产生文本、思考、工具调用和任务事件。
5. 流式事件经 stdout / IPC 回到主进程，再通过 WebSocket 和 IM 渠道发给用户。
6. 定时任务、技能安装、跨组发消息、记忆读写等能力通过内置 MCP 工具回到主进程执行。

## 执行与记忆模型

- 工作区分 `host` 与 `container` 两种执行模式；`codex` 仅允许 `host`。
- 每个用户有一个 `is_home=true` 的主工作区。admin 主工作区默认 `main`，member 主工作区默认 `home-{userId}`。
- 项目内部长期记忆使用 `AGENTS.md`：
  - 用户全局记忆：`data/groups/user-global/{userId}/AGENTS.md`
  - 工作区记忆：`data/groups/{folder}/AGENTS.md`
  - 时效性记忆：`data/memory/{folder}/YYYY-MM-DD.md`
  - 对话归档：`data/groups/{folder}/conversations/`
- 启动时会把旧 `CLAUDE.md` 一次性迁移到 `AGENTS.md`；若同目录已存在 `AGENTS.md`，则以新文件为准。
- `.claude/` 与 `~/.claude/CLAUDE.md` 属于外部 Claude 运行时契约，不参与本项目内部记忆改名。

## 关键边界

- 用户隔离优先：非 admin 只能访问自己的工作区、自己的 user-global 和授权共享工作区。
- `data/groups/{folder}` 是项目内工作区；host + `customCwd` 时工作区根可落到外部目录，仍按 `AGENTS.md` 作为项目内部记忆文件。
- `.claude/` 下的 settings / skills / rules 是运行时配置，不等同于项目内部记忆。
- 修改消息路由、执行模式、Memory 路径、MCP 工具名或 docs 入口时，要同步更新 `AGENTS.md` 和对应 docs。
