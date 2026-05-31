# 当前任务：排查 /hkipo Web 展示缺失与启动延迟

## Goal

- 查清用户发送 `/hkipo` 后 Web 不展示原始指令的原因。
- 查清用户在 09 分发送、11 分才收到“已启动工作流”的延迟发生在哪一层。
- 若根因在 Cli Claw 命令分发、消息入库或 workflow 触发链路内，修复并补充验证。

## Done when

- 有数据库、日志和代码链路证据说明 `/hkipo` 原始指令为何未在 Web 展示。
- 有时间线说明 09→11 的延迟发生在 Feishu 事件进入服务前、命令分发前、workflow 创建前，还是 workflow 内部。
- 若属于本仓库 bug，相关代码和测试完成；若属于外部平台投递延迟，给出可观测证据与后续监控建议。
- 验证和 review gate 通过；影响运行中服务时走安全重启路径应用。

## Milestones

### Milestone 1：根因定位

Objective:
- 从消息库、workflow 审计、服务日志和命令分发代码定位 Web 不展示与启动延迟的边界。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `src/`、`docs/`、`tests/`
- 只读查询本机 `~/.cli-claw/db/messages.db` 和 `~/.cli-claw/ops/launchd/cli-claw.stdout.log`

Validation:
- 给出一条包含用户输入、workflow run 创建、启动回执、step 开始的时间线。
- 给出 Web 消息展示路径中是否过滤或缺失 `/hkipo` 的明确证据。

Status:
- done

Validation status:
- passed：消息库 13:07-13:14 无 `/hkipo` 原始输入；`workflow_runs` 最新 `hkipo` run 创建于 `2026-05-31T13:11:45.515Z` 且 `trigger_message_id` 为空；`im_message_lifecycle_events` 显示同一 Feishu message `received` 于 `2026-05-31T13:11:45.271Z`、随后 `skipped/slash_command`。服务日志显示消息原始 `createTimeMs=1780232946873` 即 `2026-05-31T13:09:06.873Z`，但 `source=backfill`，且 09:07-09:11 期间持续 `ws connect failed`，说明启动回执延迟发生在 Feishu 长连接离线后的 backfill 到达前，不是 workflow 内部排队。

Review status:
- passed：Web 历史查询 `getMessagesPage/getMessagesAfter` 不过滤 `user_command`；Feishu slash command 分支在发送本地 reply 后直接 return，未调用普通消息的 `storeMessageDirect/broadcastNewMessage`，因此 Web 无可展示记录。

Risks / Notes / Handoff:
- 最新 `/hkipo` workflow run 在服务收到消息同秒创建并立即启动；本轮可控修复应聚焦 IM slash command 原始消息/启动回执可见性，以及 workflow run 绑定 `trigger_message_id`。Feishu 长连接离线造成的外部到达延迟只能通过连接健康和 backfill 观测解释，不能在 workflow 层修复。

### Milestone 2：修复本仓库内可控问题

Objective:
- 若根因是 slash workflow command 未保存原始指令、未绑定 `trigger_message_id`、或 Web 查询过滤错误，则修复源头并补测试。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/`
- `tests/`
- 必要时更新 `docs/COMMAND.md`

Validation:
- 相关定向单测通过。
- `/hkipo` workflow command 能保存原始 slash command 并把 workflow run 绑定到触发消息。

Status:
- done

Validation status:
- passed：新增 Feishu slash command 可见性测试先红后绿，确认 `/hkipo` 这类本地 reply 命令会保存原始 `user_command` 和即时回执；新增 workflow command 测试确认 `triggerMessageId` 会写入 `workflow_runs.trigger_message_id`。`npm test -- tests/unit/messaging/slash-command.test.ts tests/integration/messaging/feishu/connection.test.ts tests/unit/agent/workflow/command.test.ts` 通过 36/36；`npm run typecheck:backend` 通过；`git diff --check` 通过。

Review status:
- passed：改动只在 IM slash command context、Feishu slash command 本地 reply 持久化、workflow trigger id 传递和 Web workflow trigger id 传递路径内；`user_command` 仍被 `getNewMessages` 排除，不会进入普通 Agent 队列。

Risks / Notes / Handoff:
- Feishu slash command 的原始命令使用 Feishu `message_id` 保存，timestamp 使用平台 `create_time`；即时回执使用 Feishu 返回的 sent message id 或本地 UUID 保存。交互卡片类回执在 Web 历史中只保存 summary/占位文本，避免展示原始 card JSON。

### Milestone 3：验证、review、提交与服务应用

Objective:
- 跑完定向验证、review gate、提交，并按安全路径重启服务。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`（仅跨轮次事项）
- 本轮已修改文件

Validation:
- 定向测试。
- `npm run typecheck:backend`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed：`npm test -- tests/unit/messaging/slash-command.test.ts tests/integration/messaging/feishu/connection.test.ts tests/unit/agent/workflow/command.test.ts` 通过 36/36；`npm run typecheck:backend` 通过；`git diff --check` 通过；`./scripts/review.sh` 通过 diff hygiene 与格式检查。

Review status:
- passed：按 `RUNBOOKS/Review.md` 复核 diff，确认 `user_command` 只用于 Web/审计可见性，仍被 `getNewMessages` 排除；Feishu 本地回执持久化只发生在 slash command 本地 reply 路径，不改变 assistant_prompt rewrite 的普通消息入队语义；Web 与 Feishu workflow trigger 都把已保存的触发消息 id 传入 `workflow_runs.trigger_message_id`。

Risks / Notes / Handoff:
- 本轮不能消除 Feishu WebSocket 离线造成的 09:09→09:11 到达延迟；已通过日志证明 workflow run 创建后立即执行。后续若仍频繁掉线，应单独加强 Feishu WS 健康告警/自恢复，而不是调整 `/hkipo` workflow。

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
- `docs/COMMAND.md`
- `src/agent/workflow/command.ts`
- `src/index.ts`
- `src/messaging/channel.ts`
- `src/messaging/manager.ts`
- `src/messaging/providers/feishu/index.ts`
- `src/messaging/providers/wechat/index.ts`
- `src/messaging/slash-command.ts`
- `src/web/app.ts`
- `src/web/context.ts`
- `tests/integration/messaging/feishu/connection.test.ts`
- `tests/unit/agent/workflow/command.test.ts`

Last failure summary:
- 用户反馈 `/hkipo` 在 Web 不展示，且 09 分发送后 11 分才收到“已启动工作流”回执。

Suspected cause:
- 已确认。Feishu slash command 分支没有保存原始命令和即时回执；workflow command 入口没有接收/传递 `trigger_message_id`。09→11 延迟来自 Feishu WebSocket 离线重连期间的 backfill，到达服务后处理仅约 260ms。

Next step:
- 本轮实现完成；提交后按安全路径重启服务，让运行中 backend 加载新 slash command 可见性逻辑。
