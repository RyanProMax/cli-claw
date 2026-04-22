# CONTEXT

> 本文负责：工作区身份、记忆路径、持久化布局和权限边界。运行时矩阵与 `agentType` / `executionMode` 规则见 `docs/RUNTIME.md`。

## 工作区身份

- `groups` 不是“聊天分组”，而是工作区注册表。数据库里的 `registered_groups` 每一条记录都描述一个工作区入口：它有 `jid` 作为唯一入口 ID，有 `folder` 作为磁盘目录键，有成员归属和消息路由配置。
- 区分工作区主要看四个字段：
  - `jid`：对外 API 和消息入口标识，例如 `web:main`、`web:home-{userId}`、第三方 IM 群 JID。
  - `folder`：把多个入口映射到同一个实际工作区目录，磁盘路径通常是 `~/.cli-claw/groups/{folder}`。
  - `is_home`：标记该入口是否是用户主工作区入口。
  - `created_by`：标记归属用户，用于权限与消息隔离。
- 对 host 工作区来说，`customCwd` 还描述了外部执行 / 文件根目录；它不等于 `folder`，也不改变平台存储目录。

## 工作区类型

- 主工作区：
  - 每个用户都有一个 home group。
  - admin 共用 `web:main` / `folder=main`。
  - member 使用 `web:home-{userId}` / `folder=home-{userId}`。
- 普通工作区：
  - 通常是用户手动创建的 `web:{folder}` 工作区。
  - 它们有独立 `folder`，但仍共享同一套注册表和权限模型。
- IM 入口工作区：
  - 飞书、Telegram、QQ、钉钉、企业微信等入口也会注册成 group。
  - 若它们与某个 `web:*` group 共享同一个 `folder`，表示多个入口共用同一个工作区，而不是多个独立项目。
- `user-global`：
  - 这不是普通 group 记录，而是用户级全局记忆目录 `~/.cli-claw/groups/user-global/{userId}`。

## 会话层级与 IM 绑定

Cli Claw 的会话关系按四层理解：

- Channel：飞书、微信、Telegram、Web 等入口，只负责接收消息和回消息。
- Workspace：由 `folder` 标识的工作区，决定文件、记忆、消息归属和默认主会话。
- Conversation：同一个 workspace 下可以有多个对话：
  - 主对话：workspace 自带的默认对话，runtime session 以 `(folder, 空 agent_id)` 记录。
  - Conversation agent：用户在 Web 内创建的独立对话，记录在 `agents` 表，`kind='conversation'`，消息使用虚拟 JID `{workspaceJid}#agent:{agentId}`，runtime session 以 `(folder, agent_id)` 记录。
- Runner：当前正在执行的一次底层 CLI 进程或容器。runner 是临时执行体，不是长期会话本身。

IM 入口自身也会有一条 `registered_groups` 记录。默认情况下，新接入的 IM chat 会挂到该用户的 home workspace；如果通过 `/bind` 或 Web 绑定面板设置了目标，则消息会改路由到目标：

- `target_main_jid`：绑定到某个 workspace 的主对话。
- `target_agent_id`：绑定到某个 workspace 下的 conversation agent。
- 解除绑定后，IM chat 回到自身默认 workspace/folder。

因此，多个 channel 是否共享上下文，不看 channel 类型，而看它们是否最终路由到同一个 conversation identity：

- 飞书和微信都指向同一个 workspace 主对话时，共享同一个主会话上下文。
- 飞书指向 workspace 主对话、微信指向同 workspace 的某个 conversation agent 时，二者共享工作区文件和记忆，但对话消息与 runtime session 相互独立。
- 微信执行 `/new <名称>` 时，会创建新 workspace，并只把当前微信 chat 绑定到新 workspace 的主对话；飞书等其他 channel 的绑定不自动改变。

## 记忆与持久化布局

- 项目内部长期记忆统一使用 `AGENTS.md`：
  - 用户全局记忆：`~/.cli-claw/groups/user-global/{userId}/AGENTS.md`
  - 工作区记忆：`~/.cli-claw/groups/{folder}/AGENTS.md`
  - 时效性记忆：`~/.cli-claw/memory/{folder}/YYYY-MM-DD.md`
  - 对话归档：`~/.cli-claw/groups/{folder}/conversations/`
- 服务级持久化根目录仍固定为 `~/.cli-claw`，包括数据库、sessions、logs、downloads、memory 和 `groups/{folder}` 元数据目录。
- 外部运行时契约细节见 `docs/RUNTIME.md`；它们不参与本项目内部记忆命名。
- 工作区若配置了 `customCwd`，实际执行目录可落到外部路径，但 group 记录、会话、记忆和消息路由仍归属于原 `folder`。

## Host 工作区 cwd 约定

- `customCwd` 是 host 工作区的执行 / 文件根目录字段，字段名保持不变。
- `cli-claw start`（由仓库自带 / 同名 `cli-claw` launcher 提供）会把启动命令所在目录校验后物化到所有缺失 `customCwd` 的 host 工作区，避免运行时依赖隐式全局 fallback。
- 同一个 `folder` 下的非 home 入口，如果自身未单独覆盖，会沿用 sibling home workspace 的有效 host cwd。
- 即使 host 工作区把执行根目录指向外部仓库，持久化归属仍然按 `folder` 键控，留在 `~/.cli-claw`。

## 执行协议文件

- 仓库级执行协议放在 tracked 文件里：
  - `AGENTS.md`
  - `PLANS/_TEMPLATE.md`
  - `RUNBOOKS/*.md`
  - `.codex/agents/*.md`
- 本地 active plan 统一使用 `PLANS/ACTIVE.md`，它是复杂任务执行期间的单一真相源，默认不入库。
- `docs/.local/PLAN.md` 若有人自行创建，只能视为个人草稿，不再是正式执行协议的一部分。

## 持久化与权限边界

- 用户隔离优先：非 admin 只能访问自己的工作区、自己的 `user-global` 和授权共享工作区。
- `groups/{folder}` 是工作区内容边界，`registered_groups` 是工作区入口边界；多个入口可以共享一个 `folder`，但不等于多个独立工作区。
- `customCwd` 只影响 host 执行 / 文件访问根目录，不改变工作区存储 ownership，也不改变 DB / session / memory 的落盘位置。
- `.claude/` 与 `~/.codex/` 下的 settings / skills / config 是运行时配置，不等同于项目内部记忆。
- `.codex/agents/` 是仓库内受版本控制的 Codex 工作流角色定义，属于执行协议，不是项目记忆文件。
- 修改消息路由、工作区路径、记忆布局或 docs 入口时，要同步更新 `AGENTS.md` 和相关 owner 文档。
