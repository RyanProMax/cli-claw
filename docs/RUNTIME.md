# RUNTIME

> 本文负责：运行时矩阵、`agentType` / `executionMode` 约束、runtime identity，以及外部运行时契约。工作区与持久化边界见 `docs/CONTEXT.md`。

## 概览

Cli Claw 不把某一个 SDK 写死在主进程里。主进程负责多用户隔离、消息路由、队列和持久化；真正的 Agent 会话由 `container/agent-runner/` 按工作区运行时配置调用底层 CLI runtime。

服务进程本身由外部 launcher `cli-claw start` 启动；launcher 负责参数分发，backend bootstrap 在 `src/index.ts` 中单独导出。

## 运行时矩阵

| `agentType` | 底层运行时 | 支持执行模式 | 当前认证方式 | 备注 |
| --- | --- | --- | --- | --- |
| `claude` | Claude Agent SDK + Claude Code CLI | `host` / `container` | Web 向导配置 Claude Provider（OAuth / setup-token / API Key） | 容器镜像当前只内置这条运行时 |
| `codex` | Codex CLI + `codex-acp` | `host` | 宿主机执行 `codex login` | 不支持 `container` |

## 选择规则

- 工作区的 `agentType` 决定底层 CLI runtime。
- 工作区的 `executionMode` 决定 runtime 在宿主机还是 Docker 中运行。
- 工作区 runtime 配置统一包括：
  - `agentType`
  - `executionMode`
  - `model`
  - `reasoningEffort`
- `codex` 会被强制约束到 `host`。
- admin 主工作区默认 `host`；member 主工作区默认 `container`。
- `cli-claw start` 会先校验启动目录是否满足 host allowlist，再把该目录物化到缺失 `customCwd` 的 host 工作区。

## 工作区级 runtime 优先级

运行时参数按以下顺序生效：

1. 工作区显式设置的 `model` / `reasoningEffort`
2. runtime 默认配置
3. CLI / provider 自身默认值

约束：

- `model` 采用 preset-only 约束，不做动态发现。
- `reasoningEffort` 只有支持该能力的 runtime 才会真正下发。
- 不支持 `reasoningEffort` 的 runtime 会忽略该字段，但 `model` 仍可独立生效。
- 非主工作区若继承同 folder 的 home workspace runtime，则会沿用该 home workspace 的 `agentType` / `executionMode` / `model` / `reasoningEffort`。

## Host 工作目录解析

host 相关消费者统一使用同一份 effective cwd contract：

1. 工作区自身显式设置的 `customCwd`
2. 同 folder 的 sibling home workspace 的 `customCwd`
3. 不再依赖隐式内存 fallback；缺失值应在 `cli-claw start` 阶段被物化

该 cwd 必须是绝对路径、已存在目录，并在配置了 mount allowlist 时落在允许根目录内。

这个 contract 会被 host runtime 执行、文件 API、工作区 `.claude/` 配置根目录、脚本任务和 agent 任务共同使用。

## 运行时身份

每次助手回复都尽量携带一份 `runtime_identity`：

- `agentType`
- `model`
- `reasoningEffort`
- `supportsReasoningEffort`

这份元数据会沿着 runner -> backend -> DB / WebSocket -> Web / IM 卡片 一路透传，用于：

- Web 消息 footer
- 飞书卡片 footer
- usage 晚到后的 footer 补写 / patch
- run log / dispatch log 排障
- 区分“请求的运行时”和“实际执行的运行时”

## 外部运行时契约

项目内部长期记忆统一使用 `AGENTS.md`，但外部 CLI runtime 仍保留各自原生约定：

- `~/.cli-claw/sessions/{folder}/.claude/`
  - Claude Runtime 的隔离会话目录
- `~/.claude/.credentials.json`
  - Claude Runtime 的本地登录态来源之一
- `~/.codex/config.toml`
  - Codex Runtime 的模型 / reasoning effort 配置
- `codex login`
  - Codex Runtime 的宿主机登录态

仓库内还可以追踪与 Codex 工作流相关的角色文件，例如 `.codex/agents/*.md`。这些文件属于仓库执行协议，不等同于 `~/.codex/` 下的用户级配置。

应用包根目录从已安装模块位置解析；launch cwd 只参与 host 工作区默认执行目录的物化，不参与后端 build、web build 或 shared 资源定位。

## 运行时变更约束

- 新增或修改运行时时，必须同步更新相关 owner 文档，尤其是 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/CONTEXT.md`、`docs/MODULE.md` 和本文档。
- 不要把项目内部长期记忆文件重新命名回 `CLAUDE.md`；项目内统一记忆入口仍是 `AGENTS.md`。
- 不要把某个运行时的专属约定误写成系统级通用规则。
