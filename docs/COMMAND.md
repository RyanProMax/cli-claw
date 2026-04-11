# COMMAND

> 本文负责：统一命令注册表的行为、入口差异，以及命令与 runtime 的关系。工作流协议和工程规则见 `AGENTS.md` 与 `docs/ENGINEERING.md`。

## 概览

Cli Claw 的“命令”分成两层：

- 服务 launcher 命令：安装 `cli-claw-kit` 后，在 shell 里直接执行 `cli-claw ...`
- 应用内命令：服务启动后，在 Web / IM 里输入 slash command

统一命令注册表只覆盖第二层应用内命令；`cli-claw start` / `help` / `version` 不走 runtime command registry。

## 服务 Launcher 命令

以下命令由 npm 包 `cli-claw-kit` 安装后的 `cli-claw` 二进制直接处理：

| 命令 | 别名 | 作用 |
| --- | --- | --- |
| `cli-claw start` | - | 启动主服务，并把当前 shell 目录作为 host 工作区默认启动目录 |
| `cli-claw help` | `cli-claw -h` / `cli-claw --help` | 查看 launcher 帮助 |
| `cli-claw version` | `cli-claw -v` / `cli-claw --version` | 输出已安装版本 |

说明：

- launcher 命令发生在服务外部，不会路由到任何工作区。
- `cli-claw start` 会先校验当前目录是否符合 host allowlist，再为缺失 `custom_cwd` 的 host 工作区物化默认值。
- 这些命令与下文的 `/help`、`/model`、`/clear` 等应用内命令不是同一层协议。

## 应用内命令概览

Cli Claw 维护一份统一命令注册表，作为以下入口的单一事实源：

- IM slash command 分发
- Web 输入框命令识别
- `/help` 输出
- 本文档

命令最终是否可用，取决于：

- 当前入口：`im` / `web`
- 当前工作区 runtime：`claude` / `codex`

因此 `/help` 不是静态文档回显，而是按“当前入口 + 当前工作区 runtime”动态输出真正可执行的命令列表。

任何以 `/` 开头、并被入口识别为 slash command 候选的输入，都会在本地命令分发层直接消费：

- 已知命令：返回 hardcode / 本地 handler 结果
- 当前入口不可用的命令：返回明确提示
- 未知命令：返回“不支持的命令”

这些 slash command 都不会再回落给 Agent 当作普通消息处理。

## 全局可用命令

以下命令在 IM 与 Web 都可直接识别：

| 命令 | 别名 | 作用 |
| --- | --- | --- |
| `/help` | - | 查看当前入口、当前 runtime 下真正可用的命令 |
| `/clear` | - | 清除当前工作区或当前绑定 Agent 的会话上下文 |
| `/sw <任务描述>` | `/spawn <任务描述>` | 在当前工作区创建并行任务 |
| `/model` | - | 打开当前工作区模型选择器 |
| `/effort` | - | 打开当前工作区思考强度选择器；仅 `codex` 支持 |

说明：

- `/model` 与 `/effort` 都是“当前工作区级”设置，会持久化到工作区 runtime 配置。
- `/help` 现在只展示“当前入口 + 当前 runtime”真正可执行的命令列表，不再夹带状态摘要。
- Web 输入框只在输入 bare `/model` 或 `/effort` 时展示选择 UI；飞书会返回对应的选择卡；不再默认在普通回复卡片 footer 常驻下拉。
- `claude` 不支持 `reasoning_effort`；在该 runtime 下执行 `/effort` 会返回明确提示。
- 历史的 `/model <preset>` / `/effort <preset>` 参数式交互不再作为用户命令保留。

## IM 专属命令

以下命令仅在 IM 入口可用：

| 命令 | 别名 | 作用 |
| --- | --- | --- |
| `/list` | `/ls` | 查看当前用户可访问的工作区与对话列表 |
| `/status` | - | 查看当前工作区、运行状态与绑定信息摘要 |
| `/usage` | - | 查看 Codex 与 Claude 的 5h / 7d 用量余额 |
| `/recall` | `/rc` | 汇总当前工作区最近消息并生成回顾摘要 |
| `/where` | - | 查看当前 IM 会话绑定到了哪个工作区 / Agent |
| `/bind <workspace>` | - | 将当前 IM 会话绑定到指定工作区 |
| `/bind <workspace>/<agent短ID>` | - | 将当前 IM 会话绑定到指定工作区下的 conversation agent |
| `/unbind` | - | 解除绑定，回到默认工作区 |
| `/new <名称>` | - | 创建新工作区并把当前 IM 会话绑定过去 |
| `/require_mention true` | - | 群聊里只有被 @ 时才响应 |
| `/require_mention false` | - | 群聊里不需要 @ 也会响应 |

说明：

- `/status` 会同时展示系统队列状态、当前工作区定位，以及 runtime 摘要（当前模型、思考强度、可用预设）。
- `/usage` 是本地查询命令，不进入 agent 对话链路；Codex 数据来自本机 `~/.codex/sessions/**/*.jsonl` 的最新 usage 快照，Claude 数据来自已启用 OAuth provider 的 usage API，任一侧不可用时会在对应 section 内展示 `unavailable` 与原因。

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

## 运行时相关命令

### `/model`

- `claude` 预设：
  - `opus[1m]`
  - `opus`
  - `sonnet[1m]`
  - `sonnet`
  - `haiku`
- `codex` 预设：
  - `gpt-5.4`
  - `gpt-5.4-mini`
  - `gpt-5.3-codex`
  - `gpt-5.2`

### `/effort`

- 仅 `codex` 支持。
- 当前工作区 runtime 不支持时，命令会返回明确提示，不会静默忽略。

## 备注

- `/sw` 与 `/spawn` 是同义命令。
- `/bind` 目标里的 `agent短ID` 指 conversation agent 的短标识，不是工作区 folder。
- `/model` / `/effort` 的真实可用值以运行时命令注册表为准；本文档只同步当前内置 preset。
