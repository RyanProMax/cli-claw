# ARCHITECTURE

> 本文负责：系统分层、核心消息 / 执行数据流、关键边界。目录树和模块清单只在 `docs/MODULE.md` 维护。

## 定位

Cli Claw 是一个自托管、多用户的 CLI Agent 协作系统。它接收 Web 与 IM 消息，在宿主机或 Docker 中运行 Agent，并把流式结果、文件和任务状态回传给用户。

## 分层

- `src/cli.ts`：外部 launcher，负责仓库自带 / 同名发布包中的 `cli-claw start` / `help` / `version` 参数分发。
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
7. 主进程保留底层 `StreamEvent` 契约，同时通过共享展示语义层把流式文本归入 answer / commentary 等展示槽位，再通过 WebSocket 或 IM 通道回推给用户。
8. 任务调度、技能安装和跨工作区通知等能力，通过内置 MCP 工具回到主进程执行。

## IM 消息可靠性

- IM 入站消息先落库，再进入队列；飞书链路会记录 durable lifecycle 事件，覆盖 `received` / `stored` / `notified` / `queued` / `runner_started` / `stream_started` / `finalized` / `im_delivered` / `cursor_committed` / `dead_lettered`。
- 飞书 live WS 与 startup backfill 共用去重语义：只有通过 stale-window 过滤的消息才会写入 seen cache，避免自启动阶段的过期 WS 事件毒化后续 backfill。
- startup backfill 不只依赖 owner 字段；只要 Feishu chat 与正在连接用户共享 workspace/folder，就应纳入启动恢复候选，覆盖 ownerless 或 stale-owner 的历史绑定。
- 普通服务模式下，startup pending-message recovery、conversation-agent recovery 和主消息循环必须等待 IM connection phase 完成后再启动，避免恢复消息早于飞书连接可用而丢投递。
- 回复游标提交必须受 IM 投递结果约束：当某条 Feishu-origin turn 依赖 static IM delivery 且投递最终失败时，不能提交对应 inbound cursor；该 turn 应保持 retryable 或记录明确 dead-letter。
- 飞书 streaming card 是 IM 可见进度面；answer 文本出现前的工具、hook、status、todo 等辅助进度也应创建/更新卡片，避免 Web 有流式进展而飞书静默。
- 消息调度允许连续同源 pending batch：若入库顺序为 `A1/A2/B1/A3/B2/B3`，应按 `A1+A2 -> A`、`B1 -> B`、`A3 -> A`、`B2+B3 -> B` 处理；pending batch 只包含尚未处理、未提交 cursor 的连续同源消息，不得捞取已处理历史、recovery summary 或旧 interrupted 内容补上下文。
- 当前 runtime query 正在输出时，新用户消息不能被 `stream.push()` 注入同一 query；它必须排队到下一轮。只有 query 已完成、runner idle 等待 IPC 时，同来源消息才可复用同一 runtime session。这样卡片路由切换不会接住上一轮仍在流出的工具步骤。
- Runner stdout 是当前 turn 的 live output 边界：底层 runtime session 的恢复、历史 transcript 读取和旧执行事件都必须在 runner 内部闭环，不能作为 stream event 发给主进程。
- graceful shutdown / self-restart / crash recovery 不持久化 interrupted partial 正文，也不直接发到 IM；若后续新用户消息前仍存在中断残留，只处理新的未提交用户消息，不能自动把旧上下文混入新 prompt。

## 工作区与会话身份

- `registered_groups` 是工作区入口注册表；`jid` 是 Web / IM 对外入口，`folder` 是平台存储和默认主会话的目录键。
- 多个入口可以共享同一个 `folder`。它们是否共享上下文，不看 channel 类型，而看是否最终路由到同一个 conversation identity。
- Workspace 主对话使用 `(folder, 空 agentId)`；Web 创建的 conversation agent 使用 `(folder, agentId)`，消息落到虚拟 JID `{workspaceJid}#agent:{agentId}`。
- Runner 只是一次正在执行的底层 CLI 进程或容器，不是长期会话身份。

## 边界

- `package root`、`launch cwd`、`~/.cli-claw` 数据目录是三条不同边界：前者负责资源定位，中者负责 host 默认执行目录，后者负责平台持久化。
- 主进程拥有认证、权限、路由、持久化和多用户隔离。
- 用户隔离优先：非 admin 只能访问自己的工作区和被授权共享的工作区。
- `groups/{folder}` 是工作区内容边界；`registered_groups` 是入口边界，多个入口共享同一 `folder` 时不代表多个独立项目。
- runner 拥有具体 CLI 会话、工具调用和流式事件生产。
- 记忆机制与上下文保留见 `docs/MEMORY.md`。
- 运行时矩阵、`agentType` / `executionMode` 约束和外部运行时契约见 `docs/RUNTIME.md`。
