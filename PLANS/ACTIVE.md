# 当前任务：移除 cli-claw 兼容配置边界

## Goal

- 在已经完成项目主体重命名为 Agent Fabric 的基础上，继续清理旧 `cli-claw` / `~/.cli-claw` / `CLI_CLAW_*` 配置兼容。
- 新范式只保留 `agent-fabric` / `~/.agent-fabric` / `AGENT_FABRIC_*`，不保留旧命名 fallback、兼容壳或隐式迁移逻辑。

## Done when

- 默认数据根固定为 `~/.agent-fabric`，不再检测或沿用 `~/.cli-claw`。
- 运行时、runner、skills、scheduler、cache、自检/重启和文档入口统一使用 `AGENT_FABRIC_*`。
- 旧 `CLI_CLAW_*` env var、旧输出 marker、旧命令 alias 和旧配置文档说明被删除。
- `rg -n "cli-claw|Cli Claw|CLI_CLAW|\\.cli-claw" .` 只剩明确第三方历史引用或已确认可接受的非配置引用。
- 相关测试、构建/类型检查和 review gate 通过。
- 本轮结果和 handoff 已回写本文件；如有跨轮次事项，再同步 `PLANS/ROADMAP.md`。

## Milestones

### Milestone 1：锁定旧配置兼容残留

Objective:
- 盘点当前旧配置和旧命名 fallback，明确本轮允许破坏性删除的实现、测试和文档范围。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查全仓 `cli-claw` / `.cli-claw` / `CLI_CLAW_*` 引用
- 与旧配置兼容直接相关的 owner docs、tests、runtime、runner、skills、scheduler、cache、自检/重启与 command guard 文件

Validation:
- `rg -n "cli-claw|Cli Claw|CLI_CLAW|\\.cli-claw" . -g '!node_modules' -g '!dist' -g '!web/dist' -g '!container/agent-runner/dist'`
- 形成本轮实现边界并记录在本文件。

Status:
- done

Validation status:
- passed:
  - 初始 `rg` 扫描已完成，确认旧兼容残留集中在配置根、runner env、restart guard、skill env、cache/scheduler/self restart 和 docs/tests。
  - 先行 targeted tests 已红：`npx vitest run tests/unit/core/config/storage-root.test.ts tests/unit/core/cache.test.ts tests/contracts/runtime/service-restart-guard.test.ts tests/contracts/runtime/codex-cli-auth.test.ts tests/unit/app/self-restart.test.ts tests/unit/skills/command-dispatch.test.ts`，10 个失败均命中旧兼容入口。

Review status:
- passed

Risks / Notes / Handoff:
- 初始扫描确认项目目录和 Git remote 已是 `agent-fabric` / `https://github.com/RyanProMax/agent-fabric.git`。
- 旧兼容残留集中在 `src/core/config.ts` 的 `~/.cli-claw` fallback、`CLI_CLAW_*` env var、runner env 传递、旧输出 marker、restart guard 旧命令匹配、skill dispatch env、docs 与测试。
- 用户已明确“不需要保留兼容代码，破坏性重构即可”，因此旧 env var / 旧目录兼容应删除而不是继续文档化。

### Milestone 2：移除旧配置兼容实现

Objective:
- 删除 `~/.cli-claw` 和 `CLI_CLAW_*` fallback，把配置、runner 通信、skills env、scheduler/cache/self restart/self check 等路径统一到 Agent Fabric 命名。

Allowed scope:
- `src/`
- `shared/`
- `container/agent-runner/`
- `.agents/skills/`
- `config/`
- `docs/`
- `README.md`
- `tests/`
- `PLANS/ACTIVE.md`

Validation:
- 先补/调整直接相关测试并观察旧兼容期望失败。
- 运行与配置、launcher、restart、runtime、runner、skill dispatch 直接相关的 targeted tests。
- `rg -n "cli-claw|Cli Claw|CLI_CLAW|\\.cli-claw" . -g '!node_modules' -g '!dist' -g '!web/dist' -g '!container/agent-runner/dist'` 不再出现旧配置兼容项。

Status:
- done

Validation status:
- passed:
  - 红线：`npx vitest run tests/unit/core/config/storage-root.test.ts tests/unit/core/cache.test.ts tests/contracts/runtime/service-restart-guard.test.ts tests/contracts/runtime/codex-cli-auth.test.ts tests/unit/app/self-restart.test.ts tests/unit/skills/command-dispatch.test.ts` 先失败 10 项，命中旧 fallback。
  - 修复后 targeted：`npx vitest run tests/unit/core/config/storage-root.test.ts tests/unit/core/cache.test.ts tests/contracts/runtime/service-restart-guard.test.ts tests/contracts/runtime/codex-cli-auth.test.ts tests/unit/app/self-restart.test.ts tests/unit/skills/command-dispatch.test.ts tests/unit/agent/runner/output-parser.test.ts`，63 tests passed。
  - 实现与文档扫描：`rg -n "Cli Claw|cli-claw|CLI_CLAW|\\.cli-claw" . -g '!node_modules' -g '!dist' -g '!web/dist' -g '!container/agent-runner/dist' -g '!tests'` 无匹配；旧标识只保留在负向测试里。
  - `npm run build:shared`
  - `npm run typecheck:backend`
  - `npm --prefix container/agent-runner run build:runner`
  - `npm --prefix web run build`

Review status:
- passed

Risks / Notes / Handoff:
- 默认数据根固定为 `~/.agent-fabric` 或 `AGENT_FABRIC_HOME`；不再检测或沿用历史旧目录。
- runner host、agent-runner、repository skills、scheduler、cache、自检/重启和 launchd 入口只读写 `AGENT_FABRIC_*`。
- 旧 output marker、旧 safe restart alias、旧 skill env、旧 cache/scheduler env fallback 均已删除；旧标识只在负向测试中用于防回归。

### Milestone 3：验证、review、提交

Objective:
- 运行本轮验证和 review gate，回写 handoff，并提交破坏性重构。

Allowed scope:
- `PLANS/ACTIVE.md`
- 本轮已修改文件
- Git commit

Validation:
- `git diff --check`
- targeted tests
- `npm run typecheck:backend`
- `npm --prefix container/agent-runner run build:runner`
- `./scripts/review.sh`
- 如时间允许，补跑 `./scripts/validate.sh`

Status:
- done

Validation status:
- passed:
  - `git diff --check`
  - `./scripts/review.sh`
  - `./scripts/validate.sh`

Review status:
- passed: `./scripts/review.sh` 通过；按 `RUNBOOKS/Review.md` 人工 diff review 未发现 blocking 问题

Risks / Notes / Handoff:
- `./scripts/validate.sh` 通过；输出仍包含既有 `MaxListenersExceededWarning` 与 Vite chunk size warning，非本轮新增失败。
- 本轮没有需要同步到 `PLANS/ROADMAP.md` 的跨轮次事项。
- 首次 `agent-fabric restart` 因当前没有 backend restart state 返回 `current backend restart state not found`；随后用 `ops/install-launch-agent.sh install -- "$(command -v node)" /Users/ryan/projects/agent-fabric/dist/cli.js start` 安装并拉起 `gui/501/com.ryan.agent-fabric`。
- 本地持久化状态已清理：`registered_groups.custom_cwd` 中 4 条旧 `/Users/ryan/projects/cli-claw` 已更新为 `/Users/ryan/projects/agent-fabric`，并备份到 `~/.agent-fabric/db/messages.db.backup-agent-fabric-rename-20260613T161045Z`；`~/.agent-fabric` 下旧命名文件已改为 `agent-fabric-legacy-*`。
- 安全重启 intent `restart-2026-06-13T16-11-02-004Z-61001e5f` 状态 `passed`；`curl -fsS http://127.0.0.1:3000/api/health` 返回 `healthy`。

## Handoff

Current milestone:
- Milestone 3 done

Current status:
- committed，LaunchAgent 已应用，服务健康

Changed files:
- 项目主体 rename 的既有改动
- `src/core/config.ts`
- `src/core/cache.ts`
- `src/agent/scheduler/index.ts`
- `src/core/self/self-check.ts`
- `src/core/self/self-restart.ts`
- `src/core/self/startup-launch.ts`
- `src/core/runtime/codex-cli-auth.ts`
- `src/core/runtime/openai-runtime.ts`
- `src/agent/runner/container-runner.ts`
- `src/agent/runner/output-parser.ts`
- `src/agent/workflow/local-tasks.ts`
- `src/skills/command-dispatch.ts`
- `shared/service-restart-guard.ts`
- `container/agent-runner/src/`
- `.agents/skills/*/commands/dispatch.py`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- 相关测试

Last failure summary:
- 先行 targeted tests 曾失败 10 项，均为预期红线；修复后 targeted、typecheck、build、review 和 full validate 均通过。

Suspected cause:
- 已修复：旧迁移期 fallback 保留在实现中。

Next step:
- 如需要同步远端，执行 `git push origin main`；当前本地服务已在 `~/.agent-fabric` 范式下运行。
