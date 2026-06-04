# ARCHITECTURE

> 本文负责：系统分层、核心消息 / 执行数据流、关键边界。目录树和模块清单只在 `docs/MODULE.md` 维护。

## 定位

Cli Claw 是一个单实例、自托管的 CLI Agent 工具。它接收 Web、飞书和微信消息，通过本地 Agent 进程运行 Codex/OpenAI，并把流式结果、文件和 workflow 状态回传给操作者。

## 分层

- `src/cli.ts`：外部 launcher，负责仓库自带 / 同名发布包中的 `cli-claw start` / `help` / `version` 参数分发。
- `src/app-root.ts`：安装包根目录、launch cwd 与应用资源定位的边界解析。
- `src/index.ts`：主服务 bootstrap，负责接入消息、队列调度、持久化、WebSocket 推送和系统协调。
- `src/agent/workflow/`：工作流/crew 编排层，负责发现工作区或内置 `.agents/workflows` 与 `.agents/agent-roles` 配置，并把 workflow run 映射到独立执行上下文。
- `src/agent/runner/container-runner.ts`：执行编排层，负责启动本地 Agent 进程并管理 runner 生命周期。文件名暂保留历史路径，不代表另一条执行边界。
- `container/agent-runner/src/index.ts`：运行时执行层，负责驱动底层 CLI runtime、流式事件、内置 runner 工具和上下文压缩。
- `web/src/pages/ChatPage.tsx`：Web 展示层，把流式消息、工作区状态和模型配置入口组合成用户界面。
- `web/src/pages/AutomationsPage.tsx`：Web 自动化入口，整合 workflow schedule 计划、当前运行视图与 workflow 审计视图。

## 核心数据流

1. 操作者在 shell 中执行 `cli-claw start`，launcher 解析命令并启动 backend bootstrap。
2. backend 启动时校验当前启动目录，并为缺失 `customCwd` 的主工作区物化默认执行目录。
3. 用户从 Web 或 IM 入口发来消息。
4. 主进程写入数据库，并把请求按工作区路由到队列。
5. 若消息触发 workflow，主进程先创建独立 workflow run/context；飞书入口会同时创建一张独立 workflow 进度卡，并由 workflow run/step 审计事件驱动更新。随后 workflow engine 调度 `local_task` 与 role node；普通消息仍按原路径进入本地 Agent 进程。
6. 队列或 workflow dispatcher 启动本地 Agent 进程，再由 `agent-runner` 加载工作区的 Codex/OpenAI 模型配置以及显式传入的 workflow/role metadata。
7. runner 产生文本、思考、工具调用和任务事件，经 stdout / IPC 回到主进程。
8. 主进程保留底层 `StreamEvent` 契约，同时通过共享展示语义层把流式文本归入 answer / commentary 等展示槽位，再通过 WebSocket 或 IM 通道回推给用户。
9. 任务调度和跨工作区通知等能力，通过内置 runner tools 回到主进程执行；Skill 扩展只保留仓库级 `.agents/skills` slash command 文件，不再通过 Web UI 或 runner 工具安装用户 Skill；Web UI 不提供 workspace MCP 配置入口。

Web `自动化` 页面统一承载 workflow 定时计划、当前运行和 workflow 看板。Workflow 看板主要读取主数据库中的 `workflow_runs`、`workflow_run_steps`、`scheduled_tasks` 与 `task_run_logs`，不参与 workflow 调度、不写 checkpoint，也不重跑节点。看板允许对 `execution_type='workflow'` 的定时任务做编辑 / 删除：编辑只改 `scheduled_tasks` 的 workflow id、prompt、调度和值状态；删除只移除后续调度任务，不强制中断已经启动的 workflow run，既有 run/step 审计继续保留。单实例 session 登录后即可查看实例内所有工作区的 workflow 运行。

`/hkipo` 是当前内置 workflow 示例：用户仍从 skill slash command 入口触发，但 skill executor 只返回 `workflowId=hkipo` 和结构化 input；主进程随后执行 Futu IPO 池发现、池标准化、核心数据采集计划、二级热度/发行结构/估值证据采集、证据核验、官方文件下载解析、发行结构与估值分析、回测校准和最终报告节点。Futu/OpenD 不可用时 pool discovery 失败；Futu 可用但热度、绿鞋、基石、回拨、保荐或估值字段缺失时，证据采集节点继续按公开只读来源和 HKEX 官方文件补齐并记录降级。采集脚本自身失败或超时时，只允许 `stock.hkipo.scan_heat` / `stock.hkipo.fetch_official_docs` 返回降级 artifact，不能中断整个 workflow；后续 verifier / report 必须把该情况表述为“热度未达当日核验门槛”或“多源未取到”，并说明缺失字段。

`/kol` 同样是 skill slash command 到 workflow 的快捷入口：skill executor 只校验 `--days` 并返回 `workflowId=kol`，不再生成 `assistant_prompt` 或进入用户主线会话。workflow 的 local task 从 `stock-kol-intel` 白名单与 X/Twitter 预检生成结构化 `kol_context`，报告角色再按主题/共识合并输出 KOL 情报日报；该 workflow 可被 `/workflow kol ...` 和 scheduled workflow 复用。

飞书 workflow 进度卡与普通 Agent streaming card 是两张不同消息卡片：前者只展示 workflow run 与各节点状态、内容摘要和耗时，后者只展示普通 runtime 的流式 answer / thinking / tool steps。进度卡读取 `workflow_runs` / `workflow_run_steps` 的运行事实，不写 runtime session、不参与记忆边界，也不替代启动回执和终态结果消息。

## IM 消息可靠性

- IM 入站消息先落库，再进入队列；飞书链路会记录 durable lifecycle 事件，覆盖 `received` / `stored` / `notified` / `queued` / `runner_started` / `stream_started` / `finalized` / `im_delivered` / `cursor_committed` / `dead_lettered`。
- 飞书 live WS 与 startup backfill 共用去重语义：只有通过 stale-window 过滤的消息才会写入 seen cache，避免自启动阶段的过期 WS 事件毒化后续 backfill。
- 飞书 WS 健康检查确认离线后，不能只等待 SDK 或应用层重连成功；服务必须在离线窗口内按节流频率执行 backfill，确保私聊 / slash workflow 命令不会长时间滞留到下一次成功重连才处理。
- startup backfill 按实例级 Feishu / workspace/folder 绑定恢复候选，不依赖用户归属字段。
- 普通服务模式下，startup pending-message recovery、conversation-agent recovery 和主消息循环必须等待 IM connection phase 完成后再启动，避免恢复消息早于飞书连接可用而丢投递。
- 回复游标提交必须受 IM 投递结果约束：当某条 Feishu-origin turn 依赖 static IM delivery 且投递最终失败时，不能提交对应 inbound cursor；该 turn 应保持 retryable 或记录明确 dead-letter。
- 飞书 streaming card 是 IM 可见进度面；answer 文本出现前的工具、hook、status、todo 等辅助进度也应创建/更新卡片，避免 Web 有流式进展而飞书静默。
- 飞书 workflow 触发成功后还应创建独立 progress card：run 状态变化和 step upsert 会驱动卡片更新，覆盖待处理、运行中、完成、失败、降级和跳过节点；卡片更新失败只能降级为日志，不得中断 workflow 执行或终态投递。
- 消息调度允许连续同源 pending batch：若入库顺序为 `A1/A2/B1/A3/B2/B3`，应按 `A1+A2 -> A`、`B1 -> B`、`A3 -> A`、`B2+B3 -> B` 处理；pending batch 只包含尚未处理、未提交 cursor 的连续同源消息，不得捞取已处理历史、recovery summary 或旧 interrupted 内容补上下文。
- 当前 runtime query 正在输出时，新用户消息不能被 `stream.push()` 注入同一 query；它必须排队到下一轮。只有 query 已完成、runner idle 等待 IPC 时，同来源消息才可复用同一 runtime session。这样卡片路由切换不会接住上一轮仍在流出的工具步骤。
- Runner stdout 是当前 turn 的 live output 边界：底层 runtime session 的恢复、历史 transcript 读取和旧执行事件都必须在 runner 内部闭环，不能作为 stream event 发给主进程。
- graceful shutdown / self-restart / crash recovery 不持久化 interrupted partial 正文，也不直接发到 IM；若后续新用户消息前仍存在中断残留，只处理新的未提交用户消息，不能自动把旧上下文混入新 prompt。

## 工作区、线程与入口路由

- `registered_groups` 是工作区和外部入口注册表；`jid` 是 Web / IM 对外入口，`folder` 是平台存储、默认 cwd 和 runtime session 的目录键。
- 用户只直接面对工作区与任务。Web 工作区列表只展示 `web:` 工作区，且只有 `web:main` 是默认主工作区；飞书 / 微信注册项只是入口路由记录，不作为可点击工作区行展示。
- 工作区负责项目边界：执行目录、文件访问、仓库级 `.agents` 配置、workflow 定义、模型配置和默认主线。只有需要不同 cwd、不同 `.agents` 配置或不同文件边界时，才创建独立工作区。
- `threads` 是内部上下文容器，不作为全局一级产品对象。每个工作区有一条 `kind=main` 主线线程；用户发起的并行任务使用 `kind=task` 线程；workflow run / workflow context 使用 `kind=workflow` 线程承载后续追问和来源显示。
- 线程是稳定业务身份，底层 Codex/OpenAI session 是线程背后的运行时身份；session 丢失时可以按线程消息和 runtime session 表重建，不能把 runner 进程本身当作长期身份。
- 主线线程映射到 `(folder, 空 agentId)`；任务线程可映射到内部 conversation-agent runtime slot；workflow 线程映射到 `workflow:<workflowContextId>` 和 LangGraph `thread_id`。旧虚拟 JID `{workspaceJid}#agent:{agentId}` 仍是内部消息路由实现细节，不作为用户心智呈现。
- `im_entry_routes` 保存飞书 / 微信入口的默认工作区、当前活跃工作区和活跃线程。`registered_groups.target_main_jid` / `target_agent_id` 只作为迁移期同步字段，语义是“默认入口目标”，不是“一个 IM 私聊只能绑定一个会话”。
- Context Router 位于 Web / 飞书 / 微信输入之后、Agent / workflow 执行之前，负责把普通消息、回复、workflow 卡片按钮和高级命令解析为 `{ workspaceJid, threadId, runtimeAgentId }`。`/use` 改默认工作区，`/to` 做单次定向投递，`/where` 显示当前位置，`/threads` 列最近任务线程，`/back` 回到工作区主线。
- Workflow run 不应该为了隔离上下文而创建新工作区；它应挂在发起工作区下，使用独立 workflow context / runtime session 执行，并创建或关联 workflow 线程。结果可以回填到触发入口和对应线程，但 workflow state、checkpoint 和 role output 不污染工作区主线。
- Runner 只是一次正在执行的底层 CLI 进程，不是工作区、线程或 session 的长期身份。

## 边界

- `package root`、`launch cwd`、`~/.cli-claw` 数据目录是三条不同边界：前者负责资源定位，中者负责主工作区默认执行目录，后者负责平台持久化。
- 主进程拥有实例密码认证、会话、路由、持久化和 workflow 调度。
- Cli Claw 当前是单实例模型；登录实例密码后可访问实例内工作区，Web 只维护单实例访问配置。
- `groups/{folder}` 是工作区内容边界；`registered_groups` 是入口边界，多个入口共享同一 `folder` 时不代表多个独立项目。
- runner 拥有具体 CLI 会话、工具调用和流式事件生产。
- 记忆机制与上下文保留见 `docs/MEMORY.md`。
- 运行时矩阵、`agentType` 约束和外部运行时契约见 `docs/RUNTIME.md`。
