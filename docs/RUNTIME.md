# RUNTIME

> 本文负责：运行时矩阵、`agentType` 约束、runtime identity、workspace cwd 和外部运行时契约。工作区 / conversation 身份见 `docs/ARCHITECTURE.md`；记忆机制见 `docs/MEMORY.md`。

## 概览

Cli Claw 不把某一个 SDK 写死在主进程里。主进程负责多用户隔离、消息路由、队列和持久化；真正的 Agent 会话由本地 Agent 进程执行。当前物理包路径仍是 `container/agent-runner/`，但它只是 runner package 路径，不代表另一条执行边界。

服务进程本身由外部 launcher `cli-claw start` 启动；源码仓库与同名 `cli-claw` 发布包复用同一个 launcher 入口，负责参数分发，backend bootstrap 在 `src/index.ts` 中单独导出。源码仓库的 `bun start` / `npm start` 会委托到 `bun src/cli.ts start`，因此仍属于 launcher 入口；`bun src/index.ts` 只用于 direct backend 调试。

## 服务自检与 Shadow Start

`/self-status`、`/self-check` 和 `/self-restart` 用于通过正在运行的 Cli Claw 检查仓库自身迭代风险：

- `/self-status` 输出当前 backend PID、启动时间、cwd、已加载 build 与磁盘 build 是否一致，以及最近一次 `/self-check` 结果。若当前 backend 由 TypeScript source launcher 启动，build 摘要会明确标注源码运行，dist build 只作为打包参考；agent-runner build stale 仍会保留为需要处理的运行风险。
- `/self-status` 还会输出当前进程解析出的 self-restart launch spec：是否可安全自重启、launch source，以及 watchdog/launchd 将复用的精确启动命令。
- `/self-check` 复用 backend 启动时捕获的 authoritative launch spec 启动候选 backend，并用临时 `WEB_PORT` 轮询候选服务的 `/api/health`；结果会展示实际候选命令，便于确认自检目标与当前服务启动入口一致。
- 候选进程会使用隔离 `HOME`，因此数据目录落在临时 `~/.cli-claw`，不会写入生产 `~/.cli-claw`。
- 候选进程会带上 `CLI_CLAW_SELF_CHECK=1`；backend 在该模式下启动 Web/API、DB 和队列基础能力，但跳过 CLI launch cwd 校验、workspace 默认 cwd 物化和 IM channel 连接，避免临时 HOME 的 allowlist 影响自检，也避免和线上飞书/微信/Telegram/QQ/钉钉连接抢占。
- `/self-check` 只验证“当前 build 能否冷启动并健康”，不会停止当前服务，也不会切换端口或执行真实重启。
- `/self-restart` 不在 backend 进程内重启自身；它写入 `~/.cli-claw/ops/restarts/*.json` intent，并启动独立 watchdog 进程。watchdog 先执行 shadow self-check；失败时不停止当前服务；通过后才停止旧 PID、按同一启动命令启动新进程，并轮询生产端口 `/api/health`。
- `/self-restart` 使用一份在 backend 启动时捕获并校验过的 authoritative launch spec；若当前进程无法解析出安全的启动命令（例如 argv 缺失 entrypoint、只剩 `bun` 空参数、或明显不是 Cli Claw 入口），命令会直接拒绝受理，而不是写出一个注定重启失败的 intent。
- backend 启动时还会把当前 PID、端口、validated launch spec，以及可选的 `launchd` service name 持久化到 `~/.cli-claw/ops/current-backend.json`；外部 `cli-claw restart` 会复用这份状态发起同一条 safe self-restart，而不是从调用方自己的 argv 反推启动命令。
- 成功的 `/self-restart` intent 会记录发起它的 IM 会话；新进程启动并重新连上 IM 后，会向该会话补发一条“自重启成功”消息，附带当前服务状态与一次 best-effort 残留进程检查结果。
- 若重启期间还有未完成的 direct IM 消息需要恢复处理，恢复回合仍优先使用 Feishu streaming card 承载终态；只有没有 streaming card 成功完成时，才允许补发静态 IM 兜底，避免终态只落库/Web，同时避免同一回复重复发送。
- 若残留检查发现真正的孤儿 runner（`agent-runner` 链条已脱离 backend，表现为 `ppid = 1` 或父 PID 不存在），新进程会 best-effort 发送 `SIGTERM` 清理；正常挂在当前 backend 下的 runner 链不会被触碰。
- 若当前服务由 repo 提供的 LaunchAgent 启动，并带有 `CLI_CLAW_LAUNCHD_SERVICE_NAME`，watchdog 在 preflight 通过后不会再手工 `spawn` 一个脱离 supervisor 的 replacement，而是执行 `launchctl kickstart -k <service>`，让 `launchd` 保持拥有者身份并继续负责后续兜底重拉。

`/self-restart` 不是 blue-green 或 rollback 机制。它能避免“preflight 失败还杀旧进程”的 badcase，但不能保证源码/二进制级回滚；更强的生产发布仍应使用 release 目录、symlink 或系统级 supervisor。

对于本机长期运行，推荐再叠一层用户级 supervisor：仓库提供 `ops/install-launch-agent.sh` 来安装/查看/卸载一个 `launchd` LaunchAgent。该 LaunchAgent 默认使用 `cli-claw start`，也可以通过 `-- COMMAND [ARGS...]` 显式复用 `/self-status` 暴露的 validated launch command；不要另起一套不同的启动脚本。安装脚本会把当前 shell 的 PATH 连同常见 Homebrew / Bun bin 目录一起写入 plist，避免 launchd 默认 PATH 丢失 `node` / `npx` 这类本机 runtime 依赖，同时注入 `CLI_CLAW_LAUNCHD_SERVICE_NAME` 供 watchdog 在自重启时回到 `launchd` 管理。

## 运行时矩阵

| `agentType` | 底层运行时        | 执行路径        | 当前认证方式                      | 备注                                                                             |
| ----------- | ----------------- | --------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `openai`    | OpenAI Agents SDK | 本地 Agent 进程 | Codex CLI 登录态（`codex login`） | backend 通过 Codex app-server 解析 token，runner 使用隔离文件 session 保存上下文 |

## 配置规则

- 工作区的 `agentType` 固定为 `openai`，用于标识当前唯一的底层 CLI runtime。
- 所有工作区都通过同一条本地 Agent 进程链路执行；Web 只保留 `/openai` 模型、推理强度和速度配置入口。
- 工作区 Codex/OpenAI 配置统一包括：
  - `agentType`
  - `model`
  - `reasoningEffort`
  - `speedTier`
- admin 主工作区默认使用 `cli-claw start` 的启动目录作为 `customCwd`；其他工作区默认使用 `~/.cli-claw/groups/{folder}`，除非 admin 设置 `customCwd`。
- `cli-claw start` 会先校验启动目录是否满足 workspace allowlist，再把该目录物化到缺失 `customCwd` 的 admin 主工作区。

## 缓存目录与清理

Cli Claw 的可重建下载物统一落在 `~/.cli-claw/cache/<namespace>`。这个目录只用于缓存、临时下载、可重新从来源拉取的网页/PDF/附件副本；不得把数据库、workflow checkpoint、runtime session、用户上传的唯一文件或不可重建状态放进 cache。

缓存 namespace 只能使用字母、数字、`.`、`_`、`-`，不允许路径分隔符或 `..`。代码应通过 `src/core/cache.ts` 的 helper 解析目录，避免各模块自己拼路径。

服务启动时会启动统一 cache cleanup loop，并立即清理一次；之后按 `CLI_CLAW_CACHE_CLEANUP_INTERVAL_MS` 定时清理。默认策略：

- cache root：`~/.cli-claw/cache`，可用 `CLI_CLAW_CACHE_DIR` 覆盖。
- TTL：7 天，可用 `CLI_CLAW_CACHE_TTL_MS` 覆盖。
- 最大容量：2GB，可用 `CLI_CLAW_CACHE_MAX_BYTES` 覆盖。
- 清理顺序：先删除超过 TTL 的文件，再按 mtime 从旧到新删除，直到总大小低于容量上限；最后移除空目录。

为避免误删，cleanup root 本身也有安全约束：不能是文件系统根目录，路径中必须有一级目录名包含 `cache` / `Caches`。若需要自定义路径，使用类似 `/var/lib/cli-claw/cache`、`~/Library/Caches/cli-claw` 或 `/tmp/cli-claw-cache` 的目录名。workflow / local task 的审计 artifact 只能保存 URL、hash、source time、短 evidence snippet 和结构化字段；不能依赖 cache 文件永久存在，也不能把大文件正文塞进 workflow state。后续 HKEX PDF、网页快照等下载解析应优先使用该 cache 机制；不可复用的单次中间文件使用 `withCacheTempDir`，让任务结束或异常时立即清理临时目录。

## 工作区级模型配置优先级

模型和推理参数按以下顺序生效：

1. 工作区显式设置的 `model` / `reasoningEffort` / `speedTier`
2. 对 `openai` 而言，backend 会显式读取与 runner 相同的进程级 fallback：
   - `OPENAI_MODEL`
   - `OPENAI_REASONING_EFFORT` / `REASONING_EFFORT`
   - `OPENAI_SERVICE_TIER` / `SERVICE_TIER`
3. runtime 默认配置
4. CLI / provider 自身默认值

约束：

- `openai` 的 `model` 使用内置 preset，并允许把当前 effective model 作为当前值展示，避免状态摘要、配置卡和 dispatch fallback 互相矛盾。
- `/openai` 配置卡和命令回复会把 effective runtime identity 中的当前模型一起传入选项构造。
- backend 会先把上述优先级物化成一份 effective runtime identity；`/status`、`/openai` 配置卡、runner dispatch 和 footer fallback 都必须读取这同一份结果。
- `reasoningEffort` 只有支持该能力的 runtime 才会真正下发。
- 不支持 `reasoningEffort` 的 runtime 会忽略该字段，但 `model` 仍可独立生效。
- `speedTier` 只有 `openai` 支持；对 Codex CLI 登录态，`fast` 会向 OpenAI provider data 下发 Codex 后端实际接受的 `service_tier="priority"`，`standard` 表示不下发 service-tier 覆盖。
- 非主工作区若继承同 folder 的 home workspace runtime，则会沿用该 home workspace 的 `agentType` / `model` / `reasoningEffort` / `speedTier`。

## 工作区目录解析

执行、文件 API、脚本任务和 agent 任务统一使用同一份 effective cwd contract：

1. 工作区自身显式设置的 `customCwd`
2. 同 folder 的 sibling home workspace 的 `customCwd`
3. 不再依赖隐式内存 fallback；缺失值应在 `cli-claw start` 阶段被物化

该 cwd 必须是绝对路径、已存在目录，并在配置了 mount allowlist 时落在允许根目录内。

这个 contract 会被本地 Agent 进程、文件 API、脚本任务和 agent 任务共同使用。

`customCwd` 只影响执行目录和文件访问根目录，不改变工作区 ownership，也不改变数据库或 session 在 `~/.cli-claw` 下按 `folder` 归属的持久化位置。

## 运行时身份

每次助手回复都尽量携带一份 `runtime_identity`：

- `agentType`
- `model`
- `reasoningEffort`
- `speedTier`
- `supportsReasoningEffort`

这份元数据会沿着 runner -> backend -> DB / WebSocket -> Web / IM 卡片 一路透传，用于：

- Web 消息 footer
- 飞书卡片 footer
- usage 晚到后的 footer 补写 / patch
- run log / dispatch log 排障
- 区分“请求的运行时”和“实际执行的运行时”

backend 在启动 runner 前会把 effective runtime identity 中的 `model`、`reasoningEffort` 与 `speedTier` 写入 runner input。对 OpenAI，这份 effective identity 会显式纳入 `OPENAI_*` / `SERVICE_TIER` 环境变量 fallback；这样 workspace 未显式设置时，`/status`、选择卡、dispatch 和 footer fallback 仍会保持一套值。若 runner 返回了实际 `runtime_identity`，仍以 runner 返回值为最终记录。

## 会话与 Runner 对应关系

外层 channel、workspace conversation、底层 runtime session 和 runner 不是同一个概念：

- 外层 channel 是消息入口，例如飞书或微信。
- Workspace conversation 是 Cli Claw 的对话身份，由 `folder` 加可选 `agentId` 决定。
- Runtime session 是 Codex / OpenAI 自己的会话 ID，持久化在 `sessions` 表。主对话所有 channel 共用 `(folder, 空 agent_id)`；conversation agent 使用 `(folder, agent_id)`。
- Runner 是正在处理消息的底层 CLI 进程，只在执行期间存在，并可能在 idle timeout 后退出。

对应关系：

- 同一个 workspace 主对话共用同一份 runtime session：Web、飞书、微信等 channel 只决定消息来源和回复路由，不决定记忆边界。连续同来源 pending 普通消息会合并成一轮；遇到不同来源或 `assistant_prompt` 任务边界即切到下一轮，按入库顺序继续处理，不跨来源重排。例如 `A1/A2/B1/A3/B2/B3` 必须切成 `A1+A2`、`B1`、`A3`、`B2+B3` 四轮。
- Skill slash command 如果返回 `assistant_prompt`，该消息会标记为 `source_kind='assistant_prompt'`，并用隔离 runtime session 作为新 turn 发送给底层 runtime；它不读取 workspace 主 runtime session，完成后也不写回主 session，避免命令生成的研究任务污染后续普通对话。若历史版本已经把上一轮 skill final 的 session 写成主 session，下一条普通用户消息必须忽略它并建立新的正常主 session。
- Skill slash command 如果返回 `workflow`，不会改写成用户消息，也不会进入主 runtime session；宿主会用返回的 `workflowId`、`prompt` 和结构化 `input` 创建独立 workflow run。run 创建成功后，触发会话先收到启动回执；后台 graph 完成、失败或 runner 超时后，触发会话再收到终态消息。`/hkipo [--all]` 当前走这条路径。
- 同一个 workspace 下的每个 conversation agent 都有独立 runtime session，不与主对话共享 Codex / OpenAI 对话上下文。
- Runner 按 serialization key 串行化：主对话以 `folder` 为 key，conversation agent 以 `folder + agentId` 为 key，任务运行以 `folder + taskId` 为 key。runtime query 正在执行时不消费新的用户 IPC 消息；新消息只会排队并触发 drain。只有当前 query 已结束、runner 处于等待下一条消息的 idle 阶段时，才允许同来源消息通过 IPC 复用同一 runtime session。不同来源消息始终排队并触发 drain，让当前 turn 完成后按顺序处理。
- Runner 可以用 runtime session id 恢复底层会话，但恢复过程是 runner 内部动作。恢复期间产生的历史 session 片段或旧工具步骤不得进入 runner stdout；stdout 只发布当前 prompt live 期间产生的事件和最终结果。
- 用户可见最终回复经过 `reply-visibility` 输出边界；该边界会把 OpenAI commentary 和可识别的内部包装从主正文剥离，避免 runtime session 细节直接发给用户。
- 最终发送路径不使用 streaming presentation 的 `answerText` 作为正文来源；可见正文只来自当前 turn 的 runtime raw/final output。`answerText` 只允许作为 Web/调试展示的过渡 buffer，不得覆盖新 turn 的最终回复。中断、overflow、compact、crash recovery 的 partial body 不会作为 IM 正文发送或持久化，也不能推进 committed cursor。
- OpenAI runtime 错误必须在 runner 边界格式化为稳定提示；API key、quota/rate limit、context window、invalid model 等诊断不得以低层异常原样进入飞书/Web 正文。
- 一个 workspace 不是永久对应一个 runner；workspace 可以没有活跃 runner，也可以因为主对话、conversation agent 或任务同时存在多个 runner。

### Feishu Streaming Card Presentation

飞书卡片是 runtime 输出的展示层，不是 runtime session 或记忆边界。稳定契约如下：

- 正常 Agent 回复优先使用 streaming card；静态 card / post+md 仍保留为 Feishu API 失败、非流式命令回复和格式限制场景的兜底，不能移除。
- Streaming card 将 tool `steps`、单一 `Thinking` 辅助区和主正文分区渲染。主正文只承载 answer；OpenAI 的 `text_delta` 只有在带有明确 `assistantMessagePhase="final_answer"` 时才进入当前流式正文候选，终态仍以 terminal raw/final output 经过可见性分类后的结果为准。
- `thinking` 必须和 tool `steps` 一样使用原生折叠面板展示；即使 runtime 只发出空 `thinking_delta`，也不能退化成顶部普通 markdown 行混入状态/正文区域。
- 同来源新用户输入开始时会重置当前卡片展示态；`turnId` 变化或 `messageCursor.id` 变化也会清空上轮 presentation buffer、thinking 和中断状态，避免旧工具 steps 出现在新消息卡片上。
- 主进程会丢弃 `messageCursor.id` 不属于当前待处理用户消息的 stale stream events；这是路由保护，不是上下文或 replay 判断。历史执行事件必须在 runner 源头消失，不能依赖飞书卡片层过滤。
- 启动恢复遇到 `~/.cli-claw/streaming-buffer` 或 `active_streaming_turns` 里的中断卡片态时，只清理这些临时态；不恢复旧卡片正文、不生成 `interrupt_partial` assistant 消息、不提交该 turn 游标。
- OpenAI Responses 输出的正式 `phase` 字段必须保留到渲染层：`phase: "commentary"` 进入 `commentaryText` / `Thinking`，`phase: "final_answer"` 进入当前 `answerText` / Web `partialText`。`StreamEvent.assistantMessagePhase` 只是 Cli Claw 在统一流式协议里的传输别名，取值只允许 `commentary` 或 `final_answer`，不得新增值、重命名语义、按中英文前缀推断或在 Feishu/Web 层二次加工。
- OpenAI runner 必须从 Responses `response.output_item.added` / `response.output_item.done` 中记录 assistant message `item.id` 与 `phase`，再把后续 `response.output_text.delta` 映射为带 `messageUuid` 与 `assistantMessagePhase` 的 `text_delta`。如果某个 OpenAI `text_delta` 缺失 phase，Feishu/Web 不累计也不展示它，只等待 terminal raw/final output；这是 replay 防护，避免历史 presentation 文本污染当前卡片。
- Feishu/Web 渲染层必须把 `thinkingText` 与 `commentaryText` 合并为同一个 `Thinking` 辅助区，不再渲染单独“过程”折叠栏。terminal raw/final output 仍经过可见性边界：若 raw/final 与 streaming `commentaryText` 完全相同，完成态保留到 `Thinking`，正文为空；若 raw/final 含强结构化最终正文边界（例如 `**/research｜...**` 或 `**港股 IPO 池｜...**`），允许作为兼容兜底把标题前内容剥离到 `Thinking`，并从该标题开始发送正文。
- 后续可优化方向必须保持同一语义边界：优先使用 OpenAI Responses 原生 `phase` 与 `item.id`；禁止让 Feishu/Web 直接读取底层 session 文件、把 `assistantMessagePhase` 当成新分类体系扩展、或恢复任何文本前缀/关键词分类。
- Feishu card 必须把 tool `steps` 作为顶部第一个执行轨迹面板展示，标题使用 `🧰 ... steps` 和 `💭 Thinking` 对齐；`Thinking` 紧随其后，再渲染 status/hook/todo 和最终正文；完成态也不能把 steps 折叠栏移到正文底部。OpenAI commentary/process 文本进入 `Thinking`，长中文过程按句子边界拆行，避免堆成一整段。若 OpenAI terminal final 把过程句粘在 `**/research｜...**`、`**港股 IPO 池｜...**` 等报告标题前，`reply-visibility` 必须把这段剥离出正文，并同步进顶部 `Thinking` 区域。
- Feishu Markdown 不保证保留普通单换行；紧凑报告（如 `/hkipo`）必须在 Schema 2 卡片 builder 中分拆为多个原生 `markdown` elements，保持与正常飞书 interactive card 相同的发送路径。不要在通用 Markdown optimizer 里注入报告私有 `<br>` 或另开“安全版/降级版”格式。
- OpenAI final visibility resolution 必须保留结构化日志，至少记录 raw final、streaming presentation answer/commentary、最终 visible text、剥离出的 commentary、`sourceKind`、`finalizationReason`、`turnId` / `sessionId` / `sdkMessageUuid` 和 runtime identity，便于追踪正文与过程文本边界。
- Streaming / 完成态 card 保留当前 turn 的完整 tool steps，便于回看执行过程；临时状态、hook 和 system status 在终态收敛。
- Footer 必须展示 runtime identity 和当前处理耗时；耗时按当前 streaming turn 计算，而不是按长运行 handler、runtime session 或 SDK 累计 usage 计算。同来源新用户输入、`turnId` 变化、`messageCursor.id` 变化，或完成态清理后首次绑定下一轮 `turnId` / `messageCursor.id` 时，presentation buffer、thinking、中断状态和 footer 计时起点必须一起重置。耗时使用紧凑格式并省略为 0 的小时/分钟单位，例如 `36s`、`1min12s`、`1h23min12s`，且不显示小数秒。usage 晚到时可以补丁更新 footer，但不能改写主正文来源。

当前限制：

- `sessions` 表的主键维度仍是 `(folder, agentId)`；主会话使用空 `agent_id`，不再为 IM 主对话创建或保留 `im:<sourceJid>` runtime slot。它不是 `(folder, agentId, agentType)`。
- 切换 `agentType`、`model`、`reasoningEffort` 或 `speedTier` 时，服务会停止活跃 runner 并清理该 workspace 的 runtime session，避免把旧 runtime 的 transcript 当成新 runtime 继续使用。
- 因此，主对话切换 `agentType` 后不保证恢复切换前的 OpenAI session。若要支持 per-runtime 恢复，需要把 session 持久化改成按 runtime 分槽存储，并调整 `/clear`、runtime reset、agent 会话和迁移逻辑。

## 外部运行时契约

Cli Claw 不维护项目内部长期记忆；外部 CLI runtime 仍保留各自原生状态：

- `~/.codex/auth.json`
  - OpenAI Runtime 的 Codex CLI 登录态来源；backend 优先通过 `codex app-server` 获取/刷新 access token，仅在 app-server 不可用且 access token 仍有效时读取该文件兜底
- `CLI_CLAW_CODEX_ACCESS_TOKEN`
  - backend 注入给 OpenAI runner 的短期运行时凭据，不需要用户手工配置
- `CLI_CLAW_RUNTIME_SESSION_DIR/openai-agent/*.json`
  - OpenAI Agents 的文件 session；未设置 `CLI_CLAW_RUNTIME_SESSION_DIR` 时 runner 使用工作区内的 `.cli-claw-runtime/openai-agent`

仓库内还可以追踪与 agent 工作流相关的配置文件：

- `.agents/workflows/*.json`：workflow/crew graph 配置，是工作流定义的 source of truth。工作区配置优先；工作区缺失时可以使用 Cli Claw 包内同路径的内置 workflow。
- `.agents/agent-roles/*.md`：runtime role card，会由 backend 解析后显式注入 workflow runner。工作区 role card 优先；内置 workflow 可以配套内置 role card。
- `.agents/roles/*.md`：仓库协作/subagent 角色，只用于 Codex 协作协议，不注入 runtime。
- `.agents/skills/**/SKILL.md`：仓库内联 skill 定义。

这些文件属于仓库执行协议，不等同于外部 runtime 的用户级配置。workflow context 使用内部生成的 thread id / workflow context id；用户会话只触发 workflow run 并接收启动回执与终态消息，不提供 thread id，也不共享 workflow 内部 runtime session。

LangGraph checkpoint 使用独立 SQLite 文件 `~/.cli-claw/db/workflow-checkpoints.sqlite`，以内部 `thread_id` 作为恢复维度；workflow run/step 审计仍写入主 `messages.db` 的 `workflow_runs` / `workflow_run_steps` 表。checkpoint SQLite 通过仓库内 `sqlite-compat` 兼容层访问：Bun 服务使用 `bun:sqlite`，Node.js 工具路径使用 `better-sqlite3`；不要在 workflow runtime 路径直接引入依赖 `better-sqlite3` 的第三方 SQLite saver。

Workflow role card 的 `allowedTools` 是运行时硬边界：backend 会把 role metadata 显式传入 OpenAI runner，runner tool factory 以 `role.allowedTools` 优先过滤实际可用工具。它不是只写进 prompt 的软提示。workflow role node 以 single-turn 模式运行：角色输出由 workflow engine 捕获为节点结果，不继续等待 IPC 下一轮；除非某个 workflow 明确需要中途发用户消息，否则 role card 不应开放 `send_message`，避免中间 artifact 直接泄漏到触发会话。

Workflow role node 遇到 OpenAI/undici transient socket 异常时，不应把底层长堆栈直接作为用户唯一结果。`hkipo` workflow 的单个 role node 使用 180s 有界 runtime 预算，并对 `UND_ERR_SOCKET`、`ECONNRESET`、`ETIMEDOUT` 等可识别网络瞬断做有界重试；重试后仍失败或单节点超时时，非最终 role node 会写入 `status=degraded` 的结构化 artifact 并继续执行，最终报告节点会基于已完成的本地采集 artifact 生成降级报告。鉴权、额度、schema、prompt 或非 transient runtime 错误仍按失败处理，不能被静默吞掉。

`hkipo` 的最终角色输出在发送到触发会话前会经过命令层轻量归一化，只处理展示格式，不改 workflow state：旧英文来源名会统一成“致富证券 IPO”，旧版“孖展多源未取到”会改写为“融资/孖展倍数暂无多源核验”，旧版内部短码如“卡：热17 结构8 ...”会改写为独立 `🧮 评分` 行。审计表 `workflow_runs.result` 和 step output 仍保留原始角色输出，便于排查 role prompt 是否退化。

Workflow graph 支持 `local_task` 节点，但它不是 shell passthrough。workflow JSON 只能声明已注册的 `taskId`；当前内置只读 task 包括 `stock.hkipo.fetch_pool`、`stock.hkipo.scan_heat`、`stock.hkipo.fetch_official_docs`、`stock.hkipo.run_backtest`、`stock.strategy.collect_results`、`stock.strategy.analyze_value` 和 `stock.strategy.discovery_cycle`。local task 输出会作为 structured artifacts 写入 LangGraph state，并随 step output 审计；设置了 `outputArtifact` 的 role node 也会把角色产物写入 artifact，后续节点通过 `[Structured Artifacts]` 读取结构化数据或上游角色结论。`stock.hkipo.fetch_pool` 是 workflow 的硬前置，Futu/OpenD 不可用时应失败；`stock.hkipo.scan_heat` 是补充证据节点，公开网页采集脚本失败或超时时返回 `status=degraded` 的 artifact，后续角色继续核验并在最终报告中明确“热度未达当日核验门槛”。该 artifact 不只包含 `evidence` 热度证据，还包含 `structure_evidence`（绿鞋、基石、保荐、回拨/公开发售比例等）、`valuation_evidence`（核心业务/能力、行业、同类 PE/PS/PB、发行市值、合理区间等）以及 source-level errors；不要把招股书或网页全文写入 workflow state。`stock.hkipo.scan_heat` 对公开券商 live snapshot（如致富证券新股详情页）可在招股窗口覆盖报告日时写入 `updated_at=<report_date>` / `source_time_mode=active_subscription_window`，并解析认购倍数、保荐、主营、发行市值和 PE；也会从 TradeSmart IPO Tracker 的公开孖展脉搏解析 `margin_multiple` 和 `margin_amount_hkd_yi`，并保留上游 AiPO 来源和观测时间。`margin_multiple` 与 `subscription_multiple` 必须分开展示；若没有同日孖展或认购 evidence，artifact 必须写 `subscription_heat.score=0`、`score_status=not_scorable`，报告角色不得输出“热5”这类主观补分。

scheduled task 支持 `execution_type='workflow'`：`script_command` 存 workflow id，`prompt` 存 workflow prompt，scheduler 到期后复用 `/workflow <id> <prompt>` 同一条 workflow command 路径。scheduled workflow 不创建独立 task workspace，也不把 prompt 注入源工作区主会话；它只创建 workflow run/context、执行 local task / role node，并把终态消息回投到 scheduled task 的目标会话。

scheduled agent / scheduled workflow 在启动任何 Agent runtime 前会读取 OpenAI Codex usage snapshot。若 5h primary window 或 7d secondary window 剩余额低于 `CLI_CLAW_SCHEDULED_AGENT_USAGE_MIN_REMAINING_PCT`（默认 30），scheduler 不启动 Agent，写 task run log 和 `last_result`，并把 `next_run` 延后到低额度 bucket 的 reset time；若 usage 不可读，则按 `CLI_CLAW_SCHEDULED_AGENT_USAGE_UNAVAILABLE_RETRY_MS`（默认 30 分钟）保守延后。script task 不受该 guard 影响，除非后续显式升级为 workflow / agent task。

股票策略自迭代采用阶段化调度，而不是一个固定 6 小时循环。`stock-strategy-discovery-loop` 是探索期 workflow，默认 30 分钟一次：`stock.strategy.collect_results` 只读 stock-analysis-api task-chain SQLite，`stock.strategy.discovery_cycle` 默认扫描 `cn/hk/us`，调用 stock-analysis-api `alpha_scan.py` 和 `alpha_research_loop.py`，输出 summary-only 的候选、评估、回测与阻断原因；任一市场或底层 CLI 失败时返回 degraded 子 artifact，后续角色继续审阅数据缺口。`stock-strategy-loop` 是成熟/候选复盘 workflow，默认 6 小时一次：`stock.strategy.analyze_value` 生成 paper/live ledger 摘要与 HK/US alpha daily report / backtest summary。两类 workflow 都不能伪造实盘收益或策略价值；discovery 默认不写 registry，显式 `recordToRegistry=true` 也只允许记录候选/评估/proposal，不允许 approve / activate。

`stock.hkipo.fetch_official_docs` 会调用 stock-analysis-api 内部只读 CLI `scripts/hkipo_official_docs.py`，先尝试 HKEX 标题检索，再回退解析 HKEX “新上市资料” Main Board / GEM 表格，把招股章程、配发结果、定价公告、稳定价格公告等文件下载到共享 cache namespace `hkipo-official-docs`，解析正文后只输出文件元数据、hash、短 snippet、结构化 `structure_evidence` / `valuation_evidence` 和 `source_errors`。IPO pool JSON 等一次性输入使用 `withCacheTempDir`，任务结束或失败时立即清理；可重建官方文件缓存由统一 cache cleanup loop 按 TTL / 容量清理。

应用包根目录从已安装模块位置解析；launch cwd 只参与 workspace 默认执行目录的物化，不参与后端 build、web build 或 shared 资源定位。

## 运行时变更约束

- 新增或修改运行时时，必须同步更新相关 owner 文档，尤其是 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/MEMORY.md`、`docs/MODULE.md` 和本文档。
- 不要把某个运行时的专属约定误写成系统级通用规则。
