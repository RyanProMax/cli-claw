# MEMORY

> 本文负责：Cli Claw 的记忆层级、触发时机、存储路径、读取方式和增长边界。工作区 / conversation 身份见 `docs/ARCHITECTURE.md`；运行时 session 与 host cwd 见 `docs/RUNTIME.md`。

## 心智模型

Cli Claw 里有三类容易混淆的数据：

- Runtime 上下文：Claude / Codex 自己的会话上下文。Cli Claw 只保存 runtime session id，并能重置或续用它；具体 transcript 由底层 runtime 维护。
- 聊天历史：Web / IM 消息存入 `~/.cli-claw/db/messages.db`，用于产品侧展示、恢复和摘要，不等同于长期记忆。
- 长期记忆：落盘的 `AGENTS.md`、日期记忆、每日摘要和对话归档，供 agent 主动查询或在系统提示中注入。

## 长期记忆布局

- 用户全局记忆：`~/.cli-claw/groups/user-global/{userId}/AGENTS.md`
  保存跨工作区仍有用的信息，例如用户身份、长期偏好、常用项目和用户明确要求“记住”的内容。
- 工作区记忆：`~/.cli-claw/groups/{folder}/AGENTS.md`
  保存该工作区自己的背景、约定和长期项目上下文。
- 日期记忆：`~/.cli-claw/memory/{folder}/YYYY-MM-DD.md`
  由 `memory_append` 追加当天/短期信息，例如进展、临时决策、待办和会议要点；它不是当天完整聊天记录，也不是 SQLite。
- 每日摘要：`~/.cli-claw/groups/user-global/{userId}/daily-summary/YYYY-MM-DD.md` 与 `HEARTBEAT.md`
  scheduler 在本地时间 2:00-3:00 之间基于昨日消息生成摘要，并把最近几天压缩进 `HEARTBEAT.md` 供主工作区参考。
- 对话归档：`~/.cli-claw/groups/{folder}/conversations/`
  Claude runner 在 PreCompact hook 触发上下文压缩前，把完整 transcript 归档为 markdown；当前 Codex 路径没有同等的 Cli Claw `conversations/` 归档。

## 写入触发

- 主工作区 agent 获知长期有用信息时，应立即更新用户全局 `AGENTS.md`；只对当天/短期有用的信息写入日期记忆。
- 非主工作区应把项目长期信息写入当前工作区 `AGENTS.md`；用户全局记忆作为只读参考。
- Claude 上下文压缩前会自动归档 transcript、裁剪 Claude session JSONL，并触发一次 memory flush，让 agent 把值得保留的信息写入长期记忆。
- Web/API 的 memory 页面可以手动读写允许范围内的记忆文件；`HEARTBEAT.md` 和 `conversations/` 归档只读。

## 读取与注入

- 主工作区会把用户全局 `AGENTS.md` 和截断后的 `HEARTBEAT.md` 注入系统提示。
- 其他工作区可通过 `memory_search` / `memory_get` 查找全局、工作区、日期记忆和对话归档。
- 常规对话只把当前待处理 turn 发送给 runner；更早内容依赖 runtime session 自己续用。同一个 workspace 主对话的 Web / IM channel 共用同一份主 runtime session，channel 只决定消息来源和回复路由。
- Skill slash command 生成的 `assistant_prompt` 不是常规续聊：入库时标记为 `assistant_prompt`，执行前会清理当前 workspace 主 runtime session，避免 `/hkipo` 等命令任务继承旧 runtime transcript。
- 服务重启恢复只用于已入库但尚未提交 cursor 的待处理用户消息；该路径恢复原 runtime session 并发送待处理消息，不再把数据库最近历史拼成 `<system_context>` 注入 prompt。
- restart recovery 只能服务于“已入库但尚未提交 cursor 的待处理用户消息”；`scheduled_task_prompt`、`user_command`、assistant、system 等内部行不能触发恢复 prompt 或被回放成用户输入。
- 如果新消息前方存在未消费的 `interrupt_partial` 残留，Cli Claw 会先挂起旧任务快照并询问用户是否继续上次任务；只有用户明确回复继续时才会把旧中断上下文送入 runner，回复忽略或发送新需求时只处理新消息。

## 增长与清理

- `messages.db` 没有按天自动清理；会随聊天增长。清除历史、删除工作区或删除 conversation agent 会删除对应消息；SQLite 文件体积需要 `VACUUM` 才会真正回收。
- Runtime transcript 不统一落在 `~/.cli-claw/sessions`：Claude 使用 `~/.cli-claw/sessions/{folder}/.claude/`，Codex 使用自己的 `~/.codex/sessions/**/*.jsonl`。Cli Claw 的 `sessions` 表只保存当前 session id。
- 日期记忆按追加写入，单次 append 有大小上限，单个记忆文件约 500KB 上限；搜索会跳过过大的记忆文件。
- `/clear` 或 reset session 只清 runtime 上下文，不删除聊天历史或长期记忆；主对话 reset 会清该 workspace 的主会话 slot，但保留 conversation agent 自己的 session；clear-history 会清聊天历史、session 和该工作区运行时 artifacts。

## 边界

- `.claude/`、`~/.codex/` 下的 settings / skills / config / native sessions 是外部 runtime 状态，不是 Cli Claw 项目长期记忆。
- `.agents/*.md` 是仓库执行协议角色定义，`~/.agents/agents/*.md` 是用户级 Agent 定义；二者都不是用户或工作区记忆。
- 修改记忆布局、写入触发、查询范围或保留策略时，必须同步更新本文、`AGENTS.md` 和相关 owner 文档。
