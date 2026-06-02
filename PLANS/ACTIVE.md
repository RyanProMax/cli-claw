# 当前任务：排查并修复 `/kol` 8:25 入站、9:55 才处理的延迟

## Goal

- 查清 2026-06-02 早上约 8:25 发送的 `/kol` 为什么到约 9:55 才开始处理。
- 修复导致 `/kol` 或同类 IM workflow 命令长时间滞留的根因。
- 用自动化测试覆盖复现场景，避免以后再次出现“已收到但长时间不启动 workflow”的问题。

## Done when

- 根因有证据链：入站事件、消息落库、队列/调度、workflow run、runner 或 usage guard 的时间点能对齐。
- 修复完成，且测试覆盖失败前行为与修复后行为。
- 当前 milestone 验证通过，并经过 review gate。
- 若改动影响正在运行服务，提交后按安全重启路径应用变更。

## Milestones

### Milestone 1：根因调查

Objective:
- 查询本地 DB、Feishu lifecycle、workflow run/step、task run log 和服务日志，定位 8:25 到 9:55 的延迟发生在哪个边界。
- 阅读相关代码路径，形成单一根因假设，不在根因确认前改代码。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `src/`、`.agents/`、`docs/`、`tests/`
- 只读查询本地数据库、日志和 ops 状态文件

Validation:
- 记录关键时间点、涉及文件/函数和根因结论。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- `/kol` 原始消息 `om_x100b6ed8f5fef4acc0af684156e4108` 的 message timestamp 是 `2026-06-02T12:25:23.346Z`（美东 08:25:23）。
- 对应 workflow run `wfrun_164837b3-cd5a-4b0b-b6c9-f9e447c40ae9` 在 `2026-06-02T13:55:47.882Z`（美东 09:55:47）创建并立刻 started，说明 workflow/runner 没有排队 90 分钟。
- lifecycle 第一条 `received` 也是 `2026-06-02T13:55:47.768Z`，details 为 `{"source":"backfill","messageType":"text","chatType":"p2p","createTimeMs":1780403123346}`；8:25 没有 live WS received/stored 记录。
- 服务日志显示 `2026-06-02 08:22:45` 记录 `Feishu WebSocket appears offline`，之后 SDK 持续输出 `ws connect failed`，下一次应用层 `Feishu WebSocket reconnected` 直到 `2026-06-02 09:55:47`；`/kol` 正好落在这个离线窗口。
- 根因：Feishu provider 的 backfill 只在 startup、应用层 reconnect 成功、offline→online 恢复时执行；WS 长时间离线/SDK 自重连但应用层未完成 reconnect 时，没有离线期周期性 backfill 兜底，导致消息必须等下一次成功 reconnect 才处理。

### Milestone 2：复现测试与实现修复

Objective:
- 写一个最小失败测试复现根因。
- 实现最小修复，覆盖 `/kol` workflow 命令或同类 IM workflow 命令的滞留场景。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/messaging/`
- `src/agent/queue/`
- `src/agent/workflow/`
- `src/agent/scheduler/`
- `src/storage/`
- `tests/`
- 必要时同步 `docs/ARCHITECTURE.md`、`docs/RUNTIME.md` 或 `docs/COMMAND.md`

Validation:
- 定向测试先红后绿。
- 与改动相关的 unit/integration 测试通过。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 修复必须处理根因，不只对 `/kol` 做一次性补偿。
- 已新增红灯测试 `backfills known chats while websocket remains offline awaiting sdk reconnect`：WS closed、SDK next reconnect time 仍很远时，修复前不会调用 `message.list`，测试失败。
- 修复后 Feishu 健康检查在离线窗口内按 60 秒节流执行 `offline-health-check` backfill，不再等待应用层 reconnect 成功才回填消息；reconnect/recovered/startup 成功后会重置节流状态。
- 已同步 `docs/ARCHITECTURE.md` 的 IM 消息可靠性契约。
- 已把 Feishu E2E footer helper 同步到当前 footer 契约：不再期待重复的 `| 飞书 |`。
- 验证通过：
  - `npm test -- tests/integration/messaging/feishu/connection.test.ts -t "backfills known chats while websocket remains offline awaiting sdk reconnect"`（先红后绿）
  - `npm test -- tests/integration/messaging/feishu/connection.test.ts`
  - `npm test -- tests/integration/messaging/feishu/e2e.test.ts`
  - `npm run typecheck:backend`
- Feishu E2E 仍出现既有 `MaxListenersExceededWarning`，测试通过；该 warning 来自测试进程多次挂载 process listener，不是本轮 Feishu provider 逻辑新增。

### Milestone 3：验证、review、提交与服务应用

Objective:
- 运行定向验证、必要 typecheck、review gate。
- 更新 `PLANS/ACTIVE.md` 结果与 handoff；若有跨轮次事项，回写 `PLANS/ROADMAP.md`。
- 默认提交并按安全路径重启服务。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`（仅跨轮次事项）
- 本轮已修改文件

Validation:
- 定向测试
- `npm run typecheck:backend`（若改动 TS 后端）
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 如果真实 Feishu/live smoke 需要发消息，遵守 `docs/E2E.md` 的 `[e2e]` 前缀和凭据安全边界。
- 最终验证通过：
  - `npm test -- tests/integration/messaging/feishu/connection.test.ts tests/integration/messaging/feishu/e2e.test.ts`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/review.sh`
- 已按 `RUNBOOKS/Review.md` 做语义 review：scope 聚焦 Feishu provider/message tests/docs；目标覆盖 8:25→9:55 的 WS 离线 backfill 缺口；测试含红绿复现；未发现 debug/TODO、无多余文档重复。
- 本轮不需要更新 `PLANS/ROADMAP.md`：修复已落地，无新的跨轮次待办；后续只需观察真实 Feishu WS 离线时 lifecycle 是否能在 60 秒级 backfill 到消息。
- 已提交实现：`Backfill Feishu messages while websocket is offline`。
- 已按安全路径重启服务：restart intent `restart-2026-06-02T16-14-39-593Z-f4e634ee.json`，状态 `passed`；当前 backend PID `82453`，`GET /api/health` 返回 `healthy`，database 与 queue 均为 `true`。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 验证失败和 review 失败都留在当前 milestone 修复，不能跳过。
- 只有 `Validation status: passed` 且 `Review status: passed` 后，milestone 才能标记为 `done`。

## Handoff

Current milestone:
- Milestone 3 done

Current status:
- complete; validation, review, commit and safe restart all done

Changed files:
- `PLANS/ACTIVE.md`
- `docs/ARCHITECTURE.md`
- `src/messaging/providers/feishu/index.ts`
- `tests/integration/messaging/feishu/connection.test.ts`
- `tests/integration/messaging/feishu/e2e.test.ts`

Findings:
- 8:25 的 `/kol` 没有进入 live WS；9:55 由 backfill 首次 received 后才创建 workflow。根因是 WS 离线窗口内只等待 SDK/app reconnect 成功才执行 backfill，没有离线期周期 backfill 兜底。

Next step:
- 无。若后续再次出现 Feishu 消息延迟，优先检查 WS offline lifecycle、`offline-health-check` backfill 日志和 `im_message_lifecycle_events.created_at - messages.timestamp` 的差值。
