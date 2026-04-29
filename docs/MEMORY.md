# MEMORY

> 本文负责：Cli Claw 的消息数据库、runtime session 和上下文边界。工作区 / conversation 身份见 `docs/ARCHITECTURE.md`；运行时 session 与 host cwd 见 `docs/RUNTIME.md`。

## 心智模型

- Runtime 上下文由 Claude / Codex 自己维护。Cli Claw 只保存 runtime session id，并在需要时 reset / resume。
- 消息数据库 `~/.cli-claw/db/messages.db` 是产品侧展示、队列 cursor、恢复待处理消息和审计溯源的唯一历史记录。
- Cli Claw 不维护长期记忆层，不生成每日摘要，不归档 transcript，不暴露 `memory_*` 工具，也不把历史消息、摘要、文件或旧 partial body 注入 agent prompt。

## 读取与注入

- 常规对话只把当前待处理 turn 发送给 runner；更早内容依赖 runtime session 自己续用。
- 同一个 workspace 主对话的 Web / IM channel 共用同一份主 runtime session；channel 只决定消息来源和回复路由。
- 当前待处理 turn 可以包含连续同源且未提交 cursor 的 pending batch，例如 `A1/A2/B1/A3/B2/B3` 会切成 `A1+A2`、`B1`、`A3`、`B2+B3`；这不是历史上下文注入。`assistant_prompt` 是 skill command 改写出的独立任务边界，不会与前后的普通同源消息合并。
- 正在执行的 runtime query 不接收新的用户消息；新消息排队到下一轮，避免当前 turn 的流式输出、工具步骤或卡片状态污染下一条消息。runner query 结束并进入 idle 等待后，同来源下一轮才可通过 IPC 复用同一 runtime session。
- Skill slash command 生成的 `assistant_prompt` 会标记为独立来源，并使用隔离 runtime session 执行：不继承 workspace 主 session，完成后也不替换主 session。若历史版本已经把上一轮 skill final 的 session 写成主 session，下一条普通用户消息会忽略它并建立新的正常主 session。
- 服务重启恢复只用于已入库但尚未提交 cursor 的待处理用户消息；该路径恢复原 runtime session 并发送待处理消息，不拼接 DB 最近历史或 `<system_context>`。
- 优雅关停 / 自重启 / crash recovery 都不会把正在流式输出的 partial body 持久化成 assistant 正文、发送到 IM，或提交对应用户消息 cursor；启动恢复只清理 `streaming-buffer` / `active_streaming_turns` 临时态，确保未完成用户消息仍按 pending 路径重放。
- 如果新消息前方存在未消费的 `interrupt_partial` 残留，Cli Claw 不维护 pending resume 状态、不生成确认 prompt、不回放旧中断上下文；只把中断之后当前未提交的连续同源用户消息送入 runtime。
- 定时 agent 任务始终在独立任务 workspace/session 中运行；任务 prompt 不写回源工作区主对话。

## 增长与清理

- `messages.db` 没有按天自动清理；会随聊天增长。清除历史、删除工作区或删除 conversation agent 会删除对应消息；SQLite 文件体积需要 `VACUUM` 才会真正回收。
- Runtime transcript 不统一落在 `~/.cli-claw/sessions`：Claude 使用 `~/.cli-claw/sessions/{folder}/.claude/`，Codex 使用自己的 `~/.codex/sessions/**/*.jsonl`。Cli Claw 的 `sessions` 表只保存当前 session id。
- `/clear` 或 reset session 只清 runtime 上下文，不删除聊天历史；主对话 reset 会清该 workspace 的主会话 slot，但保留 conversation agent 自己的 session；clear-history 会清聊天历史、session 和该工作区运行时 artifacts。

## 边界

- `.claude/`、`~/.codex/` 下的 settings / skills / config / native sessions 是外部 runtime 状态，不是 Cli Claw 维护的历史上下文。
- `.agents/*.md` 是仓库执行协议角色定义，`~/.agents/agents/*.md` 是用户级 Agent 定义；二者都不是 Cli Claw 消息历史注入来源。
- 任何新增“读取历史并拼入 prompt / 工具描述 / 隐藏任务 / 可见正文”的能力，都必须先更新本文和对应 owner 文档，并补真实消息链路回归测试。
