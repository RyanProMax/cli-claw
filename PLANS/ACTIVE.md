# 当前任务：移除 Web MCP 与注册管理残留

> **给 agentic workers：** 用户要求基于当前定位移除 workspace 级 MCP 配置入口，并追问 WebUI 的注册管理是否没删干净。本轮目标是破坏性删除 Web 可见 MCP 管理面、后端配置 API、公开自助注册、邀请码管理和设置页注册管理，不保留兼容壳；保留仓库级 `.agents/skills` slash command 扩展入口与管理员用户管理。

## 背景

上一轮项目精简删除了 Billing、用量统计、系统监控和用户 Skill 管理，但 workspace MCP 配置抽屉仍在聊天侧栏，注册管理仍在设置页与 `/register` 自助注册路由中。代码扫描确认当前 runner 没有加载 workspace `.agents/mcp/settings.json`，MCP UI/API 是未接入执行路径的配置面；注册管理则是独立的开放注册能力，和管理员创建用户能力重复。

## 目标

- 删除聊天侧栏的 MCP 管理入口、`WorkspaceMcpPanel`、workspace config store 和 `/api/groups/:groupId/workspace-config` 后端路由。
- 删除公开 `/register` 页面、登录页注册链接、auth store 的注册方法、`/api/auth/register*` 后端接口和注册配置 API。
- 删除设置页“注册管理”tab、用户管理里的邀请码 tab、对应组件、schema、runtime config、权限位和已无调用方的 DB 注册 / 邀请 helper。
- 保留管理员用户管理、登录、初始化 setup、审计日志、仓库级 `.agents/skills` slash command。
- 更新 owner 文档与计划，完成验证、review、提交和安全重启。

## 非目标

- 不删除管理员用户列表、管理员创建用户和审计日志。
- 不删除健康检查、状态 API、自动化 / 工作流看板。
- 不引入 MCP 替代桥接；`/hkipo` 等命令继续走仓库级 skill / slash command 入口。

## Milestones

### Milestone 1：残留扫描与根因确认

Objective:

- 确认 workspace MCP 与注册管理的真实引用链和运行时接入状态。

Allowed scope:

- 只读搜索源码、测试、文档
- `PLANS/ACTIVE.md`

Validation:

- 搜索结果能解释为什么 WebUI 还有这些入口，以及哪些能力应保留。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- MCP 根因：Web/API 仍保留 workspace config 管理面，但 `container/agent-runner` 没有加载 workspace MCP settings；该入口会让用户误以为 runner 支持这层工具注入。
- 注册管理根因：它是独立开放注册能力，不是用量/MCP 清理残留；当前自托管定位下与管理员用户管理重复，且增加公开入口复杂度。公开注册删除后，邀请码管理没有消费路径，也应一并删除。
- 源码范围残留扫描只剩计划文档说明、架构文档的“已不提供 MCP 配置入口”、`registerSW.js` service worker 白名单、IM group registration 注释，以及 runner no-context-injection 测试中的 `mcpServers` 反向断言；均不是 Web UI / API 管理入口残留。

### Milestone 2：删除 MCP 管理面与公开注册链路

Objective:

- 删除 Web 可达 MCP 管理面和后端 workspace config API。
- 删除公开注册页面、注册配置页、注册 API、邀请码管理和无调用方 helper。

Allowed scope:

- `web/src/**`
- `src/web/**`
- `src/core/**`
- `src/storage/db.ts`
- `tests/**`
- owner docs 中相关模块说明

Validation:

- `rg` 不再命中 `WorkspaceMcpPanel`、`workspace-config`、Web MCP tab、`RegisterPage`、`/api/auth/register`、设置页 `registration` tab、`manage_invites`、邀请码管理入口。
- 直接相关 typecheck / build / tests 通过。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 删除注册链路时必须保留 setup 首个管理员创建和 admin 用户管理，避免系统无法初始化或运维无法新增用户；历史 `invite_codes` 表只允许作为启动清理项存在。
- 已保留 `/api/auth/setup`、管理员创建用户、用户列表、权限模板、审计日志和仓库级 `.agents/skills` slash command。
- 已移除聊天侧栏 MCP panel、workspace config store / route、公开注册页与 API、设置页注册管理、用户页邀请码 tab、邀请码权限位 / schema / DB helper；启动时会 `DROP TABLE IF EXISTS invite_codes` 清掉旧表。

### Milestone 3：文档同步、验证、review、提交与重启

Objective:

- 同步 docs owner 文档中的当前能力边界。
- 完成 validation / review gate、提交并安全重启服务。

Allowed scope:

- 本轮触及源码、测试、文档与 `PLANS/ACTIVE.md`

Validation:

- `git diff --check`
- `npm run typecheck`
- `npm run build:web`
- 相关单测
- `./scripts/review.sh`
- 必要时补跑 `./scripts/validate.sh`

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- `git diff --check` 通过。
- `npm run typecheck` 通过。
- `npm run build:web` 通过；仅有 Vite chunk size warning。
- `./scripts/validate.sh` 通过：75 个 test files 中 74 passed、1 skipped；515 个 tests 中 514 passed、1 skipped；backend/web/agent-runner build 均通过。
- `./scripts/review.sh` 通过格式 gate；语义 review 已确认 setup、管理员用户管理、审计日志、仓库级 skill 命令未被误删。

## Handoff

Current milestone:

- Milestone 3

Current status:

- done

Changed files:

- `PLANS/ACTIVE.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `package.json`
- `src/core/auth.ts`
- `src/core/permissions.ts`
- `src/core/runtime/config.ts`
- `src/core/schemas.ts`
- `src/domain/types.ts`
- `src/index.ts`
- `src/storage/db.ts`
- `src/web/app.ts`
- `src/web/middleware/auth.ts`
- `src/web/routes/admin.ts`
- `src/web/routes/auth.ts`
- `src/web/routes/config.ts`
- `src/web/routes/workspace-config.ts`（删除）
- `tests/unit/core/workspace/workspace-config-workspace-cwd.test.ts`（删除）
- `web/src/App.tsx`
- `web/src/components/chat/ChatView.tsx`
- `web/src/components/chat/WorkspaceMcpPanel.tsx`（删除）
- `web/src/components/settings/RegistrationSection.tsx`（删除）
- `web/src/components/settings/SettingsNav.tsx`
- `web/src/components/settings/types.ts`
- `web/src/components/users/InviteCodesTab.tsx`（删除）
- `web/src/components/users/utils.ts`
- `web/src/pages/LoginPage.tsx`
- `web/src/pages/RegisterPage.tsx`（删除）
- `web/src/pages/SettingsPage.tsx`
- `web/src/pages/UsersPage.tsx`
- `web/src/stores/auth.ts`
- `web/src/stores/users.ts`
- `web/src/stores/workspace-config.ts`（删除）

Last failure summary:

- 无。

Suspected cause:

- 不适用；验证通过。

Next step:

- 提交并按 `docs/COMMAND.md` 走安全重启应用变更。
