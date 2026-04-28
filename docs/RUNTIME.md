# RUNTIME

> 本文负责：运行时矩阵、`agentType` / `executionMode` 约束、runtime identity、host cwd 和外部运行时契约。工作区 / conversation 身份见 `docs/ARCHITECTURE.md`；记忆机制见 `docs/MEMORY.md`。

## 概览

Cli Claw 不把某一个 SDK 写死在主进程里。主进程负责多用户隔离、消息路由、队列和持久化；真正的 Agent 会话由 `container/agent-runner/` 按工作区运行时配置调用底层 CLI runtime。

服务进程本身由外部 launcher `cli-claw start` 启动；源码仓库与同名 `cli-claw` 发布包复用同一个 launcher 入口，负责参数分发，backend bootstrap 在 `src/index.ts` 中单独导出。源码仓库的 `bun start` / `npm start` 会委托到 `bun src/cli.ts start`，因此仍属于 launcher 入口；`bun src/index.ts` 只用于 direct backend 调试。

## 服务自检与 Shadow Start

`/self-status`、`/self-check` 和 `/self-restart` 用于通过正在运行的 Cli Claw 检查仓库自身迭代风险：

- `/self-status` 输出当前 backend PID、启动时间、cwd、已加载 build 与磁盘 build 是否一致，以及最近一次 `/self-check` 结果。若当前 backend 由 TypeScript source launcher 启动，build 摘要会明确标注源码运行，dist build 只作为打包参考；agent-runner build stale 仍会保留为需要处理的运行风险。
- `/self-status` 还会输出当前进程解析出的 self-restart launch spec：是否可安全自重启、launch source，以及 watchdog/launchd 将复用的精确启动命令。
- `/self-check` 复用 backend 启动时捕获的 authoritative launch spec 启动候选 backend，并用临时 `WEB_PORT` 轮询候选服务的 `/api/health`；结果会展示实际候选命令，便于确认自检目标与当前服务启动入口一致。
- 候选进程会使用隔离 `HOME`，因此数据目录落在临时 `~/.cli-claw`，不会写入生产 `~/.cli-claw`。
- 候选进程会带上 `CLI_CLAW_SELF_CHECK=1`；backend 在该模式下启动 Web/API、DB 和队列基础能力，但跳过 CLI launch cwd 校验、host workspace 默认 cwd 物化和 IM channel 连接，避免临时 HOME 的 allowlist 影响自检，也避免和线上飞书/微信/Telegram/QQ/钉钉连接抢占。
- `/self-check` 只验证“当前 build 能否冷启动并健康”，不会停止当前服务，也不会切换端口或执行真实重启。
- `/self-restart` 不在 backend 进程内重启自身；它写入 `~/.cli-claw/ops/restarts/*.json` intent，并启动独立 watchdog 进程。watchdog 先执行 shadow self-check；失败时不停止当前服务；通过后才停止旧 PID、按同一启动命令启动新进程，并轮询生产端口 `/api/health`。
- `/self-restart` 使用一份在 backend 启动时捕获并校验过的 authoritative launch spec；若当前进程无法解析出安全的启动命令（例如 argv 缺失 entrypoint、只剩 `bun` 空参数、或明显不是 Cli Claw 入口），命令会直接拒绝受理，而不是写出一个注定重启失败的 intent。
- backend 启动时还会把当前 PID、端口、validated launch spec，以及可选的 `launchd` service name 持久化到 `~/.cli-claw/ops/current-backend.json`；外部 `cli-claw restart` 会复用这份状态发起同一条 safe self-restart，而不是从调用方自己的 argv 反推启动命令。
- 成功的 `/self-restart` intent 会记录发起它的 IM 会话；新进程启动并重新连上 IM 后，会向该会话补发一条“自重启成功”消息，附带当前服务状态与一次 best-effort 残留进程检查结果。
- 若残留检查发现真正的孤儿 runner（`agent-runner` / `codex-acp` 链条已脱离 backend，表现为 `ppid = 1` 或父 PID 不存在），新进程会 best-effort 发送 `SIGTERM` 清理；正常挂在当前 backend 下的 runner 链不会被触碰。
- 若当前服务由 repo 提供的 LaunchAgent 启动，并带有 `CLI_CLAW_LAUNCHD_SERVICE_NAME`，watchdog 在 preflight 通过后不会再手工 `spawn` 一个脱离 supervisor 的 replacement，而是执行 `launchctl kickstart -k <service>`，让 `launchd` 保持拥有者身份并继续负责后续兜底重拉。

`/self-restart` 不是 blue-green 或 rollback 机制。它能避免“preflight 失败还杀旧进程”的 badcase，但不能保证源码/二进制级回滚；更强的生产发布仍应使用 release 目录、symlink 或系统级 supervisor。

对于本机长期运行，推荐再叠一层用户级 supervisor：仓库提供 `ops/install-launch-agent.sh` 来安装/查看/卸载一个 `launchd` LaunchAgent。该 LaunchAgent 默认使用 `cli-claw start`，也可以通过 `-- COMMAND [ARGS...]` 显式复用 `/self-status` 暴露的 validated launch command；不要另起一套不同的启动脚本。安装脚本会把当前 shell 的 PATH 连同常见 Homebrew / Bun bin 目录一起写入 plist，避免 launchd 默认 PATH 丢失 `node` / `npx` / `codex` 这类宿主机 runtime 依赖，同时注入 `CLI_CLAW_LAUNCHD_SERVICE_NAME` 供 watchdog 在自重启时回到 `launchd` 管理。

## 运行时矩阵

| `agentType` | 底层运行时                         | 支持执行模式         | 当前认证方式                                                  | 备注                                                                          |
| ----------- | ---------------------------------- | -------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `claude`    | Claude Agent SDK + Claude Code CLI | `host` / `container` | Web 向导配置 Claude Provider（OAuth / setup-token / API Key） | 容器镜像当前只内置这条运行时                                                  |
| `codex`     | Codex CLI + `codex-acp`            | `host`               | 宿主机执行 `codex login`                                      | 不支持 `container`；host preflight 会区分“CLI 不在服务 PATH 中”与“CLI 未登录” |

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
2. 对 `codex` 而言，backend 会显式读取与 runner 相同的用户级 / 进程级 fallback：
   - `OPENAI_MODEL` / `CODEX_MODEL`
   - `OPENAI_REASONING_EFFORT` / `CODEX_REASONING_EFFORT` / `REASONING_EFFORT`
   - `~/.codex/config.toml` 中的 `model` / `model_reasoning_effort`（或 `reasoning_effort`）
3. runtime 默认配置
4. CLI / provider 自身默认值

约束：

- `claude` 的 `model` 仍采用 preset-only 约束。
- `codex` 的 `model` 在 backend 侧优先通过宿主机 `codex debug models` 读取当前 CLI 实时 catalog；若 CLI 不可用、超时或返回异常，再回退到 `~/.codex/models_cache.json`，最后回退到内置 preset。
- `/model` 选择器和命令回复会把 effective runtime identity 中的当前模型一起传入选项构造；当当前模型不在实时 catalog 中时，它仍会作为当前值展示，避免状态摘要、选择器和 dispatch fallback 互相矛盾。
- backend 会先把上述优先级物化成一份 effective runtime identity；`/status`、`/model` / `/effort` 选择卡、runner dispatch 和 footer fallback 都必须读取这同一份结果，不能让 Codex CLI 全局配置只影响 runner/footer 而不影响 `/status`。
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

`customCwd` 只影响 host 执行和文件访问根目录，不改变工作区 ownership，也不改变数据库或 session 在 `~/.cli-claw` 下按 `folder` 归属的持久化位置。

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

backend 在启动 runner 前会把 effective runtime identity 中的 `model` 与 `reasoningEffort` 写入 runner input。对 Codex，这份 effective identity 还会显式纳入用户级 `~/.codex/config.toml` / 相关环境变量 fallback；这样 workspace 未显式设置时，`/status`、选择卡、dispatch 和 footer fallback 仍会保持一套值。若 runner 返回了实际 `runtime_identity`，仍以 runner 返回值为最终记录。

## 会话与 Runner 对应关系

外层 channel、workspace conversation、底层 runtime session 和 runner 不是同一个概念：

- 外层 channel 是消息入口，例如飞书或微信。
- Workspace conversation 是 Cli Claw 的对话身份，由 `folder` 加可选 `agentId` 决定。
- Runtime session 是 Claude/Codex 自己的会话 ID，持久化在 `sessions` 表。主对话所有 channel 共用 `(folder, 空 agent_id)`；conversation agent 使用 `(folder, agent_id)`。
- Runner 是正在处理消息的底层 CLI 进程或容器，只在执行期间存在，并可能在 idle timeout 后退出。

对应关系：

- 同一个 workspace 主对话共用同一份 runtime session：Web、飞书、微信等 channel 只决定消息来源和回复路由，不决定记忆边界。连续同来源 pending 消息会合并成一轮；遇到不同来源即切到下一轮，按入库顺序继续处理，不跨来源重排。例如 `A1/A2/B1/A3/B2/B3` 必须切成 `A1+A2`、`B1`、`A3`、`B2+B3` 四轮。
- Skill slash command 如果返回 `assistant_prompt`，该消息会标记为 `source_kind='assistant_prompt'`，执行前清理当前 workspace 主 runtime session，再作为新 turn 发送给底层 runtime，避免命令生成的研究任务继承上一轮聊天 transcript。
- 同一个 workspace 下的每个 conversation agent 都有独立 runtime session，不与主对话共享 Claude/Codex 对话上下文。
- Runner 按 serialization key 串行化：主对话以 `folder` 为 key，conversation agent 以 `folder + agentId` 为 key，任务运行以 `folder + taskId` 为 key。活跃 runner 只接受与当前 turn 相同来源的 IPC 消息；不同来源消息排队并触发 drain，让当前 turn 完成后按顺序处理。
- 用户可见最终回复经过 `reply-visibility` 输出边界；该边界会把 Codex commentary 和可识别的内部包装从主正文剥离，避免 runtime transcript 细节直接发给用户。
- 最终发送路径不使用 streaming presentation 的 `answerText` 作为正文来源；可见正文只来自当前 turn 的 runtime raw/final output。`answerText` 只能作为当前流式卡片渲染的过渡 buffer，旧 turn 的 streaming answer 不能覆盖新 turn 的最终回复。中断、overflow、compact、crash recovery 的 partial body 不会作为 IM 正文发送或持久化。Feishu streaming card 对 Claude/Codex 均启用：thinking、commentary 和正文分别渲染到独立区域，footer 必须带运行时身份和当前处理耗时。
- 一个 workspace 不是永久对应一个 runner；workspace 可以没有活跃 runner，也可以因为主对话、conversation agent 或任务同时存在多个 runner。

当前限制：

- `sessions` 表的主键维度仍是 `(folder, agentId)`；主会话使用空 `agent_id`，不再为 IM 主对话创建或保留 `im:<sourceJid>` runtime slot。它不是 `(folder, agentId, agentType)`。
- 切换 `agentType`、`executionMode`、`model` 或 `reasoningEffort` 时，服务会停止活跃 runner 并清理该 workspace 的 runtime session，避免把旧 runtime 的 transcript 当成新 runtime 继续使用。
- 因此，主对话从 Codex 切到 Claude 再切回 Codex 时，当前版本不保证恢复切换前的 Codex session。若要支持 per-runtime 恢复，需要把 session 持久化改成按 runtime 分槽存储，并调整 `/clear`、runtime reset、agent 会话和迁移逻辑。

## 外部运行时契约

Cli Claw 不维护项目内部长期记忆；外部 CLI runtime 仍保留各自原生状态：

- `~/.cli-claw/sessions/{folder}/.claude/`
  - Claude Runtime 的隔离配置 / 会话目录
- `~/.claude/.credentials.json`
  - Claude Runtime 的本地登录态来源之一
- `~/.codex/config.toml`
  - Codex Runtime 的模型 / reasoning effort 配置
- `~/.codex/sessions/**/*.jsonl`
  - Codex Runtime 的原生 transcript / usage 快照来源
- `codex login`
  - Codex Runtime 的宿主机登录态

仓库内还可以追踪与 agent 工作流相关的角色文件，例如 `.agents/*.md`。这些文件属于仓库执行协议，不等同于 `~/.codex/` 或 `~/.agents/agents/` 下的用户级配置。

应用包根目录从已安装模块位置解析；launch cwd 只参与 host 工作区默认执行目录的物化，不参与后端 build、web build 或 shared 资源定位。

## 运行时变更约束

- 新增或修改运行时时，必须同步更新相关 owner 文档，尤其是 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/MEMORY.md`、`docs/MODULE.md` 和本文档。
- 不要把某个运行时的专属约定误写成系统级通用规则。
