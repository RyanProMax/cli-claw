# 当前任务：修复线上 Feishu 报错与 HKIPO 重复触发

## Goal

- 定位用户反馈的线上 `TypeError: Cannot read properties of undefined (reading 'map')` 报错原因并修复。
- 定位 `/hkipo` 约每 30 分钟重复执行的触发链路，阻断重复触发。
- 完成相关回归测试、统一验证、review gate，并按安全重启路径让当前服务加载修复。

## Done when

- 已解释线上现象、根因和修复点。
- `/hkipo` 旧 backfill 消息不会在内存去重 TTL 过期后再次触发 workflow。
- Codex Responses 终态输出缺少 `message.content` 或 `reasoning.summary` 时不再抛原始 SDK TypeError。
- `./scripts/validate.sh` 和 `./scripts/review.sh` 通过，或清楚记录外部阻塞。
- 服务通过 `cli-claw restart` 或 repo-local fallback 安全重启，并验证新进程健康。

## Milestones

### Milestone 1：事故复现与根因确认

Objective:
- 从本地 DB、生命周期事件、workflow run 和当前进程确认重复触发与线上报错来源。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `~/.cli-claw/db/messages.db`
- 只读检查 `~/.cli-claw/ops/**` 与 `~/.cli-claw/groups/**/logs/**`
- `src/**`
- `container/agent-runner/**`
- `tests/**`

Validation:
- DB 查询能证明重复 `/hkipo` run 来源、时间间隔和触发类型。
- 日志能证明当前报错栈和运行进程是否加载最新代码。

Status:
- done

Validation status:
- passed：`workflow_runs` 显示 `hkipo` 从 `2026-05-28T22:47:11.031Z` 到 `2026-05-29T02:22:58.117Z` 约每 30 分钟运行一次，metadata source 为 `slash-command`，而 `scheduled_tasks` 为空；`im_message_lifecycle_events` 显示同一条 backfill 消息反复被拉取，内存去重 TTL 为 30 分钟。当前服务 PID 47762 启动于 `2026-05-27T15:01:51.128Z`，早于上一轮修复提交。线上新报错栈来自 `@openai/agents-openai` `convertToOutputItem(... content.map/summary.map ...)`。

Review status:
- passed：复现阶段只做只读 DB / 日志 / 代码检查，未打印 secret。

Risks / Notes / Handoff:
- 上一轮 CardKit fallback TypeError 已在代码和测试中修复，但服务未安全重启，所以现网仍跑旧进程；本次用户看到的 `reading 'map'` 是另一条 Codex Responses SDK 兼容性问题。

### Milestone 2：修复 backfill 重复触发与 Codex 终态兼容

Objective:
- 增加持久化 backfill 去重判断，阻止已处理旧消息再次触发 slash command。
- 对 Codex Responses 终态 output 做最小规范化，避免缺字段触发 SDK 内部 TypeError。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/index.ts`
- `container/agent-runner/src/codex-cli-provider.ts`
- `tests/integration/messaging/feishu/connection.test.ts`
- `tests/contracts/openai/runner-request.test.ts`

Validation:
- 相关回归测试先在旧实现失败，再在修复后通过。

Status:
- done

Validation status:
- passed：新增 Feishu backfill 持久化重复消息回归测试先在旧实现上失败，证明旧逻辑会再次调用 `/hkipo` slash command；修复后通过。新增 Codex terminal malformed output 回归测试先在旧实现上失败，复现 `Cannot read properties of undefined (reading 'map')`；修复后通过。`npm test -- tests/integration/messaging/feishu/connection.test.ts` 24/24 通过；`npm test -- tests/contracts/openai/runner-request.test.ts` 9/9 通过。

Review status:
- passed：修复限制在 backfill 持久化去重与 Codex terminal output 规范化；live ws 实时消息路径不走持久化 backfill 去重，已有 stale/live ws 回归覆盖仍通过。

Risks / Notes / Handoff:
- backfill 持久化去重只应用于 `source='backfill'`，不改变 live ws 的实时消息处理。

### Milestone 3：全量验证、review gate、服务安全重启

Objective:
- 跑通仓库验证与 review gate，提交修复并安全重启当前服务。

Allowed scope:
- `PLANS/ACTIVE.md`
- 本轮已修改文件
- 只读检查 `~/.cli-claw/ops/restarts/**`、`~/.cli-claw/ops/current-backend.json`

Validation:
- `npm test -- tests/integration/messaging/feishu/connection.test.ts`
- `npm test -- tests/contracts/openai/runner-request.test.ts`
- `npm test -- tests/integration/messaging/feishu/e2e.test.ts`
- `FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=<private_chat_id> npm test -- tests/live/feishu/message-smoke.test.ts`
- `./scripts/validate.sh`
- `./scripts/review.sh`
- `/Users/ryan/.bun/bin/bun src/cli.ts restart` 或 `cli-claw restart`
- `curl http://127.0.0.1:3000/api/health`

Status:
- done

Validation status:
- passed：相关单测已通过：`tests/integration/messaging/feishu/connection.test.ts` 24/24，`tests/contracts/openai/runner-request.test.ts` 9/9。仓库统一验证 `./scripts/validate.sh` 通过：Vitest 75 个文件通过、1 个 skipped，511 个测试通过、1 个 skipped，typecheck 和 build 通过。Feishu in-process E2E `npm test -- tests/integration/messaging/feishu/e2e.test.ts` 通过：14/14。真实飞书 live smoke 使用当前私聊入口发送并读回 `[e2e]` 消息，通过：1/1。safe restart 使用 repo-local launcher `/Users/ryan/.bun/bin/bun /Users/ryan/projects/cli-claw/src/cli.ts restart`，intent `restart-2026-05-29T03-07-08-096Z-8199a1ee` 状态 passed；服务从旧 PID 47762 切到新 PID 81958，`/api/health` 返回 healthy。重启后 DB 查询 `hkipo_runs_after_restart=0`，launchd stdout 最近 300 行未再出现 `/hkipo` 重跑或 `Cannot read properties of undefined (reading 'map')`。

Review status:
- passed：`./scripts/review.sh` 通过，人工语义 review 通过；变更未扩展到调度器或 Feishu 凭据存储，secret 检查只输出存在性和 appId 短前缀。

Risks / Notes / Handoff:
- 运行日志仍存在飞书 WebSocket reconnect 噪声，但重连后 Feishu backfill finished，服务健康、IM channel connected；这不是本轮 `/hkipo` 重复触发或 Codex `.map` TypeError 的阻塞项。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 验证失败和 review 失败都留在当前 milestone 修复，不能跳过。
- 只有 `Validation status: passed` 且 `Review status: passed` 后，milestone 才能标记为 `done`。

## Handoff

Current milestone:
- Milestone 3

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/index.ts`
- `container/agent-runner/src/codex-cli-provider.ts`
- `tests/integration/messaging/feishu/connection.test.ts`
- `tests/contracts/openai/runner-request.test.ts`

Last failure summary:
- 已修复：旧 backfill slash command 现在会根据持久化生命周期直接跳过；Codex terminal output 缺数组字段时不再触发 SDK `.map()` TypeError。

Suspected cause:
- Feishu backfill 只依赖 30 分钟内存 message cache 去重，旧 slash command 每次 TTL 过期后会被重新当成新消息处理。
- Codex Responses 终态 output 某些 item 缺 `content` / `summary` 数组，SDK `convertToOutputItem` 未防御并直接 `.map()`。

Next step:
- 提交本轮修复；若后续飞书 WebSocket 仍持续重连，可单独跟进连接稳定性。
