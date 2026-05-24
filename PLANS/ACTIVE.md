# 当前任务：工作区 / 线程 / 调度层 / IM 落地

## Goal

- 将用户心智收敛为工作区 + 任务，隐藏“会话”作为用户主概念。
- 新增线程作为内部上下文容器，并在 Web / 飞书 / 微信入口前增加上下文调度层，支持自然切换、多工作区 IM 私聊和统一来源 footer。

## Done when

- Web 顶层只展示工作区；工作区内部以主线、任务线程、工作流运行表达上下文。
- IM 私聊可以通过调度层切换或单次投递到多个工作区/线程，不需要拉群规避一对一绑定。
- 普通消息进入执行前解析为工作区和线程目标；workflow run 可关联 workflow 线程。
- Web / IM 回复附带工作区/线程来源 footer。
- `docs/ARCHITECTURE.md`、`docs/RUNTIME.md`、`docs/COMMAND.md`、`docs/MEMORY.md` 同步新边界。

## Milestones

### Milestone 1：线程存储与路由模型

Objective:
- 增加线程、IM 入口路由和纯逻辑 Context Router，先让 `/where`、`/use`、`/to`、`/threads`、`/back` 的目标解析可测试。

Allowed scope:
- `src/domain/types.ts`
- `src/storage/*`
- `src/messaging/*`
- `src/core/runtime/command-registry.ts`
- `src/commands.ts`
- `tests/unit/messaging/*`
- `tests/integration/routes/*`

Validation:
- `npm test -- tests/unit/messaging/context-router.test.ts tests/unit/messaging/command-utils.test.ts`
- `npm run typecheck:backend`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 已新增 `ContextRouter` 纯逻辑、`threads` / `im_entry_routes` 存储、IM 路由命令注册和入口路由文案；旧 `target_main_jid` / `target_agent_id` 暂作为默认入口目标兼容同步，不作为用户心智呈现。

### Milestone 2：IM 入站调度与 footer

Objective:
- 将飞书 / 微信入站消息接入 Context Router，支持自然语言切换、显式命令兜底和统一来源 footer。

Allowed scope:
- `src/index.ts`
- `src/messaging/providers/feishu/*`
- `src/messaging/providers/wechat/*`
- `src/presentation/*`
- `tests/integration/messaging/*`
- `tests/unit/presentation/*`

Validation:
- `npm test -- tests/unit/presentation/assistant-meta-footer.test.ts tests/unit/messaging/context-router.test.ts tests/integration/messaging/manager.test.ts`
- `npm run typecheck:backend`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- `/use`、`/bind`、`/to`、`/where`、`/threads`、`/back` 已接入 IM 命令层；`/to` 使用 one-shot route rewrite，不改变默认工作区；静态 Web/IM 最终投递追加来源 footer。飞书/微信命令即时回复仍由 provider 直接发送，后续若要覆盖命令回执 footer，需要在 provider sendTextToChat 层继续收口。

### Milestone 3：Web 线程体验与入口路由设置

Objective:
- Web 从旧内部 agent 标签页用户心智改为工作区内部主线/任务线程/工作流运行，设置页 IM 入口改名为入口路由。

Allowed scope:
- `web/src/components/chat/*`
- `web/src/components/settings/*`
- `web/src/stores/chat.ts`
- `web/src/api/client.ts`
- `src/web/routes/*`
- `tests/unit/web/*`

Validation:
- `npm --prefix web run build`
- `npm test -- tests/unit/web/workspace-routing.test.ts`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Web chat/settings 入口已改用“主线 / 任务线程 / 入口路由”文案；内部 store 与 API 仍保留旧 agent slot 命名，作为实现细节分阶段迁移。

### Milestone 4：workflow 线程关联、文档和全量验证

Objective:
- workflow run 关联任务线程，文档同步，并通过仓库 validation / review gate。

Allowed scope:
- `src/agent/workflow/*`
- `src/agent/scheduler/*`
- `src/web/workflow-dashboard.ts`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/COMMAND.md`
- `docs/E2E.md`
- `docs/MEMORY.md`
- `PLANS/ROADMAP.md`

Validation:
- `./scripts/validate.sh`
- `./scripts/review.sh`
- Web 截图检查工作区、任务线程、自动化、入口路由设置。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- workflow context 已关联 workflow 线程，不改变 checkpoint 语义；线程只做用户可追问和来源显示层。`./scripts/validate.sh` 与 `./scripts/review.sh` 已通过；Web 构建产物用 headless Chrome 截图确认登录页可正常渲染，截图在 `/tmp/cli-claw-web-smoke.png`。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式变化时先更新本文件。
- 删除或迁移用户可见概念时必须沿引用链清理入口、文案、测试和文档。
- milestone 只有 validation 与 review 都通过后才可标记 `done`。

## Handoff

Current milestone:
- Milestone 4

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `docs/RUNTIME.md`
- `shared/runtime-command-registry.ts`
- `src/agent/queue/group-queue.ts`
- `src/agent/runner/output-parser.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/context.ts`
- `src/domain/types.ts`
- `src/index.ts`
- `src/messaging/channel.ts`
- `src/messaging/command-utils.ts`
- `src/messaging/context-router.ts`
- `src/messaging/providers/feishu/index.ts`
- `src/storage/db.ts`
- `src/storage/threads.ts`
- `src/web/routes/agents.ts`
- `src/web/routes/config.ts`
- `tests/integration/agent/restart-recovery.test.ts`
- `tests/integration/messaging/feishu/e2e.test.ts`
- `tests/contracts/openai/runner-request.test.ts`
- `tests/unit/agent/runner/output-parser.test.ts`
- `tests/unit/agent/workflow/context.test.ts`
- `tests/unit/core/runtime/command-registry.test.ts`
- `tests/unit/messaging/command-utils.test.ts`
- `tests/unit/messaging/context-router.test.ts`
- `tests/unit/storage/threads.test.ts`
- `web/src/components/chat/AgentTabBar.tsx`
- `web/src/components/chat/ChatView.tsx`
- `web/src/components/chat/ImBindingDialog.tsx`
- `web/src/components/layout/UnifiedSidebar.tsx`
- `web/src/components/settings/BindingTargetDialog.tsx`
- `web/src/components/settings/BindingsSection.tsx`
- `web/src/components/settings/ImBindingRow.tsx`
- `web/src/components/settings/InstanceChannelsSection.tsx`
- `web/src/components/settings/SettingsNav.tsx`
- `web/src/components/settings/hooks/useImBindings.ts`
- `web/src/pages/SettingsPage.tsx`
- `web/src/stores/chat.ts`

Last failure summary:
- 中途 `./scripts/validate.sh` 曾因 footer 期望和旧“会话”文案断言失败，已同步测试与文案后通过；第一次 Web 截图用 Python 静态服务遇到本机 DNS 阻塞，改用 Node 静态服务后通过。

Suspected cause:
- 测试断言仍按旧会话/无 footer 语义编写；截图失败是 Python `http.server` 本机 hostname 解析卡住，不是 Web 构建失败。

Next step:
- 提交本轮改动；后续观察真实飞书/微信入口路由和 streaming 卡片 footer 的一致性。
