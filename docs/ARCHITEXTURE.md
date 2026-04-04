# ARCHITEXTURE

## 定位

Cli Claw 是一个自托管、多用户的 AI Agent 协作系统。它接收 Web 与 IM 消息，在宿主机或 Docker 中运行 Agent，并把流式结果、文件和任务状态回传给用户。

## 分层

- `src/`：主服务，负责认证、路由、队列、定时任务、工作区管理、Memory API、MCP Server 配置和运行时存储。
- `web/`：React 前端，负责聊天、设置、监控、Memory、任务、MCP Server 和用户管理界面。
- `container/agent-runner/`：执行引擎，负责调用 Claude / Codex 运行时、流式事件、MCP 工具、上下文压缩和后台任务通知。
- `data/`：运行时数据，包含数据库、工作区目录、用户全局记忆、日期记忆、会话缓存、IPC、环境变量和配置。

## 数据流

1. 用户从 Web / 飞书 / Telegram / QQ / 钉钉发来消息。
2. 主进程写入数据库，并按工作区路由到 `GroupQueue`。
3. 队列选择宿主机进程或 Docker 容器启动 `agent-runner`。
4. `agent-runner` 调用 Agent SDK，产生文本、思考、工具调用和任务事件。
5. 流式事件经 stdout / IPC 回到主进程，再通过 WebSocket 和 IM 渠道发给用户。
6. 定时任务、技能安装、跨组发消息、记忆读写等能力通过内置 MCP 工具回到主进程执行。
