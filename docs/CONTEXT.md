# CONTEXT

## 执行模型

- 工作区分 `host` 与 `container` 两种执行模式；`codex` 仅允许 `host`。
- 每个用户都有一个 `is_home=true` 的主工作区。admin 主工作区默认 `main`，member 主工作区默认 `home-{userId}`。
- `data/groups/{folder}` 是项目内工作区；host + `customCwd` 时，工作区根可落到外部目录，但仍沿用项目内部记忆约定。

## 记忆模型

- 项目内部长期记忆统一使用 `AGENTS.md`：
  - 用户全局记忆：`data/groups/user-global/{userId}/AGENTS.md`
  - 工作区记忆：`data/groups/{folder}/AGENTS.md`
  - 时效性记忆：`data/memory/{folder}/YYYY-MM-DD.md`
  - 对话归档：`data/groups/{folder}/conversations/`
- 启动时会把旧 `CLAUDE.md` 一次性迁移到 `AGENTS.md`；若同目录已存在 `AGENTS.md`，则以新文件为准。
- `.claude/` 与 `~/.claude/CLAUDE.md` 属于外部 Claude 运行时契约，不参与本项目内部记忆改名。

## 持久化边界

- 用户隔离优先：非 admin 只能访问自己的工作区、自己的 user-global 和授权共享工作区。
- `.claude/` 下的 settings / skills / rules 是运行时配置，不等同于项目内部记忆。
- 修改消息路由、执行模式、Memory 路径、MCP 工具名或 docs 入口时，要同步更新 `AGENTS.md` 和对应 docs。
