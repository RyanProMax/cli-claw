# 当前任务：移除执行模式和 Docker 运行时

> **给 agentic workers：** 必须使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`，并保留验证 gate。计划统一写在 `PLANS/`；不要在 `docs/superpowers` 下新增计划。

## 目标

- 端到端移除 `executionMode` 概念。Cli Claw 只保留一条执行路径：使用 workspace cwd 契约启动本地 OpenAI / Codex Agent 进程。
- 删除 Docker / container 执行、Docker monitor / build 路由、Docker 专用 terminal 支持，以及所有模式 UI / API / task 字段。
- 保留 `container/agent-runner/` 作为当前 runner package 的物理路径；它不再代表 Docker 或执行模式。

## 完成标准

- runtime / workspace / task API 不再接受或返回 `execution_mode`。
- backend dispatch、queue、scheduler、task bridge、runner startup 都走单一本地进程路径。
- Web 不再展示 host/container selector、模式 badge、Docker monitor/build UI 或 terminal UI。
- owner 文档统一描述 OpenAI / Codex 本地进程执行路径。
- 目标 E2E / integration、全量 validation、review、health check、release gate 均已运行，或明确记录阻塞原因。

## 里程碑

### Milestone 1：Schema、API 和活跃契约

目标：
- 从 domain types、request schemas、group/task 持久化访问、runner tool schemas、stock scheduled-task bridge 中移除执行模式字段。

允许范围：
- `PLANS/ACTIVE.md`
- `src/domain/types.ts`
- `src/core/schemas.ts`
- `src/storage/db.ts`
- `src/core/runtime/group-runtime.ts`
- `src/core/workspace/workspace-cwd.ts`
- `src/messaging/new-workspace.ts`
- `src/web/routes/groups.ts`
- `src/web/routes/tasks.ts`
- `container/agent-runner/src/openai-agent-tools.ts`
- `scripts/stock-handoff-agent-bridge.mjs`
- 直接相关测试：`tests/integration/routes`、`tests/integration/scheduler`、`tests/unit/core`、`tests/unit/messaging`、`tests/scripts/stock`

验证：
- `npm test -- tests/integration/routes/groups.test.ts tests/integration/scheduler/workspace-cwd.test.ts tests/unit/core/runtime/group-runtime.test.ts tests/unit/core/workspace/workspace-cwd.test.ts tests/unit/messaging/new-workspace.test.ts tests/scripts/stock/handoff-agent-bridge.test.ts`

状态：
- done

已运行验证：
- 通过：`npm test -- tests/integration/routes/groups.test.ts tests/unit/messaging/new-workspace.test.ts tests/unit/core/runtime/group-runtime.test.ts tests/scripts/stock/handoff-agent-bridge.test.ts`
- 通过：`npm test -- tests/integration/routes/groups.test.ts tests/unit/messaging/new-workspace.test.ts tests/unit/core/runtime/group-runtime.test.ts tests/scripts/stock/handoff-agent-bridge.test.ts tests/contracts/packaging/package-manifest.test.ts tests/contracts/openai/agent-runtime.test.ts`
- 通过：`./scripts/validate.sh`
- 通过：`npm run release:check`

Review status：
- passed（`./scripts/review.sh` 退出码 0；按 `RUNBOOKS/Review.md` 完成语义自审，无阻塞发现）

风险 / 备注：
- `execution_mode`、`container_config`、`init_source_path`、`init_git_url` 的数据库迁移引用保留在 table rebuild / assert 逻辑中，用于删除旧列和防止 schema 回退。

### Milestone 2：单一本地进程 Runner

目标：
- 删除 Docker runner 分发，让 queue、scheduler、workspace agent run、conversation agent run 都使用单一本地进程 runner。

允许范围：
- `src/agent/runner/container-runner.ts`
- `src/agent/queue/group-queue.ts`
- `src/agent/scheduler/index.ts`
- `src/index.ts`
- `src/core/config.ts`
- `src/agent/runner/output-parser.ts`
- 直接相关 runner / queue / scheduler 测试

验证：
- `npm test -- tests/integration/agent/queue/group-queue.test.ts tests/integration/agent/restart-recovery.test.ts tests/integration/messaging/feishu/e2e.test.ts tests/integration/scheduler/workspace-cwd.test.ts tests/unit/agent/runner/run-log.test.ts tests/unit/agent/runner/output-parser.test.ts`

状态：
- done

已运行验证：
- 通过：`npm test -- tests/integration/agent/queue/group-queue.test.ts tests/unit/messaging/command-utils.test.ts`
- 通过：`npm test -- tests/integration/agent/queue/group-queue.test.ts tests/integration/scheduler/workspace-cwd.test.ts tests/unit/messaging/command-utils.test.ts tests/unit/agent/runner/run-log.test.ts tests/unit/agent/runner/output-parser.test.ts tests/unit/agent/runner/timeout-logging.test.ts tests/unit/web/workspace-runtime.test.ts tests/unit/core/workspace/files-workspace-cwd.test.ts tests/unit/core/workspace/workspace-config-workspace-cwd.test.ts`
- 通过：`npm test -- tests/integration/messaging/feishu/e2e.test.ts tests/integration/agent/restart-recovery.test.ts tests/integration/agent/queue/group-queue.test.ts tests/integration/scheduler/workspace-cwd.test.ts tests/integration/routes/groups.test.ts tests/integration/web/slash-command.test.ts`
- 通过：`./scripts/validate.sh`
- 通过：`npm run release:check`

Review status：
- passed（`./scripts/review.sh` 退出码 0；按 `RUNBOOKS/Review.md` 完成语义自审，无阻塞发现）

风险 / 备注：
- `src/agent/runner/container-runner.ts` 仍保留历史文件名；内部 API 已收敛为 `runAgentProcess`。

### Milestone 3：Web 表面清理

目标：
- 删除前端模式控件、Docker monitor/build UI、terminal UI / WebSocket 表面，以及 stores/types 中的模式字段。

允许范围：
- `web/src`
- `src/web/app.ts`
- `src/web/context.ts`
- `src/web/routes/monitor.ts`
- `src/web/routes/bug-report.ts`
- `src/web/terminal-manager.ts`
- `src/pty-worker.cjs`
- 受 terminal 依赖删除影响的 Web / unit tests 和 package manifests

验证：
- `npm --prefix web run build`
- `npm test -- tests/integration/web/slash-command.test.ts tests/unit/web/workspace-runtime.test.ts tests/unit/web/chat-streaming-store.test.ts tests/unit/messaging/command-utils.test.ts`

状态：
- done

已运行验证：
- 通过：`npm --prefix web run build`
- 通过：`npm test -- tests/integration/web/slash-command.test.ts tests/unit/web/workspace-runtime.test.ts tests/unit/web/chat-streaming-store.test.ts tests/unit/messaging/command-utils.test.ts tests/unit/core/workspace/workspace-cwd.test.ts tests/unit/core/workspace/files-workspace-cwd.test.ts tests/unit/core/workspace/workspace-config-workspace-cwd.test.ts tests/unit/agent/script-runner-workspace-cwd.test.ts`
- 通过：`./scripts/validate.sh`
- 通过：`npm run release:check`

Review status：
- passed（`./scripts/review.sh` 退出码 0；按 `RUNBOOKS/Review.md` 完成语义自审，无阻塞发现）

风险 / 备注：
- Web terminal 按本任务要求删除，没有改造成本地 PTY。
- 已删除 `node-pty`、`@xterm/*`、terminal CSS 和 terminal WebSocket message types。

### Milestone 4：文档、打包和全量验证

目标：
- 删除 Docker wrapper assets，并更新 owner docs、README、package manifest 和测试，统一到单一本地进程 runner 契约。

允许范围：
- `AGENTS.md`
- `docs/RUNTIME.md`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `docs/MEMORY.md`
- `docs/ENGINEERING.md`
- `README.md`
- `RUNBOOKS/SelfIteration.md`
- `package.json`
- `container/Dockerfile`
- `container/build.sh`
- `container/entrypoint.sh`
- packaging / docs tests

验证：
- `npm test -- tests/contracts/packaging/package-manifest.test.ts tests/contracts/runtime/build.test.ts`
- `./scripts/validate.sh`
- `./scripts/review.sh`
- `curl -fsS http://127.0.0.1:3000/api/health`
- 若 validation 通过，再运行：`npm run release:check`
- 仅在 live Feishu credentials 已配置时运行：`FEISHU_LIVE_E2E=1 npm test -- tests/live/feishu/message-smoke.test.ts`

状态：
- done

已运行验证：
- 通过：`npm test -- tests/contracts/packaging/package-manifest.test.ts tests/contracts/runtime/build.test.ts tests/contracts/openai/agent-runtime.test.ts tests/contracts/openai/runner-request.test.ts`
- 通过：`./scripts/validate.sh`
- 通过：`./scripts/review.sh`
- 通过：`curl -fsS http://127.0.0.1:3000/api/health`，返回 `{"status":"healthy","checks":{"database":true,"queue":true,...}}`
- 通过：`npm run release:check`
- 未运行 live Feishu smoke：当前环境没有 `FEISHU_*` / `LARK_*` credentials。

Review status：
- passed（`git diff --check` 退出码 0；TODO/FIXME/调试残留扫描为空；剩余旧字段命中仅限破坏性迁移、断言测试、删除说明或 Vite 传递依赖）

风险 / 备注：
- `web/package-lock.json` 仍包含 `is-docker` / `is-inside-container` 作为 Vite 相关传递依赖，不是 Cli Claw 的 Docker runtime 依赖。
- `src/storage/db.ts` 中的旧列名仅用于破坏性迁移和 schema assert。

## 工作规则

- 一次只允许一个 milestone 处于 `in_progress`。
- 不隐式扩 scope；若目标、方案、验证方式或涉及文件变化，先更新本计划再继续。
- validation 或 review 失败时，留在当前 milestone 修复，除非明确记录阻塞。
- 只有 validation 和 review gate 都通过后，才能把 milestone 标记为 `done`。

## Handoff

当前 milestone：
- 无，任务已完成。

当前状态：
- validation、review、health check、release gate 均已通过；live Feishu smoke 因当前 shell 未配置凭据未运行。
- 当前运行服务的 `appRoot` 是 `/Users/ryan/projects/cli-claw`，本轮改动位于隔离 worktree `/Users/ryan/.config/superpowers/worktrees/cli-claw/remove-execution-mode`；未在本轮直接重启线上服务，合并或切换服务代码后再执行 `cli-claw restart`。

已完成的关键改动：
- 删除 workspace / task 的 `execution_mode` API 字段和数据库活跃 schema 字段。
- 将 runner / queue / scheduler 收敛到 `runAgentProcess` 单一路径。
- 删除 Web terminal manager、PTY worker、xterm 依赖、terminal UI 和 terminal WebSocket types。
- 删除 `container/Dockerfile`、`container/build.sh`、`container/entrypoint.sh`。
- 将 `host-cwd` 内部命名收敛为 `workspace-cwd`，让 `custom_cwd` 表达为 workspace cwd 契约。

下一步：
- 提交本轮破坏性重构改动；合并到当前服务使用的 checkout 后，按 `docs/COMMAND.md` 的安全重启路径执行 `cli-claw restart`。
