# CONTEXT

## GROUPS

- `groups` 不是“聊天分组”而是工作区注册表。数据库里的 `registered_groups` 每一条记录都描述一个工作区入口：它有 `jid` 作为唯一入口 ID，有 `folder` 作为磁盘目录键，有 `agentType`、`executionMode`、成员归属和消息路由配置。
- 区分工作区主要看三层：
  - `jid`：对外 API 和消息入口标识。典型值如 `web:main`、`web:home-{userId}`、第三方 IM 群 JID。
  - `folder`：把多个入口映射到同一个实际工作区目录。磁盘路径通常是 `~/.cli-claw/groups/{folder}`。
  - `is_home`：标记“主工作区”。主工作区不是另一种存储结构，而是一个带特殊权限和消息合并语义的 group。
- 因此“怎么区分工作区”本质上不是靠名字，而是靠 `(jid, folder, is_home, created_by)` 这组元数据：
  - 不同 `folder` 一定是不同工作区。
  - 同一 `folder` 下可以有多个 `jid`，表示多个入口共用同一个工作区。
  - `is_home=true` 表示该入口是用户主工作区入口，会触发主工作区专属规则。

## 工作区类型

- 主工作区：
  - 每个用户都有一个 home group。
  - admin 共用 `web:main` / `folder=main`，默认 `host`。
  - member 使用 `web:home-{userId}` / `folder=home-{userId}`，默认 `container`。
  - 主工作区消息会按 `folder` 合并同工作区下的兄弟入口消息，但仍受 `created_by` 约束，避免串号。
- 普通工作区：
  - 通常是用户手动创建的 `web:{folder}` 工作区。
  - 它们有独立 `folder`，可以单独配置 `agentType`、`executionMode`、成员与 MCP。
- IM 入口工作区：
  - 飞书/Telegram 等入口也会注册成 group。
  - 如果它们与某个 `web:*` group 共享同一个 `folder`，那它们不是独立项目，而是同一工作区的另一个消息入口。
- `user-global`：
  - 这不是普通 group 记录，而是用户级全局记忆目录 `~/.cli-claw/groups/user-global/{userId}`。
  - 它服务于跨工作区长期记忆，不参与工作区列表和聊天路由。

## 执行模型

- 工作区分 `host` 与 `container` 两种执行模式；`codex` 仅允许 `host`。
- `folder` 决定工作区文件根，`executionMode` 决定这个根如何被执行：
  - `container`：实际运行在容器里，默认工作区目录是 `~/.cli-claw/groups/{folder}`。
  - `host`：直接在宿主机执行；如果配置了 `customCwd`，运行根可落到外部目录，但 group 记录、会话、记忆和路由仍归属于原 `folder`。
- 主工作区的执行模式带角色约束：admin home 固定 `host`，member home 固定 `container`。

## 记忆模型

- 项目内部长期记忆统一使用 `AGENTS.md`：
  - 用户全局记忆：`~/.cli-claw/groups/user-global/{userId}/AGENTS.md`
  - 工作区记忆：`~/.cli-claw/groups/{folder}/AGENTS.md`
  - 时效性记忆：`~/.cli-claw/memory/{folder}/YYYY-MM-DD.md`
  - 对话归档：`~/.cli-claw/groups/{folder}/conversations/`
- `.claude/` 与 `~/.claude/CLAUDE.md` 属于外部 Claude 运行时契约，不参与本项目内部记忆改名。

## 持久化边界

- 用户隔离优先：非 admin 只能访问自己的工作区、自己的 user-global 和授权共享工作区。
- `groups/{folder}` 是工作区内容边界，`registered_groups` 是工作区入口边界；多个入口可以共享一个 `folder`，但不等于多个独立工作区。
- `.claude/` 下的 settings / skills / rules 是运行时配置，不等同于项目内部记忆。
- 修改消息路由、执行模式、Memory 路径、MCP 工具名或 docs 入口时，要同步更新 `AGENTS.md` 和对应 docs。
