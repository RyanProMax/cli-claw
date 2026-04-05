# ARCHITECTURE

> 本文负责：系统分层、核心消息 / 执行数据流、关键边界。目录树和模块清单只在 `docs/MODULE.md` 维护。

## 定位

Cli Claw 是一个自托管、多用户的 CLI Agent 协作系统。它接收 Web 与 IM 消息，在宿主机或 Docker 中运行 Agent，并把流式结果、文件和任务状态回传给用户。

## 分层

- `src/cli.ts`：外部 launcher，负责 npm 包 `cli-claw-kit` 安装后的 `cli-claw start` / `help` / `version` 参数分发。
- `src/app-root.ts`：安装包根目录、launch cwd 与应用资源定位的边界解析。
- `src/index.ts`：主服务 bootstrap，负责接入消息、队列调度、持久化、WebSocket 推送和系统协调。
- `src/container-runner.ts`：执行编排层，负责选择宿主机进程或 Docker 容器，并管理 runner 生命周期。
- `container/agent-runner/src/index.ts`：运行时执行层，负责驱动底层 CLI runtime、流式事件、MCP 工具和上下文压缩。
- `web/src/pages/ChatPage.tsx`：Web 展示层，把流式消息、工作区状态和运行时设置组合成用户界面。

## 核心数据流

1. 操作者在 shell 中执行 `cli-claw start`，launcher 解析命令并启动 backend bootstrap。
2. backend 启动时校验当前启动目录，并为缺失 `customCwd` 的 host 工作区物化默认执行目录。
3. 用户从 Web 或 IM 入口发来消息。
4. 主进程写入数据库，并把请求按工作区路由到队列。
5. 队列启动宿主机进程或 Docker 容器，再由 `agent-runner` 根据工作区 runtime 配置选择 Claude Runtime 或 Codex Runtime。
6. runner 产生文本、思考、工具调用和任务事件，经 stdout / IPC 回到主进程。
7. 主进程把流式事件通过 WebSocket 或 IM 通道回推给用户。
8. 任务调度、技能安装、记忆读写和跨工作区通知等能力，通过内置 MCP 工具回到主进程执行。

## 边界

- `package root`、`launch cwd`、`~/.cli-claw` 数据目录是三条不同边界：前者负责资源定位，中者负责 host 默认执行目录，后者负责平台持久化。
- 主进程拥有认证、权限、路由、持久化和多用户隔离。
- runner 拥有具体 CLI 会话、工具调用和流式事件生产。
- 工作区、记忆和持久化路径边界见 `docs/CONTEXT.md`。
- 运行时矩阵、`agentType` / `executionMode` 约束和外部运行时契约见 `docs/RUNTIME.md`。
