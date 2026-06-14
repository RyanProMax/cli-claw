# COMMAND

> 本文负责：统一命令注册表的行为、入口差异，以及命令与 runtime 的关系。工作流协议和工程规则见 `AGENTS.md` 与 `docs/ENGINEERING.md`。

## 概览

Agent Fabric 的“命令”分成两层：

- 服务 launcher 命令：仓库自带或同名 `agent-fabric` 发布包提供的 `agent-fabric ...`
- 应用内命令：服务启动后，在 Web / IM 里输入 slash command

统一命令注册表只覆盖第二层应用内命令；`agent-fabric start` / `help` / `version` 不走 runtime command registry。

## 服务 Launcher 命令

以下命令由 `agent-fabric` launcher 二进制直接处理：

| 命令               | 别名                                 | 作用                                                                                           |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `agent-fabric start`   | -                                    | 启动主服务，并把当前 shell 目录作为主工作区默认执行目录                                        |
| `agent-fabric restart` | -                                    | 读取当前服务保存的 restart 状态并请求一次安全自重启；适合从外部 shell 或 Web operator 环境触发 |
| `agent-fabric help`    | `agent-fabric -h` / `agent-fabric --help`    | 查看 launcher 帮助                                                                             |
| `agent-fabric version` | `agent-fabric -v` / `agent-fabric --version` | 输出已安装版本                                                                                 |

说明：

- launcher 命令发生在服务外部，不会路由到任何工作区。
- 长期运行的标准入口是安装到 PATH 上的 `agent-fabric start` / `agent-fabric restart`。
- 源码仓库里的 `bun start` / `npm start` 只是开发便利入口；它们委托到 `bun src/cli.ts start`，仍先进入 launcher 层，再启动 backend。若本机 PATH 还找不到已安装的 `agent-fabric`，在仓库目录可临时使用 `bun src/cli.ts start` / `bun src/cli.ts restart` 作为 repo-local fallback。不要再把 `bun src/index.ts` 当作推荐启动方式。
- `bun src/index.ts` / `bun dist/index.js` 属于 direct backend 调试路径；服务可识别并在 `/self-status` 中标注为开发直启，不作为长期 supervisor 或安全重启的推荐入口。
- `agent-fabric start` 会先校验当前目录是否符合 workspace allowlist，再为缺失 `custom_cwd` 的主工作区物化默认值。
- `agent-fabric restart` 不会在当前 shell 里直接 kill/拉起服务，也不会用调用方当前目录或 argv 推导新启动命令。它只读取当前 backend 持久化到 `~/.agent-fabric/ops/current-backend.json` 的 authoritative restart state，写入 restart intent，再交给 watchdog 执行。若当前服务由 `launchd` 托管，watchdog 会改为 `launchctl kickstart -k ...` 保持 supervision。
- `agent-fabric restart` 只表示“安全重启请求已被受理”。最终是否完成，以 `~/.agent-fabric/ops/restarts/*.json`、`/self-status` 或 IM 成功回执为准；若找不到 current backend state、保存的 PID 已不存在、launch spec 不安全、或 watchdog 缺失，launcher 会以非零状态失败，而不是尝试猜测启动方式。
- 从 IM 让 agent 自己操作服务时，优先使用显式应用内命令 `/self-restart` 或受管重启短语。普通 IM-origin agent 工具调用即使命中了 `agent-fabric restart` 这类 safe launcher 字面命令，也会被 restart guard 拦截；Web operator 环境和外部 shell 才适合直接调用 `agent-fabric restart`。
- 这些命令与下文的 `/help`、`/openai`、`/clear` 等应用内命令不是同一层协议。

## Workflow 定时计划

仓库内 `scripts/` 可以放一次性运维辅助入口；这类脚本不属于 `agent-fabric` launcher，也不属于 Web / IM 应用内命令。Agent Fabric 的定时自动化只保留 scheduled workflow task，不再提供其他执行类型或旧解析入口。

`scheduled_tasks.execution_type='workflow'` 时，`script_command` 保存 workflow id，`prompt` 保存 workflow prompt；scheduler 会复用 `/workflow <id> <prompt>` 的同一条执行路径，并写 workflow run/step 审计。scheduled workflow 不创建独立 task workspace，也不把 prompt 注入源工作区主会话；它只创建 workflow run/context、执行 local task / role node，并把终态消息回投到 scheduled task 的执行会话；只有该执行会话本身是已连接飞书入口时，同一执行路径才会额外创建独立 workflow 进度卡。

scheduled workflow 默认带 usage guard：OpenAI 5h 或 7d 剩余额低于 30% 时不启动 workflow，并把任务延后到 usage reset 后继续。阈值可用 `AGENT_FABRIC_SCHEDULED_AGENT_USAGE_MIN_REMAINING_PCT` 覆盖；usage API 临时不可读时优先复用 90 分钟内最近一次成功 snapshot，仍不可读时按 `AGENT_FABRIC_SCHEDULED_AGENT_USAGE_UNAVAILABLE_RETRY_MS` 做保守重试。usage guard 延期是 `Deferred` 状态，不等同于任务失败；workflow 自身返回 `❌ 工作流 ... 失败` 才会记为 task run error。scheduler 还会对超时或上个进程遗留的 running task log / workflow run 执行 watchdog 清理，错误文本为 `Process exceeded scheduled workflow watchdog timeout`。

内置 `kol` workflow 可作为定时 KOL 情报日报复用：`script_command='kol'`，`prompt` 可写 `股票 KOL 情报报告`，默认窗口为 30 天；若需要短窗口，可在 prompt 中加入 `--days=7`。`/kol [--days=30]` skill command 只是这个 workflow 的参数化快捷入口，scheduled task 不需要先经过 `/kol` executor。KOL 白名单维护走独立 skill command `/kol-add <@handle或X链接...>`，它直接写入 workflow local task 实际读取的 `stock-kol-intel/references/kol_whitelist.json`，不创建报告 workflow run。

## 应用内命令概览

Agent Fabric 维护一份统一命令注册表，作为以下入口的单一事实源：

- IM slash command 分发
- Web 输入框命令识别
- `/help` 输出
- 本文档

除内建命令外，当前工作区 `.agents/skills` 中启用的仓库级 skill 也可以通过 `commands.json` 声明自己的 slash command。内建命令优先；只有内建未命中时，才会继续尝试 skill command 分发。

命令最终是否可用，取决于：

- 当前入口：`im` / `web`
- 当前工作区 runtime：`openai`

因此 `/help` 不是静态文档回显，而是按“当前入口 + 当前工作区 runtime”动态输出真正可执行的命令列表，并按模块分组展示。

任何以 `/` 开头、并被入口识别为 slash command 候选的输入，都会先经过本地命令分发层：

- 已知内建命令：返回 hardcode / 本地 handler 结果
- 已声明的 skill command：执行 skill 自己声明的 executor
- 当前入口不可用的命令：返回明确提示
- 未知命令：返回“不支持的命令”

skill command 的执行结果有三类：

- 直接回复一段最终 markdown
- 把 slash command 改写成一段由 skill 生成的 `assistant_prompt` 消息，再继续进入 Agent 主流程；这类消息会使用隔离 runtime session，既不继承也不替换当前 workspace 的主 runtime session
- 触发一个 workflow，例如 `stock-analysis-skill` 的 `/hkipo` 会返回 `workflowId=hkipo` 和结构化 input，`stock-kol-intel` 的 `/kol --days=7` 会返回 `workflowId=kol` 与 `{ days: 7 }`，由 Agent Fabric 创建独立 workflow run；这条路径不进入用户主会话，也不会生成 `assistant_prompt`

因此，并不是所有 slash command 都会在本地层终止；skill command 可以选择把命令解析结果继续交给 Agent。

## Agent 命令

以下命令在 IM 与 Web 都可直接识别：

| 命令                    | 别名                | 作用                                                                      |
| ----------------------- | ------------------- | ------------------------------------------------------------------------- |
| `/help`                 | -                   | 按模块查看当前入口、当前 runtime 下真正可用的命令                         |
| `/clear`                | -                   | 清除当前工作区主线或当前任务线程的运行时上下文                            |
| `/sw <任务描述>`        | `/spawn <任务描述>` | 在当前工作区创建并行任务                                                  |
| `/workflow [id] [任务]` | -                   | 列出或触发当前工作区 `.agents/workflows` 中定义的 workflow/crew           |
| `/openai`               | -                   | 配置 OpenAI 工作区模型、思考强度和速度；仅当前 runtime 为 `openai` 时可用 |

说明：

- `/openai` 是当前工作区级配置入口，会持久化到工作区 runtime 配置。
- `/workflow` 不复用用户主线 runtime session。它只把当前 Web / IM 入口作为触发入口和结果回填通道；workflow 自身按 `(folder, workflowId)` 生成独立 `workflowContextId` / LangGraph `thread_id`，role node 通过独立 `agentId=workflow:<workflowContextId>` 启动 runner，并创建或关联一个 workflow 线程用于后续追问和来源显示。workflow 定义优先来自当前工作区 `.agents/workflows/<id>.json`，缺失时可使用 Agent Fabric 内置 `.agents/workflows/<id>.json`；runtime role card 同理优先读取 `.agents/agent-roles/<id>.md`。role 的 `allowedTools` 会在 runner tool factory 层硬过滤。
- 输入 bare `/workflow` 会列出当前工作区可用 workflow；输入 `/workflow <id> <任务>` 会创建一条 `workflow_runs` 审计记录并后台执行对应 graph。run 创建成功后，Web / 没有进度卡能力的 IM 入口会立即收到字段化启动回执，包含 workflow id、run id、任务和回投说明；飞书入口若成功创建独立 workflow 进度卡，则不再额外发送启动文本气泡，只保留这张卡片实时展示每个节点的状态、内容摘要、耗时和本地任务；成功、失败或 runner 超时后，系统会再向同一触发会话发送 `✅ 完成` 或 `❌ 失败` 终态消息。
- 内置 `hkipo` workflow 是 9 节点 crew：Futu/OpenD IPO 池发现、池标准化、核心数据采集计划、二级热度/结构/估值证据采集、热度核验、官方文件下载解析、发行结构/基本面/估值分析、回测校准、最终短报告。用户仍输入 `/hkipo [--all]`；skill executor 只负责把它转成 `hkipo` workflow trigger，`--all` 作为结构化 input 传入 workflow state。最终报告面向飞书普通文本气泡，中文公司名优先，用短行和 emoji 突出排名、热度、入场费、绿鞋/基石/保荐/回拨、同类估值、合理区间、风险与池子校验，不依赖 Markdown 粗体或表格渲染。热度分只允许来自报告日同日的 `margin_multiple` 或 `subscription_multiple` evidence；`margin_multiple` 表示融资/孖展超额倍数，`subscription_multiple` 表示认购倍数，报告不得互相改名。若只有单一券商认购倍数，必须写“单一券商下限；融资/孖展倍数暂无多源核验”；若 `subscription_heat.score_status=not_scorable` 或核心因子不足，报告必须写 `0/N/A` 或“数据不足”，不得输出精确总分或主观“热5”。HKIPO 单个 role node 有 180s runtime 预算；对 `UND_ERR_SOCKET` 等 transient OpenAI socket 异常会有界重试，非最终 role 仍失败或超时时写降级 artifact 继续，最终报告 role 仍失败时用已完成的本地 artifact 生成“降级报告”，避免用户只看到 undici 堆栈。投递前还会对 `hkipo` 最终文本做轻量确定性归一化：把旧来源名统一为“致富证券 IPO”，把旧版“孖展多源未取到”改为“融资/孖展倍数暂无多源核验”，并把“卡：热17 结构8 ...”这类内部短码改写成独立 `🧮 评分` 行。
- 内置 `kol` workflow 是 2 节点 crew：`stock.kol.prepare_context` local task 从 sibling `stock-kol-intel` 仓库或 `STOCK_KOL_INTEL_ROOT` 读取白名单和权威信源，调用其 X/Twitter `twscrape` 源预检函数，并输出 `kol_context` 结构化 artifact；`kol-intel-reporter` 只读角色基于该 artifact 生成飞书移动端友好的 KOL 情报报告。用户仍输入 `/kol [--days=30]`；skill executor 只负责校验 `--days` 并转成 `kol` workflow trigger。白名单写入不走报告 workflow，使用 `/kol-add <@handle或X链接...> [--name 名称] [--focus 标签] [--note 说明]`；该命令支持直接 handle、X/Twitter URL 和粘贴 Markdown 列表，按 X handle 去重写入同一份 `references/kol_whitelist.json`。默认窗口为最近 30 天。报告必须在开头用 `覆盖 KOL（数量）：名单` 一行列出覆盖 KOL 明细并先给结论/总结；正文按主题/共识合并，不按作者或帖子平铺，最多输出 3 个高信号主题，不用泛泛宏观情绪或“继续观察”补数；结论/总结、近期投资方向和每个编号主题之间用单独一行 `---` 分隔；每个高信号主题用 emoji + 粗体字段呈现，字段块之间不插入额外空行，保留作者原文链接、观点摘要、可跟踪行业/标的、可跟踪方向，行业现状和未来叙事只有在来源给出具体事实时才写；结论/总结和下一步重点核验必须拆成编号列表；来源显示为 `[原文标题](原文链接) [YYYY-MM-DD]`，不得保留 `| x` 后缀；弱证据、无法核验、营销、纯转推、免责声明、流程说明和没有证据增量的套话不进入主报告；固定的账号/来源置信段落不输出，只有来源存疑、低置信或不可访问时才追加“来源提醒”。对 `UND_ERR_SOCKET` 等 transient OpenAI socket 异常会先有界重试；若最终报告角色仍失败但 `kol_context` 已生成，则返回基于白名单和来源状态的“降级报告”，避免用户只看到 undici 底层对象。
- 当工作区未显式设置 `openai` 的模型、思考强度或速度时，`/status`、`/openai` 配置卡、dispatch 与 footer fallback 会统一继承 backend 解析出的 OpenAI 环境变量 fallback，避免不同入口看到不同值。
- `openai` 的模型选项使用内置 preset；若当前 effective model 不在 preset 中，配置卡仍会把它作为当前值展示，避免 `/status` 与 `/openai` 不一致。
- 普通回复 footer 只保留基础 runtime 信息（紧凑耗时 / Agent 类型 / 模型 / 推理强度 / OpenAI 速度）和路由位置（工作区 / 线程 / 时间）；路由位置不再重复展示入口渠道名，例如飞书回复不再额外拼 `| 飞书 |`。耗时不显示小数秒，并按非零单位展示，例如 `36s`、`1min12s`、`1h23min12s`，OpenAI 速度展示为 `standard (1x)` 或 `fast (2x)`。footer 不展示 5h / 7d 剩余额；OpenAI usage 只作为 scheduled workflow 的启动保护使用。
- 普通回复不会读取 `PLANS/ACTIVE.md`、roadmap、历史摘要或旧 partial body 来补正文；任务进度只留在本地计划文件与显式命令输出中。
- `/help` 现在只展示“当前入口 + 当前 runtime”真正可执行的命令列表，不再夹带状态摘要，并分成 `Agent 命令`、`工作区命令`、`服务命令`、`技能命令` 等模块；若当前工作区存在已声明且适用于当前入口的 skill command，也会一并展示。
- skill command 若在 `commands.json` 声明 `argumentHint` / `usage`，`/help` 会把参数占位一起展示，例如 `/research <股票名称/代码>`、`/kol [--days=30]`。
- Web 输入框只在输入 bare `/openai` 时展示配置 UI；飞书会返回同一张配置卡，用多个下拉分别设置模型、思考强度和速度。
- 历史的 `/model` / `/effort` / `/speed` 独立命令，以及它们的参数式交互，都不再作为用户命令保留。

## Skill Command

skill command 通过仓库级 skill 根目录下的 `commands.json` 声明。当前分发约定如下：

- 只搜索当前 workspace 的 `.agents/skills/`；不读取 Web 用户 Skill、宿主 `~/.agents/skills`、`~/.agent-fabric/skills` 或历史同步目录。
- Web UI 不提供 Skill 管理、同步、安装、启停或删除入口；新增命令必须以仓库文件形式提交到 `.agents/skills/<skill-id>/`。
- 可选字段 `argumentHint` / `argument_hint` / `usage` 用于 `/help` 展示参数占位；它只影响帮助文本，不改变 executor 收到的 `argsText` 和 `args`。`description` 只写命令用途，不写参数、默认值或支持选项。
- 若多个 skill 在同一搜索优先级上声明了相同命令，命令不会静默二选一，而是直接返回冲突提示。
- executor 通过 stdin 接收 JSON payload，并通过 stdout 返回 JSON 结果。
- executor 环境会先读取该 skill 根目录的 `.env`，再叠加 Agent Fabric 服务进程环境，最后注入 `AGENT_FABRIC_COMMAND`、`AGENT_FABRIC_SKILL_ID`、`AGENT_FABRIC_SKILL_DIR`；服务进程环境优先于 `.env`，用于部署级覆盖。
- executor 声明裸 `python` / `python3` 时，宿主优先使用该 skill 根目录下的 `.venv` Python（Unix: `.venv/bin/python`，Windows: `.venv/Scripts/python.exe`）；找不到 skill-local venv 时才回退到原声明命令，避免服务重启后 PATH 漂移导致 skill command 使用错误 Python 环境。
- 结果类型目前支持：
  - `final_markdown`：本地直接返回最终文本
  - `assistant_prompt`：把命令改写成一段独立用户消息，再用隔离 runtime session 继续走 Agent 主流程
  - `workflow`：返回 `workflowId`、`prompt` 和结构化 `input`，由宿主触发独立 workflow run；例如 `/hkipo --all` 会触发 `hkipo` workflow，并把 `includeClosed=true` 传入 workflow input。workflow 类型不是同步最终回复：宿主必须先回填启动回执；飞书入口会额外维护独立 workflow 进度卡；后台 run 结束、失败或超时时再回填终态消息。

这层协议只负责“发现 + 执行 + 回填结果”，不承载任何业务特定语义。

## IM 专属命令

以下命令仅在 IM 入口可用：

| 命令                            | 别名  | 作用                                                            |
| ------------------------------- | ----- | --------------------------------------------------------------- |
| `/list`                         | `/ls` | 查看当前实例可访问的工作区与最近任务线程                        |
| `/where`                        | -     | 查看当前 IM 入口会发往哪个工作区 / 线程                         |
| `/use <工作区>`                 | -     | 将当前 IM 入口默认切到某个工作区主线                            |
| `/to <工作区或任务> <消息>`     | -     | 单次把消息发往指定工作区或任务线程，不改变默认目标              |
| `/threads`                      | -     | 列出当前工作区最近任务线程                                      |
| `/back`                         | -     | 回到当前工作区主线                                              |
| `/status`                       | -     | 查看当前入口、工作区、线程、运行状态与当前 runtime 摘要         |
| `/self-status`                  | -     | 查看 agent-fabric 服务版本、自检状态、restartability 与当前重启命令 |
| `/self-check`                   | -     | 隔离启动候选服务做冷启动健康检查，不重启当前服务                |
| `/self-restart`                 | -     | 创建自重启 intent，并交给独立 watchdog 执行                     |
| `/bind <workspace>`             | -     | `/use <workspace>` 的兼容别名，设置当前 IM 入口默认工作区       |
| `/unbind`                       | -     | 解除显式入口路由，回到默认工作区                                |
| `/new <名称>`                   | -     | 创建新工作区并把当前 IM 入口切过去                              |
| `/require_mention <true/false>` | -     | 控制群聊里是否必须被 @ 才响应                                   |

说明：

- `/status` 会以 “Agent” 与 “运行状态” 两段展示当前 runtime 摘要（Agent
  类型、模型、推理强度、OpenAI 速度）、当前入口路由、回复策略、当前工作区、当前线程、线程数、队列负载和服务进程 cwd；若当前 runtime usage 可读则展示 5h/7d 剩余额和重置时间，无法读取时才显示 `unavailable` / `unknown`。
- 若当前工作区最近触发过 workflow，`/status` 会追加最近 workflow run 的 `workflow_id`、状态、创建时间和错误摘要；它不会把 workflow 误展示成当前用户会话。
- Feishu 入口的 `/status` 还会附加最近 Feishu 消息链路事件；当存在最近非 ok 事件时，会单独显示一行紧凑的“飞书异常”，避免投递失败或跳过原因被后续正常事件盖掉。
- `/self-status` 与 `/self-check` 仅管理员可用，用于服务自迭代排障；`/self-status` 会直接展示当前 backend 解析到的 self-restart launch source、source/build artifact mode 和精确命令，便于判断当前进程是否真的可安全重启；若当前是 `direct_backend` 开发直启路径，或 repo-local source launcher 入口，还会提示长期运行推荐使用 `agent-fabric start` / `agent-fabric restart`。source launcher 模式下，build 摘要会标注“源码运行，dist build 仅供打包参考”，避免把 dist 指纹误当作当前 backend 代码新旧判断；存在最近非 ok Feishu lifecycle 事件时还会追加全局“飞书异常”摘要。`/self-check` 会复用当前 backend 捕获的 authoritative launch spec，用隔离 `HOME` 和临时 `WEB_PORT` 启动候选 backend 并检查 `/api/health`，结果会展示候选命令，不会停止或重启当前服务。
- `/self-restart` 仅管理员可用；backend 只会在当前 launch spec 已通过结构校验时写入 restart intent 并启动独立 watchdog。若当前进程的启动命令不安全或不完整（例如只剩 `bun` 空参数），命令会直接失败，不会生成一个注定错误的 intent。watchdog 会先做 shadow self-check，通过后才停止旧 PID、启动同一启动命令并检查生产端口 `/api/health`。它不是 blue-green/rollback 机制，结果以 `~/.agent-fabric/ops/restarts/*.json` 为准；重启成功后，新进程会向发起命令的 IM 会话补发一条成功回执，附带当前服务状态和残留进程检查摘要。若摘要里发现真正孤儿的 runner residue，服务会优先按孤儿 runner 进程组发送 `SIGTERM`，必要时再回退到单个 PID 的 best-effort 清理；普通 backend 启动时也会对残留孤儿 runner 执行同一套 best-effort 清理。
- 对“飞书里让 agent 自己重启 agent-fabric 项目”这类场景，不要在任务里直接执行 `pkill` / `kill` / `launchctl bootout` 之类的停机命令；应改用 IM `/self-restart`，或在可信外部 shell / Web operator 环境执行 `agent-fabric restart`，让重启继续走同一条 safe intent/watchdog 路径。
- IM-origin agent runner 的 shell 工具调用会使用更严格的 restart guard：即使命令本身看起来是 safe launcher，也不能由普通 IM 任务上下文自发触发服务重启。只有显式应用内命令 `/self-restart` 或被管理短语改写成的 `self-restart` 命令能从 IM 发起重启。

本机如果需要比 watchdog 更强的兜底，使用 repo 内 `ops/install-launch-agent.sh` 安装用户级 `launchd` LaunchAgent；安装脚本默认使用 `agent-fabric start`，也可以通过显式 `-- COMMAND [ARGS...]` 复用 `/self-status` 展示的 validated 启动命令。

## IM 入口路由

IM 入口本身不是长期上下文身份；它像一个多工作区遥控器，会先经过 Context Router，再进入某个工作区主线或任务线程。普通用户可以自然说“切到 HK IPO”“股票研究里帮我看下腾讯”“继续刚才那个盯盘任务”；`/where`、`/use`、`/to`、`/threads`、`/back` 是高级兜底命令，不要求每次显式调用。

常用切换方式：

- `/where`：查看当前 IM 入口实际会进入哪个工作区 / 线程。
- `/use <workspace>`：把当前 IM 入口默认切到该 workspace 的主线，后续普通消息默认进这里。
- `/to <workspace或任务> <消息>`：只把这一次消息定向发过去，不改变默认工作区。
- `/threads`：查看当前工作区最近任务线程，便于继续某个长任务。
- `/back`：回到当前工作区主线。
- `/bind <workspace>`：兼容别名，等同于 `/use <workspace>`。
- `/unbind`：取消显式入口路由，回到该 IM 入口自己的默认 workspace/folder。
- `/new <名称>`：创建新 workspace，并把当前 IM 入口默认切到这个新 workspace 的主线。

例子：

- 飞书执行 `/use hkipo` 后，后续普通消息默认进入 `hkipo` 工作区主线；微信如果仍停留在 `main`，不受影响。
- 微信执行 `/to 股票研究 看下腾讯今天的变化` 后，只这一条进入“股票研究”，下一条普通消息仍回到微信原来的默认工作区。
- 用户回复一条带来源 footer 的 workflow 结果时，调度层应优先回到同一个工作区 / workflow 线程；如果多个候选冲突，系统反问，而不是静默串台。

## Web 入口说明

Web 导航包含 `自动化` 页，内部按 `计划`、`运行`、`工作流` 三个视角整合定时任务管理、当前运行状态和 workflow 审计。`计划` 复用 `scheduled_tasks` 管理能力；`运行` 聚合当前 running / queued 状态；`工作流` 查看当天 workflow run、step 进度、定时 workflow task、任务日志和当前运行中状态。看板复用 workflow / scheduler 审计表，不触发重跑。看板可编辑 / 删除 `execution_type='workflow'` 的定时任务：编辑会更新 `scheduled_tasks` 中的 workflow id、prompt、调度和值状态；删除只移除后续调度任务，不强制中断已经启动的 workflow run，既有 run/step 审计继续保留。旧 `/tasks` 与 `/workflows` 入口不再保留兼容跳转，Web 自动化能力统一从 `/automations` 进入。

Web 输入框与 agent tab 直接识别统一命令注册表中的 Web 入口命令：

- `/help`
- `/clear`
- `/sw`
- `/spawn`
- `/workflow`
- `/openai`（OpenAI 工作区）

如果在 Web 输入框输入了已知但当前入口不可用的命令（例如 `/bind`），系统会直接返回明确提示，而不会把它当普通消息交给 Agent。
当输入 `/openai` 时，输入框上方会展示该 Agent 的配置选项；点击后由前端发送实际切换请求。`/openai` 同时展示模型、思考强度和速度。

如果 Web 输入的是已声明的 skill command，系统会先执行 skill executor；若 skill 返回 `assistant_prompt`，前端会把该 prompt 作为本次真正入库并发给 Agent 的用户消息内容，并以隔离 runtime session 执行。该 session 不会写回 workspace 主会话；下一条普通消息继续使用原主会话，若历史版本已把上一轮 skill final 的 session 误写成主 session，则会先忽略它并建立新的普通主会话。

若 skill 返回 `workflow`，Web 与 Feishu IM 都会保存原 slash command、字段化启动回执与后台终态回复，但原命令会标记为 `user_command`，不会入队为普通 Agent 消息；Feishu IM 还会创建独立 workflow 进度卡展示 run/step 进度。workflow run 会记录 `trigger_message_id`，便于从审计回溯到触发消息。当前 `/hkipo` 与 `/kol` 都走这条路径。

## 运行时配置命令

### `/openai`

- 仅当前工作区 runtime 为 `openai` 时展示。
- 模型选项来自内置 preset；当前 effective model 不在 preset 中时仍会作为当前值展示。
- 思考强度可用值为 `low`、`medium`、`high`、`xhigh`。
- 速度可用值为 `standard` 与 `fast`；对 Codex CLI 登录态，`fast` 会向 OpenAI provider data 下发 Codex 后端实际接受的 `service_tier="priority"`，`standard` 表示不下发 service-tier 覆盖。
- 文本 fallback 会同时返回当前配置与可用值；飞书和 Web 使用同一组配置选项渲染下拉。

## 备注

- `/sw` 与 `/spawn` 是同义命令。
- `/bind` 只保留工作区级兼容别名；任务线程切换优先使用自然语言、来源 footer、`/threads` 或 `/to`。
- `openai` 的模型可用值以运行时命令注册表为准；本文档不枚举动态列表。
