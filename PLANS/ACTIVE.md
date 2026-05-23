# 当前任务：单实例 + Web/飞书/微信 + Workflow 精简

> 本轮按用户确认的破坏性方案执行：收敛为单实例自托管工具，保留 Web / 飞书 / 微信入口、工作区消息、仓库级 skill command、workflow 调度与审计。

## 目标

- 访问控制收敛为实例密码、`access_config` 与 `access_sessions`。
- IM 只保留 Web / Feishu / WeChat，配置与连接管理改成实例级。
- 自动化只保留 workflow scheduled task，Web 自动化页面继续承载计划、运行中状态和 workflow 看板。
- Web 删除用户 Skill 管理、旧通道管理、用户管理、成员管理和非 workflow 创建入口。
- Storage 对外调用改按 `schema/access/messages/workspaces/workflows/scheduler/agents` 职责入口导入。
- 文档同步 `docs/ARCHITECTURE.md`、`docs/RUNTIME.md`、`docs/COMMAND.md`、`docs/MODULE.md`、`docs/E2E.md`、README 与 roadmap。

## Milestones

### Milestone 1：单实例访问模型与 DB 基础

Status: `done`

Validation:

- `npm run typecheck:backend` 通过。
- 相关 auth / route 引用已收敛到 access session。

### Milestone 2：IM 通道收敛到 Web/飞书/微信

Status: `done`

Validation:

- 源码扫描未命中旧通道 provider、旧配置路由、旧 UI card 或旧 JID prefix。
- `npm --prefix container/agent-runner run build:runner` 通过。

### Milestone 3：自动化只保留 workflow schedule

Status: `done`

Validation:

- workflow scheduled task CRUD / run-now / dashboard 相关测试通过。
- scheduler 只接受 `execution_type='workflow'`。

### Milestone 4：模块边界、Web 资产与文档收口

Status: `done`

Validation:

- `npm run build:web` 通过。
- 相关 targeted tests 通过。
- `./scripts/validate.sh` 通过：70 个 test files passed、1 skipped；495 个 tests passed、1 skipped；shared/backend/web/agent-runner build 均通过。
- `./scripts/review.sh` 通过 diff hygiene 与 `src/**/*.ts` format check。
- 残留扫描未命中旧 Telegram / QQ / DingTalk、admin / user permission、非 workflow task、直接业务导入 `storage/db.ts`。
- `bun src/cli.ts restart` 已通过 safe intent / watchdog，restart 记录 `status: passed`。
- `/api/health` 返回 healthy。

Review:

- `passed`。按 `RUNBOOKS/Review.md` 检查 scope、目标覆盖、模式契合、验证证据、文档同步和残留风险；无 blocking finding。

## Handoff

Current milestone:

- Milestone 4

Current status:

- done

Changed areas:

- Backend auth/session、IM manager/config、scheduler/tasks、runner IPC、storage import boundaries。
- Web auth/setup/settings/automations/chat/sidebar/task form。
- Tests, package manifests, docs, README, roadmap, assets。

Next step:

- 本轮主精简已提交；继续处理实例级 IM 配置继承 follow-up。

## Follow-up：实例级 IM 配置继承修复

Status: `done`

Issue:

- 单实例重构后只读取 `config/feishu-provider.json` 与 `config/wechat-provider.json`。
- 既有机器仍保留旧 `config/user-im/<旧用户ID>/feishu.json` / `wechat.json`，导致主工作区误提示“未配置 IM 渠道”。
- Web 横幅使用 live connection 状态表达“是否配置”，连接未启动时也会误报未配置。

Fix:

- 读取实例级 provider 失败时，自动提升最新的旧 user-scoped 飞书/微信配置到实例级 provider 文件，并清理已提升的旧文件。
- `/api/config/user-im/status` 改为返回“已配置且启用”的状态，不再用 live connection 状态代替配置状态。
- 增加单元测试与路由集成测试覆盖继承和状态判断。

Validation:

- `npm test -- tests/unit/core/runtime/config.test.ts tests/integration/routes/config-status.test.ts` 通过。
- `npm run typecheck:backend` 通过。
- `./scripts/validate.sh` 通过。
- `./scripts/review.sh` 通过 diff hygiene 与 `src/**/*.ts` format check。
- 本机配置已提升为实例级 `feishu-provider.json` / `wechat-provider.json`，旧 `user-im` 配置文件已清理。
- `bun src/cli.ts restart` 安全重启通过，`/api/health` 返回 healthy。

Review:

- `passed`。按 `RUNBOOKS/Review.md` 检查 scope、目标覆盖、模式契合、验证证据与回归风险；无 blocking finding。

## Follow-up：工作区/会话边界与会话列表选择修复

Status: `done`

Issue:

- 需要重新评估单实例后“工作区”和“会话”的职责边界，尤其 workflow task 应落在独立会话还是独立工作区。
- 会话列表中的“飞书私聊”无法点击。
- 盯盘任务下方出现 `o9cq80wYiFvJ_f1PWS7aGSJ_nO2Y` 会话，点击后跳回主工作区，怀疑是 IM JID / 工作区 JID / 会话路由映射不一致。

Scope:

- 先沿前端会话列表、工作区 API、IM binding 和 DB 数据定位根因。
- 修复会话列表选择行为与显示归类，不扩大到 workflow schema 重构。
- 给出工作区/会话/工作流归属的产品方案；如涉及长期结构调整，再写入 roadmap。

Validation:

- `passed`：`npm test -- tests/integration/routes/groups.test.ts tests/integration/routes/config-status.test.ts`。
- `passed`：`npm run typecheck:backend`。
- `passed`：`npm --prefix web run build`。
- `passed`：`./scripts/validate.sh`。
- `passed`：`./scripts/review.sh`。

Review:

- `passed`。按 `RUNBOOKS/Review.md` 做语义 review：Web 工作区列表只暴露 `web:` 工作区，IM 注册项继续作为绑定来源由 `/im-groups` 提供；旧 `is_home` 标记不再影响默认主工作区识别，只有 `web:main` 享有不可删除和默认路由语义；路由解析不再回退到同 folder 的 IM JID。

Decision:

- 保留“工作区”概念，用于 cwd、文件边界、仓库级 `.agents`、模型配置和默认主对话；“会话”用于同一工作区内的对话/runtime 边界。
- Workflow task 挂在工作区下执行，但使用独立 workflow context / runtime session；只有 cwd、`.agents` 配置或文件边界确实不同，才创建独立工作区。
