# 当前任务：移除 Web 用量统计残留

> **给 agentic workers：** 用户指出 WebUI 仍残留“用量统计”类看板。本轮目标是全局扫描并删除 Web 可见用量统计入口和其专用聚合数据面；保留 scheduled task / workflow 的 OpenAI usage guard，因为它是运行时保护，不是 Web 看板。

## 背景

上一轮删除了 Billing 商业化层，但保留了 OpenAI 用量统计页、设置 tab、`/api/usage/*` 聚合接口、`usage_records` / `usage_daily_summary` 写入，以及聊天/飞书 footer 中的 5h / 7d remaining usage 展示。用户认为这类 WebUI 看板也属于应清理的残留。

## 目标

- 删除 Web 设置里的“用量统计”入口、移动 tab、`/usage` redirect、`UsagePage` 和 `useUsageStore`。
- 删除 `/api/usage/*` route 和仅服务该页面的 DB 聚合查询 / `usage_records` 写入逻辑。
- 删除消息 footer 中的 OpenAI remaining usage 百分比展示，避免 Web/IM 正文尾部继续出现用量窗口。
- 删除 Web `系统监控` 看板入口、页面、store 和展示组件；保留 `/api/health` 与 `/api/status`，因为聊天恢复 active state 和安全重启健康检查仍依赖它们。
- 保留 runtime usage snapshot 与 scheduler usage guard，继续用于定时任务低额度延后。
- 更新计划和必要文档，完成验证、review、提交与安全重启。

## 非目标

- 不删除自动化 / 工作流看板。
- 不删除消息 runtime identity footer 中的模型、reasoning、speed 等运行时身份信息。
- 不删除 scheduled workflow 的 usage guard 和 OpenAI usage API probe。

## Milestones

### Milestone 1：残留扫描与根因确认

Objective:

- 扫描 Web 路由、设置 tabs、stores、API routes、DB 聚合和 footer 展示，确认所有用量统计残留。

Allowed scope:

- 只读搜索源码、测试、文档
- `PLANS/ACTIVE.md`

Validation:

- 搜索结果能解释 WebUI 残留来源。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 根因：上一轮 scope 只删除 Billing，没有删除独立 OpenAI usage dashboard；残留集中在 `UsagePage` / `useUsageStore` / `/api/usage` / settings `usage` tab / footer remaining usage。

### Milestone 2：删除 Web 可见用量统计与聚合数据面

Objective:

- 删除 Web 可达用量统计页面和 API。
- 删除 Web 可达系统监控看板，但保留状态 / 健康 API。
- 删除仅服务看板的 `usage_records` / `usage_daily_summary` 写入、迁移和查询函数。
- 调整 footer，使其不展示 5h / 7d remaining usage。

Allowed scope:

- `web/src/**`
- `src/web/**`
- `src/storage/db.ts`
- `src/index.ts`
- `src/core/runtime/usage.ts`
- `shared/stream-event.ts`
- `shared/assistant-meta-footer.ts`
- `tests/**`
- owner docs 中相关模块说明

Validation:

- `rg` 不再命中 `UsagePage`、`useUsageStore`、`/api/usage`、Web 设置 `usage` tab、remaining usage footer、`MonitorPage` 和 Web 监控组件。
- 直接相关测试通过。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- `messages.token_usage` 可作为旧数据列保留，但不应再驱动 Web 可见用量看板。
- 已删除 Web usage 页面 / store / settings tab / `/usage` redirect / `/api/usage` route / `recharts` 依赖。
- 已删除 Web Monitor 页面 / store / settings tab / `/monitor` redirect / `components/monitor/**`；保留后端 `/api/health` 与 `/api/status`。
- 已删除 footer remaining usage 展示和 shared stream event 中的旧 footer usage 字段。
- `usage_records` / `usage_daily_summary` 保留 `DROP TABLE IF EXISTS`，用于清理历史库表，不是功能残留。

### Milestone 3：验证、review、提交与重启

Objective:

- 完成 typecheck / build / test / review gate。
- 提交并安全重启服务。

Allowed scope:

- 本轮触及源码、测试、文档与 `PLANS/ACTIVE.md`

Validation:

- `git diff --check`
- `npm run typecheck`
- `npm run build:web`
- 相关单测
- `./scripts/review.sh`
- 如有跨层影响，补跑 `./scripts/validate.sh`

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- `./scripts/validate.sh` 通过：75 个测试文件通过、1 个 skipped；515 个测试通过、1 个 skipped；typecheck 与 build 完成。Vite 仍有既有 large chunk warning。
- `./scripts/review.sh` 通过格式 gate；语义 review 结论 passed。
- `git diff --check` 通过。
- 残留扫描：`web/src` 对 usage / monitor 看板关键字 0 命中；更宽扫描只剩 `usage_records` / `usage_daily_summary` 的历史表 `DROP TABLE` 和 scheduler usage guard 相关字段。
- 安全重启：`bun src/cli.ts restart` 创建 intent `restart-2026-05-23T04-04-24-511Z-d61a2c36`，结果 `status: passed`；`curl http://127.0.0.1:3000/api/health` 返回 healthy。

## Handoff

Current milestone:

- Milestone 3

Current status:

- done

Changed files:

- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `docs/COMMAND.md`
- `docs/MODULE.md`
- `shared/assistant-meta-footer.ts`
- `shared/stream-event.ts`
- `src/agent/scheduler/usage-guard.ts`
- `src/core/runtime/agent-runtime.ts`
- `src/core/runtime/openai-codex-usage.ts`
- `src/core/runtime/usage.ts`
- `src/index.ts`
- `src/messaging/providers/feishu/streaming-card.ts`
- `src/storage/db.ts`
- `src/web/app.ts`
- `tests/unit/core/runtime/usage.test.ts`
- `tests/unit/messaging/feishu/streaming-card.test.ts`
- `tests/unit/messaging/slash-command.test.ts`
- `tests/unit/presentation/assistant-meta-footer.test.ts`
- `web/package.json`
- `web/package-lock.json`
- `web/src/App.tsx`
- `web/src/components/common/Skeletons.tsx`
- `web/src/components/settings/SettingsNav.tsx`
- `web/src/components/settings/types.ts`
- `web/src/pages/SettingsPage.tsx`
- `web/src/stores/chat.ts`
- deleted: `src/core/runtime/usage-command.ts`
- deleted: `src/web/routes/usage.ts`
- deleted: `tests/unit/core/runtime/usage-command.test.ts`
- deleted: `web/src/pages/UsagePage.tsx`
- deleted: `web/src/stores/usage.ts`
- deleted: `web/src/pages/MonitorPage.tsx`
- deleted: `web/src/stores/monitor.ts`
- deleted: `web/src/components/monitor/*.tsx`

Last failure summary:

- 首次 `./scripts/validate.sh` 失败是因为 `tests/unit/messaging/feishu/streaming-card.test.ts` 仍断言 5h / 7d footer；已删除旧断言并重跑通过。

Suspected cause:

- 已修复。

Next step:

- 任务完成；无待执行项。
