# 当前任务：移除 Web 用户 Skill 管理并收敛命令扩展入口

> **给 agentic workers：** 本轮计划统一维护在 `PLANS/ACTIVE.md`；不得在 `docs/superpowers/`、`docs/**/plans/` 或 `docs/**/specs/` 新增计划。一次只推进一个 milestone；validation 和 review 均通过后才可提交。

## 背景

用户确认 cli-claw 内置固化能力可以保留，但 Web UI 上展示和同步宿主用户 Skill 没有实际意义：Codex CLI 本身会读取宿主机技能；Cli Claw 的可执行扩展入口应只保留仓库级 `.agents/skills`，用于 slash command。用户明确要求破坏性重构，直接移除 Web UI 的用户 Skill 管理板块及相关代码逻辑，不保留兼容壳或残留入口。

## 目标

- 移除 Web UI 用户 Skill 管理入口、页面、store、组件、设置项和相关 API 路由。
- 移除宿主用户 Skill 同步、自动同步配置、启停/安装/删除等用户级 Skill 管理逻辑。
- 将 skill slash command 发现边界收敛为只读取当前 workspace 的 `.agents/skills`。
- 清理 runner / 打包 / 测试 / 文档中与用户级 Skill 管理相关的残留。
- 完成验证、review、提交与安全重启。

## 非目标

- 不移除 workflow、scheduled task、automations 看板能力。
- 不改变 `.agents/skills/<skill-id>/SKILL.md` + `commands.json` 的仓库级 slash command 契约。
- 不新增新的 Skill 管理 UI 替代品。
- 不兼容旧 `/skills` 页面或用户级 Skill API。

## Milestones

### Milestone 1：引用盘点与边界确认

Objective:

- 全量搜索 Web UI、后端 API、runner、配置、测试、文档中用户级 Skill 管理引用。
- 明确需要保留的仓库级 `.agents/skills` slash command 路径。

Allowed scope:

- 只读搜索源码、测试、文档和配置
- `PLANS/ACTIVE.md`

Validation:

- 已列出主要删除/保留边界。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 已确认删除范围：顶层 `/skills` 页面、设置页 Skill tab、聊天侧栏工作区 Skills 面板、`/api/skills`、workspace-config skills 子路由、host sync / auto sync、runner `install_skill` / `uninstall_skill` IPC 工具、`container/skills` 打包项和相关测试文档。
- 保留边界：`src/skills/command-dispatch.ts` 的仓库级 `.agents/skills` slash command 发现与执行能力。

### Milestone 2：删除 Web/API/runner 用户 Skill 管理链路

Objective:

- 删除 Web Skill 页面、导航、设置 tab、store 与组件。
- 删除 `/api/skills` 路由、宿主同步与用户级 Skill 管理后端逻辑。
- 删除 runner 中面向用户 Skill 安装/卸载的工具和内置安装 skill 包。

Allowed scope:

- `web/src/**`
- `src/web/**`
- `src/index.ts`
- `src/core/**`
- `container/agent-runner/**`
- `container/skills/**`
- `package.json`
- 相关测试

Validation:

- 前后端类型检查能捕捉无残留 import。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 已删除顶层 `/skills` 路由、设置页 Skill tab、聊天侧栏工作区 Skills 面板、`/api/skills`、workspace-config skills 子路由、host sync / auto sync、runner `install_skill` / `uninstall_skill` 和 `container/skills` 打包入口。
- 已移除 `selected_skills` 代码路径；旧数据库中如仍有历史列，当前代码不再读写。

### Milestone 3：收敛命令发现、测试和 owner docs

Objective:

- `resolveSkillCommandRoots` 只返回 workspace `.agents/skills`。
- 更新 slash command 测试，删除用户级优先级/fallback 断言。
- 更新 `docs/COMMAND.md`、`docs/RUNTIME.md`、`docs/MEMORY.md`、`docs/MODULE.md` 等 owner 文档。

Allowed scope:

- `src/skills/**`
- `tests/**`
- `docs/**`
- `.agents/skills/README.md`
- `PLANS/ROADMAP.md` 如需跨轮次记录

Validation:

- 相关单测通过。
- 文档不再宣称用户级 Web Skill 管理或宿主同步。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 已新增仓库级 `.agents/skills/stock-analysis-skill` 与 `.agents/skills/stock-kol-intel` 命令桥，避免移除用户级 fallback 后 `/hkipo`、`/research`、`/otc`、`/cnipo`、`/kol` 消失。
- 若文档仍提到 user-level cli-claw skills，只能作为“禁止恢复”的负向规则，不得作为可用能力描述。
- 旧 Skill UI/API/安装同步关键词残留检索只剩 `.agents/skills` 的正向说明与仓库级命令桥引用。

### Milestone 4：验证、review、提交与安全重启

Objective:

- 完成 validation / review gate，提交变更，并按安全路径重启 Cli Claw 服务。

Allowed scope:

- 本轮已触及源码、文档、测试和计划

Validation:

- `bun tsc --noEmit`
- `npm --prefix web run build`
- `npm run typecheck`
- `./scripts/review.sh`
- `./scripts/validate.sh`
- `git diff --check`

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- `git diff --check` exit 0。
- `./scripts/review.sh` exit 0；按 `RUNBOOKS/Review.md` 做了语义审查，未发现阻塞项。
- `./scripts/validate.sh` exit 0：78 个测试文件通过、1 个 skipped；531 个测试通过、1 个 skipped；typecheck、backend/web/runner build 均通过。Vite 仍输出既有 chunk-size warning。
- 已用仓库级命令桥做直接 smoke：`/cnipo` placeholder 与 `/kol --days=bad` 参数错误路径均返回预期 JSON final_markdown。

## Handoff

Current milestone:

- Milestone 4

Current status:

- done

Changed files:

- Web UI/API/runner/配置/测试/文档和仓库级 `.agents/skills` 命令桥已更新；最终提交前以 `git status --short` 为准。

Last failure summary:

- n/a

Suspected cause:

- n/a

Next step:

- 提交变更，并按 `bun src/cli.ts restart` 安全重启 Cli Claw 服务。
