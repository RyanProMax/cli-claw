# COMMAND

> 本文负责：统一命令注册表的行为、入口差异，以及命令与 runtime 的关系。工作流协议和工程规则见 `AGENTS.md` 与 `docs/ENGINEERING.md`。

## 概览

Cli Claw 的“命令”分成两层：

- 服务 launcher 命令：仓库自带或同名 `cli-claw` 发布包提供的 `cli-claw ...`
- 应用内命令：服务启动后，在 Web / IM 里输入 slash command

统一命令注册表只覆盖第二层应用内命令；`cli-claw start` / `help` / `version` 不走 runtime command registry。

## 服务 Launcher 命令

以下命令由 `cli-claw` launcher 二进制直接处理：

| 命令               | 别名                                 | 作用                                                                                           |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `cli-claw start`   | -                                    | 启动主服务，并把当前 shell 目录作为 host 工作区默认启动目录                                    |
| `cli-claw restart` | -                                    | 读取当前服务保存的 restart 状态并请求一次安全自重启；适合从外部 shell 或 Web operator 环境触发 |
| `cli-claw help`    | `cli-claw -h` / `cli-claw --help`    | 查看 launcher 帮助                                                                             |
| `cli-claw version` | `cli-claw -v` / `cli-claw --version` | 输出已安装版本                                                                                 |

说明：

- launcher 命令发生在服务外部，不会路由到任何工作区。
- 长期运行的标准入口是安装到 PATH 上的 `cli-claw start` / `cli-claw restart`。
- 源码仓库里的 `bun start` / `npm start` 只是开发便利入口；它们委托到 `bun src/cli.ts start`，仍先进入 launcher 层，再启动 backend。若本机 PATH 还找不到已安装的 `cli-claw`，在仓库目录可临时使用 `bun src/cli.ts start` / `bun src/cli.ts restart` 作为 repo-local fallback。不要再把 `bun src/index.ts` 当作推荐启动方式。
- `bun src/index.ts` / `bun dist/index.js` 属于 direct backend 调试路径；服务可识别并在 `/self-status` 中标注为开发直启，不作为长期 supervisor 或安全重启的推荐入口。
- `cli-claw start` 会先校验当前目录是否符合 host allowlist，再为缺失 `custom_cwd` 的 host 工作区物化默认值。
- `cli-claw restart` 不会在当前 shell 里直接 kill/拉起服务，也不会用调用方当前目录或 argv 推导新启动命令。它只读取当前 backend 持久化到 `~/.cli-claw/ops/current-backend.json` 的 authoritative restart state，写入 restart intent，再交给 watchdog 执行。若当前服务由 `launchd` 托管，watchdog 会改为 `launchctl kickstart -k ...` 保持 supervision。
- `cli-claw restart` 只表示“安全重启请求已被受理”。最终是否完成，以 `~/.cli-claw/ops/restarts/*.json`、`/self-status` 或 IM 成功回执为准；若找不到 current backend state、保存的 PID 已不存在、launch spec 不安全、或 watchdog 缺失，launcher 会以非零状态失败，而不是尝试猜测启动方式。
- 从 IM 让 agent 自己操作服务时，优先使用显式应用内命令 `/self-restart` 或受管重启短语。普通 IM-origin agent 工具调用即使命中了 `cli-claw restart` 这类 safe launcher 字面命令，也会被 restart guard 拦截；Web operator 环境和外部 shell 才适合直接调用 `cli-claw restart`。
- 这些命令与下文的 `/help`、`/codex`、`/claude`、`/clear` 等应用内命令不是同一层协议。

## 应用内命令概览

Cli Claw 维护一份统一命令注册表，作为以下入口的单一事实源：

- IM slash command 分发
- Web 输入框命令识别
- `/help` 输出
- 本文档

除内建命令外，当前工作区已启用的 skill 也可以通过 `commands.json` 声明自己的 slash command。内建命令优先；只有内建未命中时，才会继续尝试 skill command 分发。

命令最终是否可用，取决于：

- 当前入口：`im` / `web`
- 当前工作区 runtime：`claude` / `codex`

因此 `/help` 不是静态文档回显，而是按“当前入口 + 当前工作区 runtime”动态输出真正可执行的命令列表，并按模块分组展示。

任何以 `/` 开头、并被入口识别为 slash command 候选的输入，都会先经过本地命令分发层：

- 已知内建命令：返回 hardcode / 本地 handler 结果
- 已声明的 skill command：执行 skill 自己声明的 executor
- 当前入口不可用的命令：返回明确提示
- 未知命令：返回“不支持的命令”

skill command 的执行结果有两类：

- 直接回复一段最终 markdown
- 把 slash command 改写成一段由 skill 生成的 `assistant_prompt` 消息，再继续进入 Agent 主流程；这类消息会使用隔离 runtime session，既不继承也不替换当前 workspace 的主 runtime session

因此，并不是所有 slash command 都会在本地层终止；skill command 可以选择把命令解析结果继续交给 Agent。

## Agent 命令

以下命令在 IM 与 Web 都可直接识别；runtime 配置命令会按当前工作区 agent 只展示一个：

| 命令             | 别名                | 作用                                          |
| ---------------- | ------------------- | --------------------------------------------- |
| `/help`          | -                   | 按模块查看当前入口、当前 runtime 下真正可用的命令 |
| `/clear`         | -                   | 清除当前工作区或当前绑定 Agent 的会话上下文   |
| `/sw <任务描述>` | `/spawn <任务描述>` | 在当前工作区创建并行任务                      |
| `/claude`        | -                   | 配置 Claude 工作区模型；仅当前 runtime 为 `claude` 时可用 |
| `/codex`         | -                   | 配置 Codex 工作区模型、思考强度和速度；仅当前 runtime 为 `codex` 时可用 |

说明：

- `/claude` 与 `/codex` 都是“当前工作区级”配置入口，会持久化到工作区 runtime 配置。
- 当工作区未显式设置 `codex` 的模型、思考强度或速度时，`/status`、`/codex` 配置卡、dispatch 与 footer fallback 会统一继承 backend 解析出的 Codex CLI fallback（环境变量与 `~/.codex/config.toml`），避免不同入口看到不同值。
- `codex` 的模型选项在 IM / Feishu / Web 入口会优先执行宿主机 `codex debug models` 获取当前 CLI catalog；命令不可用、超时或返回异常时，才依次回退到 `~/.codex/models_cache.json` 与内置 preset。若当前 effective model 不在 catalog 中，配置卡仍会把它作为当前值展示，避免 `/status` 与 `/codex` 不一致。
- 普通回复 footer 会始终保留基础 runtime 信息（时长 / Agent 类型 / 模型 / 推理强度 / Codex 速度）；Codex 速度展示为 `standard (1x)` 或 `fast (2x)`。当当前 runtime usage 可用时，会追加 `72% (5h) | 96% (7d)` 这类 5h / 7d token usage 百分比；旧消息若只有 remaining 元数据，仍仅在低余额阈值下显示兼容提示。
- 普通回复不会读取 `PLANS/ACTIVE.md`、roadmap、历史摘要或旧 partial body 来补正文；任务进度只留在本地计划文件与显式命令输出中。
- `/help` 现在只展示“当前入口 + 当前 runtime”真正可执行的命令列表，不再夹带状态摘要，并分成 `Agent 命令`、`工作区命令`、`服务命令`、`技能命令` 等模块；若当前工作区存在已声明且适用于当前入口的 skill command，也会一并展示。
- Web 输入框只在输入 bare `/codex` 或 `/claude` 时展示配置 UI；飞书会返回同一张配置卡，用多个下拉分别设置模型、思考强度和速度（Claude 只显示模型）。
- 历史的 `/model` / `/effort` / `/speed` 独立命令，以及它们的参数式交互，都不再作为用户命令保留。

## Skill Command

skill command 通过 skill 根目录下的 `commands.json` 声明。当前分发约定如下：

- 先搜索当前工作区 `.claude/skills/`，再搜索用户级同步 skill 目录；项目内 skill 可以覆盖用户级同名声明。
- 若多个 skill 在同一搜索优先级上声明了相同命令，命令不会静默二选一，而是直接返回冲突提示。
- executor 通过 stdin 接收 JSON payload，并通过 stdout 返回 JSON 结果。
- executor 声明裸 `python` / `python3` 时，宿主优先使用该 skill 根目录下的 `.venv` Python（Unix: `.venv/bin/python`，Windows: `.venv/Scripts/python.exe`）；找不到 skill-local venv 时才回退到原声明命令，避免服务重启后 PATH 漂移导致 skill command 使用错误 Python 环境。
- 结果类型目前支持：
  - `final_markdown`：本地直接返回最终文本
  - `assistant_prompt`：把命令改写成一段独立用户消息，再用隔离 runtime session 继续走 Agent 主流程

这层协议只负责“发现 + 执行 + 回填结果”，不承载任何业务特定语义。

## IM 专属命令

以下命令仅在 IM 入口可用：

| 命令                            | 别名  | 作用                                                                 |
| ------------------------------- | ----- | -------------------------------------------------------------------- |
| `/list`                         | `/ls` | 查看当前用户可访问的工作区与对话列表                                 |
| `/status`                       | -     | 查看当前工作区、运行状态、当前 runtime 摘要与当前 Codex 5h / 7d 余额 |
| `/self-status`                  | -     | 查看 cli-claw 服务版本、自检状态、restartability 与当前重启命令      |
| `/self-check`                   | -     | 隔离启动候选服务做冷启动健康检查，不重启当前服务                     |
| `/self-restart`                 | -     | 创建自重启 intent，并交给独立 watchdog 执行                          |
| `/where`                        | -     | 查看当前 IM 会话绑定到了哪个工作区 / Agent                           |
| `/bind <workspace>`             | -     | 将当前 IM 会话绑定到指定工作区                                       |
| `/bind <workspace>/<agent短ID>` | -     | 将当前 IM 会话绑定到指定工作区下的 conversation agent                |
| `/unbind`                       | -     | 解除绑定，回到默认工作区                                             |
| `/new <名称>`                   | -     | 创建新工作区并把当前 IM 会话绑定过去                                 |
| `/require_mention true`         | -     | 群聊里只有被 @ 时才响应                                              |
| `/require_mention false`        | -     | 群聊里不需要 @ 也会响应                                              |

说明：

- `/status` 会以 “Agent” 与 “运行状态” 两段展示当前 runtime 摘要（Agent
  类型、模型、推理强度、Codex 速度）、当前 Codex 5h / 7d
  余额、当前工作区、当前会话、会话数、队列负载和服务进程 cwd。
- Feishu 入口的 `/status` 还会附加最近 Feishu 消息链路事件；当存在最近非 ok 事件时，会单独显示一行紧凑的“飞书异常”，避免投递失败或跳过原因被后续正常事件盖掉。
- Codex 余额读取自本机 `~/.codex/sessions/**/*.jsonl` 的最新 usage 快照；当前 runtime 不是 `codex` 或本地快照不可用时，对应余额会显示 `unavailable` / `unknown`。
- `/self-status` 与 `/self-check` 仅管理员可用，用于服务自迭代排障；`/self-status` 会直接展示当前 backend 解析到的 self-restart launch source、source/build artifact mode 和精确命令，便于判断当前进程是否真的可安全重启；若当前是 `direct_backend` 开发直启路径，或 repo-local source launcher 入口，还会提示长期运行推荐使用 `cli-claw start` / `cli-claw restart`。source launcher 模式下，build 摘要会标注“源码运行，dist build 仅供打包参考”，避免把 dist 指纹误当作当前 backend 代码新旧判断；存在最近非 ok Feishu lifecycle 事件时还会追加全局“飞书异常”摘要。`/self-check` 会复用当前 backend 捕获的 authoritative launch spec，用隔离 `HOME` 和临时 `WEB_PORT` 启动候选 backend 并检查 `/api/health`，结果会展示候选命令，不会停止或重启当前服务。
- `/self-restart` 仅管理员可用；backend 只会在当前 launch spec 已通过结构校验时写入 restart intent 并启动独立 watchdog。若当前进程的启动命令不安全或不完整（例如只剩 `bun` 空参数），命令会直接失败，不会生成一个注定错误的 intent。watchdog 会先做 shadow self-check，通过后才停止旧 PID、启动同一启动命令并检查生产端口 `/api/health`。它不是 blue-green/rollback 机制，结果以 `~/.cli-claw/ops/restarts/*.json` 为准；重启成功后，新进程会向发起命令的 IM 会话补发一条成功回执，附带当前服务状态和残留进程检查摘要。若摘要里发现真正孤儿的 runner residue，服务会优先按孤儿 runner 进程组发送 `SIGTERM`，必要时再回退到单个 PID 的 best-effort 清理；普通 backend 启动时也会对残留孤儿 runner 执行同一套 best-effort 清理。
- 对“飞书里让 agent 自己重启 cli-claw 项目”这类场景，不要在任务里直接执行 `pkill` / `kill` / `launchctl bootout` 之类的停机命令；应改用 IM `/self-restart`，或在可信外部 shell / Web operator 环境执行 `cli-claw restart`，让重启继续走同一条 safe intent/watchdog 路径。
- IM-origin agent runner 的 Bash / Codex ACP 工具调用会使用更严格的 restart guard：即使命令本身看起来是 safe launcher，也不能由普通 IM 任务上下文自发触发服务重启。只有显式应用内命令 `/self-restart` 或被管理短语改写成的 `self-restart` 命令能从 IM 发起重启。

本机如果需要比 watchdog 更强的兜底，使用 repo 内 `ops/install-launch-agent.sh` 安装用户级 `launchd` LaunchAgent；安装脚本默认使用 `cli-claw start`，也可以通过显式 `-- COMMAND [ARGS...]` 复用 `/self-status` 展示的 validated 启动命令。

## IM 会话切换与绑定

IM 入口本身不是长期对话身份；它会路由到某个 workspace 的主对话，或某个 workspace 下的 conversation agent。

常用切换方式：

- `/list`：查看当前用户可访问的 workspace，以及每个 workspace 下可绑定的 conversation agent 短 ID。
- `/where`：查看当前 IM chat 实际绑定到了哪里。
- `/bind <workspace>`：把当前 IM chat 切到该 workspace 的主对话。
- `/bind <workspace>/<agent短ID>`：把当前 IM chat 切到该 workspace 下的 conversation agent。
- `/unbind`：取消显式绑定，回到该 IM chat 自己的默认 workspace/folder。
- `/new <名称>`：创建新 workspace，并只把当前 IM chat 绑定到这个新 workspace 的主对话。

例子：

- 飞书和微信都绑定到 `demo`，等价于两个入口共用 `demo` 的主对话 runtime session。
- 微信执行 `/bind demo/a1b2` 后，微信切到 `demo` 下 ID 以 `a1b2` 开头的 conversation agent；飞书如果仍绑定 `demo` 主对话，则不受影响。
- 微信执行 `/new app2` 后，只是微信切到新建的 `app2` 主对话；飞书仍停留在原 workspace。

## Web 入口说明

Web 输入框与 agent tab 直接识别统一命令注册表中的 Web 入口命令：

- `/help`
- `/clear`
- `/sw`
- `/spawn`
- `/claude`（Claude 工作区）
- `/codex`（Codex 工作区）

如果在 Web 输入框输入了已知但当前入口不可用的命令（例如 `/bind`），系统会直接返回明确提示，而不会把它当普通消息交给 Agent。
当输入 `/claude` 或 `/codex` 时，输入框上方会展示该 Agent 的配置选项；点击后由前端发送实际切换请求。`/codex` 同时展示模型、思考强度和速度，`/claude` 只展示模型。

如果 Web 输入的是已声明的 skill command，系统会先执行 skill executor；若 skill 返回 `assistant_prompt`，前端会把该 prompt 作为本次真正入库并发给 Agent 的用户消息内容，并以隔离 runtime session 执行。该 session 不会写回 workspace 主会话；下一条普通消息继续使用原主会话，若历史版本已把上一轮 skill final 的 session 误写成主 session，则会先忽略它并建立新的普通主会话。

## 运行时配置命令

### `/claude`

- 仅当前工作区 runtime 为 `claude` 时展示。
- 可配置模型预设：
  - `opus[1m]`
  - `opus`
  - `sonnet[1m]`
  - `sonnet`
  - `haiku`

### `/codex`

- 仅当前工作区 runtime 为 `codex` 时展示。
- 模型选项优先来自当前宿主机 `codex debug models` 的实时 catalog；CLI catalog 不可用时回退到 `~/.codex/models_cache.json`，cache 也不可用时才使用内置 preset。
- 思考强度可用值为 `low`、`medium`、`high`、`xhigh`。
- 速度可用值为 `standard` 与 `fast`；`fast` 会向 Codex CLI 下发 `service_tier="fast"`，`standard` 表示不下发 service-tier 覆盖。
- 文本 fallback 会同时返回当前配置与可用值；飞书和 Web 使用同一组配置选项渲染下拉。

## 备注

- `/sw` 与 `/spawn` 是同义命令。
- `/bind` 目标里的 `agent短ID` 指 conversation agent 的短标识，不是工作区 folder。
- `claude` 的模型可用值以运行时命令注册表为准；`codex` 的模型在 backend 入口优先使用本机 Codex CLI 实时 catalog，本文档不枚举动态列表。
