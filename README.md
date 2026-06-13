<p align="center">
  <img src="web/public/icons/logo-1024.png" alt="Agent Fabric Logo" width="120" />
</p>

<h1 align="center">Agent Fabric</h1>

<p align="center">
  Powered By Any Agent CLI.
</p>

<p align="center">
  自托管的本地 AI Agent workflow 编排基架。
</p>

<p align="center">
  Inspired by <a href="https://github.com/riba2534/happyclaw">riba2534/happyclaw</a>.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-teal.svg?style=for-the-badge" alt="License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <a href="https://github.com/RyanProMax/agent-fabric/stargazers"><img src="https://img.shields.io/github/stars/RyanProMax/agent-fabric?style=for-the-badge&color=f5a623" alt="GitHub Stars" /></a>
</p>

<p align="center">
  <a href="#agent-fabric-是什么">介绍</a> · <a href="#核心能力">核心能力</a> · <a href="#快速开始">快速开始</a> · <a href="#开发文档">开发文档</a> · <a href="#贡献">贡献</a>
</p>

---

## Agent Fabric 是什么

Agent Fabric 是一个单实例自托管的 Agent workflow 编排基架。它不重新实现 Agent 内核，而是把成熟的本地 Agent 运行时封装成统一服务，让你通过 Web、飞书和微信入口访问同一套工作区、文件、workflow、调度和流式执行能力。

当前接入的运行时：

- `openai`：OpenAI Agents SDK，复用本机 Codex CLI 登录态

主进程负责实例密码访问、消息路由、队列调度、持久化和 Web / IM 体验；真正的推理、工具调用和会话循环由底层 CLI runtime 执行。

## 核心能力

- 单实例工作区：一个实例密码访问所有工作区、模型配置和消息审计。
- 多入口接入：通过 Web、飞书和微信访问同一工作区，消息统一路由。
- Codex/OpenAI 执行：所有工作区统一通过本地 Agent 进程运行。
- 流式体验：思考、文本、工具调用、任务事件和结果实时回传。
- Workflow 编排：工作区文件管理、workflow 定时计划、角色节点、本地任务和运行审计统一接入。
- 移动端 PWA：适配手机访问、查看执行状态和继续会话。

### 运行时概览

| `agentType` | 底层运行时        | 执行路径        | 认证方式              |
| ----------- | ----------------- | --------------- | --------------------- |
| `openai`    | OpenAI Agents SDK | 本地 Agent 进程 | 复用 Codex CLI 登录态 |

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org) >= 20
- 执行 `codex login`

### 通过同名 launcher 启动

```bash
npm install -g agent-fabric
agent-fabric help
agent-fabric version
agent-fabric start
```

默认访问地址：`http://localhost:3000`

外部 launcher 说明：

- 仓库服务、launcher 和发布包统一使用 `agent-fabric` 这个名字。
- 如需把 launcher 暴露到 PATH，可安装同名 npm 包 `agent-fabric`；可执行命令保持为 `agent-fabric <command>`。
- `agent-fabric start` 启动服务。
- `agent-fabric restart` 从外部 shell 请求一次安全自重启；它复用当前运行中 backend 保存的启动状态，不从调用方 shell 猜测启动命令。
- `agent-fabric help` / `-h` / `--help` 查看 launcher 帮助。
- `agent-fabric version` / `-v` / `--version` 查看已安装版本。
- 应用自身资源从安装包根目录解析，不依赖你启动时的当前目录。
- `agent-fabric start` 会把“你启动命令时所在的目录”当作主工作区默认执行目录，并在缺失时物化到 `custom_cwd`。
- 数据库存储、sessions、logs、downloads 和工作区元数据默认保留在 `~/.agent-fabric`，不会迁到启动目录。
- Agent Fabric 只读取 `~/.agent-fabric` 或 `AGENT_FABRIC_HOME` 指定的数据根；历史旧目录不会被自动发现或沿用。如需保留旧数据，请在服务停止后手动迁移到新的数据根。

### 安全重启

从外部 shell 重启正在运行的服务：

```bash
agent-fabric restart
```

在 IM 管理员会话中重启：

```text
/self-restart
```

这两条入口都会走同一套 safe intent / watchdog 流程：先复用当前 backend 保存的启动命令做 shadow self-check，通过后才替换服务；结果以 `~/.agent-fabric/ops/restarts/*.json`、`/self-status` 或 IM 成功回执为准。不要把 `kill`、`pkill`、`launchctl bootout` 当作日常重启入口。

如果还没有把 `agent-fabric` 暴露到 PATH，在仓库目录可以临时使用 `bun src/cli.ts restart` 作为 repo-local fallback；长期运行仍推荐 `agent-fabric start` / `agent-fabric restart`。

### 从当前仓库启动（推荐）

```bash
git clone https://github.com/RyanProMax/agent-fabric.git agent-fabric
cd agent-fabric
make start
```

推荐把这条路径当作日常运维和开发的主入口；这样 repo、服务和 launcher 都对应同一份工作树，不会再出现额外的包名心智负担。

首次进入后按设置向导完成：

1. 设置实例访问密码
2. 确认已执行 `codex login`
3. 如需 IM 通道，在 Web 设置页补充对应凭据

### 启动目录与数据目录

- 主工作区的默认执行 / 文件根目录来自 `agent-fabric start` 的启动目录。
- 这个默认值会持久化到 `custom_cwd`，避免运行时依赖隐式内存 fallback。
- 工作区拥有的存储路径默认以 `~/.agent-fabric/groups/{folder}` 和 `~/.agent-fabric/*` 下的数据为准；可用 `AGENT_FABRIC_HOME` 显式指定完整数据根。

### 常用命令

用户启动命令：

```bash
agent-fabric help
agent-fabric version
agent-fabric start
agent-fabric restart
```

仓库开发命令：

```bash
bun start
make dev
make build
make typecheck
make start
npm run release:check
./scripts/validate.sh
./scripts/review.sh
```

### 发布前检查

维护者在执行 `npm publish` 前，建议按这个顺序完成：

1. 先安装根仓库和子项目依赖：`make install`
2. 确认版本号已更新：`package.json` / `npm version <patch|minor|major>`
3. 确认 npm 身份与包权限可用：
   - `npm whoami`
   - 首次发布时确认 `agent-fabric` 包名可用
   - 后续发布时确认自己仍是 maintainer：`npm owner ls agent-fabric`
4. 跑本地发布检查：`npm run release:check`
5. 手工检查 packlist 与体积是否符合预期：

```bash
npm --cache /tmp/agent-fabric-npm-cache pack --dry-run
```

至少确认输出里仍包含：

- `dist/`
- `web/dist`
- `shared/dist`
- `container/agent-runner/dist`
- `config/`
- `README.md`
- `LICENSE`

同时留意 tarball 体积是否异常上涨。

6. 做一次 tarball 安装 smoke，尽量使用临时 `HOME` 和临时 prefix，避免污染本机：

```bash
npm --cache /tmp/agent-fabric-npm-cache pack
TMP_HOME="$(mktemp -d)"
TMP_PREFIX="$(mktemp -d)"
HOME="$TMP_HOME" npm install -g --prefix "$TMP_PREFIX" ./agent-fabric-<version>.tgz
"$TMP_PREFIX/bin/agent-fabric" help
"$TMP_PREFIX/bin/agent-fabric" version
```

如需再做一次短启动 smoke，可以在新的临时 `HOME` 下启动后手动停止：

```bash
HOME="$TMP_HOME" WEB_PORT=3310 "$TMP_PREFIX/bin/agent-fabric" start
```

7. 最后执行：`npm publish`

`npm run release:check` 会串联 `./scripts/validate.sh`、`./scripts/review.sh`、CLI 基础 smoke，以及带临时 cache 的 `npm pack --dry-run`，避免被本机 `~/.npm` 权限问题干扰；但它不替代 tarball 安装 smoke 和人为 packlist 审核。

### 端口

- 生产模式默认端口：`3000`
- 如需修改：

```bash
WEB_PORT=8080 agent-fabric start
```

## 开发文档

仓库采用 owner-doc 方式维护上下文，避免同一事实散落在多个入口：

- [AGENTS.md](AGENTS.md)：仓库入口、必读顺序、复杂任务底线
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：系统分层与核心数据流
- [docs/MODULE.md](docs/MODULE.md)：唯一维护的模块树 / 模块索引
- [docs/RUNTIME.md](docs/RUNTIME.md)：运行时矩阵与外部运行时契约
- [docs/MEMORY.md](docs/MEMORY.md)：记忆机制、上下文保留与增长边界
- [docs/ENGINEERING.md](docs/ENGINEERING.md)：实施、验证、review / commit 规则
- [docs/COMMAND.md](docs/COMMAND.md)：命令行为与入口差异

复杂任务默认按仓库内的 `PLANS/ACTIVE.md` + `RUNBOOKS/*` 工作流执行；细节以 [AGENTS.md](AGENTS.md) 为入口，不在 README 中重复展开。

## 贡献

欢迎提交 Issue 和 Pull Request。

### 开发流程

1. Fork 仓库并克隆到本地
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 开发并验证：`make dev`、`make typecheck`，必要时运行 `./scripts/validate.sh`
4. 提交代码并推送到 Fork
5. 创建 Pull Request 到 `main` 分支

### Commit 约定

commit message 使用英文，格式建议：`type: summary`

```text
fix: align message hover footer
feat: add openai runtime notes
refactor: simplify workspace routing
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=RyanProMax/agent-fabric&type=date&legend=top-left)](https://www.star-history.com/#RyanProMax/agent-fabric&type=date&legend=top-left)

## 许可证

[MIT](LICENSE)
