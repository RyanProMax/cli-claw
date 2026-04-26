# COMMAND

> 本文负责：统一命令注册表的行为、入口差异，以及命令与 runtime 的关系。工作流协议和工程规则见 `AGENTS.md` 与 `docs/ENGINEERING.md`。

## 概览

Cli Claw 的“命令”分成两层：

- 服务 launcher 命令：仓库自带或同名 `cli-claw` 发布包提供的 `cli-claw ...`
- 应用内命令：服务启动后，在 Web / IM 里输入 slash command

统一命令注册表只覆盖第二层应用内命令；`cli-claw start` / `help` / `version` 不走 runtime command registry。

## 服务 Launcher 命令

以下命令由 `cli-claw` launcher 二进制直接处理：

| 命令               | 别名                                 | 作用                                                                                                |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `cli-claw start`   | -                                    | 启动主服务，并把当前 shell 目录作为 host 工作区默认启动目录                                         |
| `cli-claw restart` | -                                    | 读取当前服务保存的 restart 状态并请求一次安全自重启；适合从外部 shell 或正在处理任务的 agent 内触发 |
| `cli-claw help`    | `cli-claw -h` / `cli-claw --help`    | 查看 launcher 帮助                                                                                  |
| `cli-claw version` | `cli-claw -v` / `cli-claw --version` | 输出已安装版本                                                                                      |

说明：

- launcher 命令发生在服务外部，不会路由到任何工作区。
- `cli-claw start` 会先校验当前目录是否符合 host allowlist，再为缺失 `custom_cwd` 的 host 工作区物化默认值。
- `cli-claw restart` 不会在当前 shell 里直接 kill/拉起服务；它会复用 backend 启动时保存的 authoritative restart state，写入 restart intent，再交给 watchdog 执行。若当前服务由 `launchd` 托管，watchdog 会改为 `launchctl kickstart -k ...` 保持 supervision。
- 这些命令与下文的 `/help`、`/model`、`/clear` 等应用内命令不是同一层协议。

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

因此 `/help` 不是静态文档回显，而是按“当前入口 + 当前工作区 runtime”动态输出真正可执行的命令列表。

任何以 `/` 开头、并被入口识别为 slash command 候选的输入，都会先经过本地命令分发层：

- 已知内建命令：返回 hardcode / 本地 handler 结果
- 已声明的 skill command：执行 skill 自己声明的 executor
- 当前入口不可用的命令：返回明确提示
- 未知命令：返回“不支持的命令”

skill command 的执行结果有两类：

- 直接回复一段最终 markdown
- 把 slash command 改写成一段由 skill 生成的普通用户消息，再继续进入 Agent 主流程

因此，并不是所有 slash command 都会在本地层终止；skill command 可以选择把命令解析结果继续交给 Agent。

## 全局可用命令

以下命令在 IM 与 Web 都可直接识别：

| 命令             | 别名                | 作用                                          |
| ---------------- | ------------------- | --------------------------------------------- |
| `/help`          | -                   | 查看当前入口、当前 runtime 下真正可用的命令   |
| `/clear`         | -                   | 清除当前工作区或当前绑定 Agent 的会话上下文   |
| `/sw <任务描述>` | `/spawn <任务描述>` | 在当前工作区创建并行任务                      |
| `/model`         | -                   | 打开当前工作区模型选择器                      |
| `/effort`        | -                   | 打开当前工作区思考强度选择器；仅 `codex` 支持 |

说明：

- `/model` 与 `/effort` 都是“当前工作区级”设置，会持久化到工作区 runtime 配置。
- 当工作区未显式设置 `codex` 的模型或思考强度时，`/status`、选择卡、dispatch 与 footer fallback 会统一继承 backend 解析出的 Codex CLI fallback（环境变量与 `~/.codex/config.toml`），避免不同入口看到不同值。
- `codex` 的 `/model` 选项在 IM / Feishu / Web 入口会优先执行宿主机 `codex debug models` 获取当前 CLI catalog；命令不可用、超时或返回异常时，才依次回退到 `~/.codex/models_cache.json` 与内置 preset。若当前 effective model 不在 catalog 中，选择器仍会把它作为当前值展示，避免 `/status` 与 `/model` 不一致。
- 普通回复 footer 会始终保留基础 runtime 信息（时长 / Agent 类型 / 模型 / 推理强度）；只有当前 `5h < 20%` 或 `week < 10%` 时，才会额外追加 `5h` / `week` remaining 百分比。
- 任务类回复会在正文末尾追加一行最小化 milestone 进度，来源于当前工作区 `PLANS/ACTIVE.md`；已完成 milestone 用 `✓` 标记。
- `/help` 现在只展示“当前入口 + 当前 runtime”真正可执行的命令列表，不再夹带状态摘要；若当前工作区存在已声明且适用于当前入口的 skill command，也会一并展示。
- Web 输入框只在输入 bare `/model` 或 `/effort` 时展示选择 UI；飞书会返回对应的选择卡；不再默认在普通回复卡片 footer 常驻下拉。
- `claude` 不支持 `reasoning_effort`；在该 runtime 下执行 `/effort` 会返回明确提示。
- 历史的 `/model <preset>` / `/effort <preset>` 参数式交互不再作为用户命令保留。

## Skill Command

skill command 通过 skill 根目录下的 `commands.json` 声明。当前分发约定如下：

- 先搜索当前工作区 `.claude/skills/`，再搜索用户级同步 skill 目录；项目内 skill 可以覆盖用户级同名声明。
- 若多个 skill 在同一搜索优先级上声明了相同命令，命令不会静默二选一，而是直接返回冲突提示。
- executor 通过 stdin 接收 JSON payload，并通过 stdout 返回 JSON 结果。
- 结果类型目前支持：
  - `final_markdown`：本地直接返回最终文本
  - `assistant_prompt`：把命令改写成一段普通用户消息，再继续走 Agent 主流程

这层协议只负责“发现 + 执行 + 回填结果”，不承载任何业务特定语义。

## IM 专属命令

以下命令仅在 IM 入口可用：

| 命令                            | 别名  | 作用                                                                 |
| ------------------------------- | ----- | -------------------------------------------------------------------- |
| `/list`                         | `/ls` | 查看当前用户可访问的工作区与对话列表                                 |
| `/status`                       | -     | 查看当前工作区、运行状态、当前 runtime 摘要与当前 Codex 5h / 7d 余额 |
| `/autopilot on\|off\|status`    | -     | 开启、关闭或查看当前工作区主动模式                                   |
| `/self-status`                  | -     | 查看 cli-claw 服务版本、自检状态、restartability 与当前重启命令      |
| `/self-check`                   | -     | 隔离启动候选服务做冷启动健康检查，不重启当前服务                     |
| `/self-restart`                 | -     | 创建自重启 intent，并交给独立 watchdog 执行                          |
| `/recall`                       | `/rc` | 汇总当前工作区最近消息并生成回顾摘要                                 |
| `/where`                        | -     | 查看当前 IM 会话绑定到了哪个工作区 / Agent                           |
| `/bind <workspace>`             | -     | 将当前 IM 会话绑定到指定工作区                                       |
| `/bind <workspace>/<agent短ID>` | -     | 将当前 IM 会话绑定到指定工作区下的 conversation agent                |
| `/unbind`                       | -     | 解除绑定，回到默认工作区                                             |
| `/new <名称>`                   | -     | 创建新工作区并把当前 IM 会话绑定过去                                 |
| `/require_mention true`         | -     | 群聊里只有被 @ 时才响应                                              |
| `/require_mention false`        | -     | 群聊里不需要 @ 也会响应                                              |

说明：

- `/status` 会以 “Agent” 与 “运行状态” 两段展示当前 runtime 摘要（Agent
  类型、模型、推理强度）、当前 Codex 5h / 7d
  余额、当前工作区、当前会话、会话数、队列负载、服务进程 cwd，以及当前工作区主动模式状态。
- Feishu 入口的 `/status` 还会附加最近 Feishu 消息链路事件；当存在最近非 ok 事件时，会单独显示一行紧凑的“飞书异常”，避免投递失败或跳过原因被后续正常事件盖掉。
- Codex 余额读取自本机 `~/.codex/sessions/**/*.jsonl` 的最新 usage 快照；当前 runtime 不是 `codex` 或本地快照不可用时，对应余额会显示 `unavailable` / `unknown`。
- `/autopilot` 只作用于当前工作区；实现形态是一个受控的低优先级后台 interval run，不会创建一个永久存活的独立 agent 进程，也不会把主动模式 prompt 当作普通用户消息写入主对话。
- 主动模式在执行前会让路给真实用户/IM 消息和已活跃的工作区 runner；运行中若收到用户消息，会请求后台 run 尽快收尾，再处理真实消息。无实质进展的 no-op 结果只写任务日志，不发送用户可见回复。
- `/autopilot on` 后若当前 `5h < 20%` 或 `week < 10%`，主动模式会立即进入“已因额度不足暂停”；后续由 scheduler 在 quota 恢复后自动恢复。
- `/self-status` 与 `/self-check` 仅管理员可用，用于服务自迭代排障；`/self-status` 会直接展示当前 backend 解析到的 self-restart launch source 和精确命令，便于判断当前进程是否真的可安全重启；若当前是 `direct_backend` 开发直启路径，还会提示长期运行推荐使用 `cli-claw start` / `cli-claw restart`，并在存在最近非 ok Feishu lifecycle 事件时追加全局“飞书异常”摘要。`/self-check` 会复用当前 backend 捕获的 authoritative launch spec，用隔离 `HOME` 和临时 `WEB_PORT` 启动候选 backend 并检查 `/api/health`，结果会展示候选命令，不会停止或重启当前服务。
- `/self-restart` 仅管理员可用；backend 只会在当前 launch spec 已通过结构校验时写入 restart intent 并启动独立 watchdog。若当前进程的启动命令不安全或不完整（例如只剩 `bun` 空参数），命令会直接失败，不会生成一个注定错误的 intent。watchdog 会先做 shadow self-check，通过后才停止旧 PID、启动同一启动命令并检查生产端口 `/api/health`。它不是 blue-green/rollback 机制，结果以 `~/.cli-claw/ops/restarts/*.json` 为准；重启成功后，新进程会向发起命令的 IM 会话补发一条成功回执，附带当前服务状态和残留进程检查摘要。若摘要里发现真正孤儿的 runner residue，服务会优先按孤儿 runner 进程组发送 `SIGTERM`，必要时再回退到单个 PID 的 best-effort 清理；普通 backend 启动时也会对残留孤儿 runner 执行同一套 best-effort 清理。
- 对“飞书里让 agent 自己重启 cli-claw 项目”这类场景，不要在任务里直接执行 `pkill` / `kill` / `launchctl bootout` 之类的停机命令；应改用外部 shell 的 `cli-claw restart` 或 IM `/self-restart`，让重启继续走同一条 safe intent/watchdog 路径。
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

Web 输入框与 agent tab 直接识别统一命令注册表中的 Web 可用命令：

- `/help`
- `/clear`
- `/sw`
- `/spawn`
- `/model`
- `/effort`

如果在 Web 输入框输入了已知但当前入口不可用的命令（例如 `/bind`），系统会直接返回明确提示，而不会把它当普通消息交给 Agent。
当输入 `/model` 或 `/effort` 时，输入框上方会展示对应选项；点击后由前端发送实际切换命令。

如果 Web 输入的是已声明的 skill command，系统会先执行 skill executor；若 skill 返回 `assistant_prompt`，前端会把该 prompt 作为本次真正入库并发给 Agent 的用户消息内容。

## 运行时相关命令

### `/model`

- `claude` 预设：
  - `opus[1m]`
  - `opus`
  - `sonnet[1m]`
  - `sonnet`
  - `haiku`
- `codex` 选项：
  - 优先来自当前宿主机 `codex debug models` 的实时 catalog。
  - CLI catalog 不可用时回退到 `~/.codex/models_cache.json`。
  - cache 也不可用时才使用内置 preset。
  - `/model` 文本回复会同时返回当前模型与可用模型。

### `/effort`

- 仅 `codex` 支持。
- 当前工作区 runtime 不支持时，命令会返回明确提示，不会静默忽略。

## 备注

- `/sw` 与 `/spawn` 是同义命令。
- `/bind` 目标里的 `agent短ID` 指 conversation agent 的短标识，不是工作区 folder。
- `claude` 的 `/model` 可用值以运行时命令注册表为准；`codex` 的 `/model` 在 backend 入口优先使用本机 Codex CLI 实时 catalog，本文档不枚举动态列表。
