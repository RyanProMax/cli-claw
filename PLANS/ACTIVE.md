# 当前任务：排查并修复飞书长连接频繁断连/延迟

## Goal

- 明确飞书最近经常断连、消息从秒回变成延迟的原因，判断是否由近期代码改动导致。
- 修复 Cli Claw 自身造成的 WS 重连抖动或 backfill 延迟放大问题；保留离线补偿能力。
- 用测试覆盖 Feishu SDK 自连期间的健康检查行为和离线 backfill 延迟边界；验证、review、提交、push，并按安全路径重启服务。

## Done when

- 已基于日志和代码提交链给出明确根因，不把网络、飞书平台和本地代码混为一谈。
- Feishu SDK 正在自动重连时，Cli Claw 不再主动 `close()` / 重建 WSClient 打断 SDK 自连。
- WS 离线时 backfill 间隔缩短，用户消息不再因为 60s 轮询窗口被放大到分钟级。
- 定向测试先红后绿，相关 Feishu provider 测试、typecheck、review gate 通过。
- 服务已安全重启，观察日志确认健康状态与新的连接行为。
- 提交并 push。

## Milestones

### Milestone 1：根因定位与红测

Objective:
- 读取当前服务日志、SDK WSClient 实现和近期 Feishu 相关提交，明确断连/延迟链路。
- 先写失败测试，覆盖 SDK `isConnecting=true` 自动重连期间不应被健康检查手动重建。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `node_modules/@larksuiteoapi/node-sdk/lib/index.js`
- 只读检查 `src/messaging/providers/feishu/index.ts`
- `tests/integration/messaging/feishu/connection.test.ts`

Validation:
- 红测能证明当前实现会在 SDK 自连中触发手动 `WSClient` 重建。

Status:
- done

Validation status:
- passed: `npx vitest run tests/integration/messaging/feishu/connection.test.ts -t "keeps SDK reconnect"` 先红后绿

Review status:
- passed: 根因定位和红测 scope 符合计划

Risks / Notes / Handoff:
- 日志证据：当前 PID `17911` 从 `2026-06-05 04:36:02` 启动后，`Feishu WebSocket connected` 约 15 秒后连续出现 `Feishu WebSocket appears offline`，SDK 同时输出 `[ws] ws connect failed`、`[ws] reconnect` 和 `ws client ready`。
- 真实延迟证据：`2026-06-05 05:00:06.536` 创建的 `/kol` 消息直到 `05:00:19.502` 才由 `backfill` 收到；若消息落在 `OFFLINE_BACKFILL_INTERVAL_MS=60_000` 窗口后，延迟可被放大到约一分钟，旧 token bug 会进一步导致完全静默。
- 近期改动关联：`8781bca Backfill Feishu messages while websocket is offline` 引入 offline backfill 和手动健康检查重连；它不是 WS 真实网络失败的唯一来源，但会在 SDK 自动重连期间增加手动关闭/重建，造成重连抖动和 60s 轮询延迟。
- SDK 证据：`WSClient.start()` 内部只调用 `this.reConnect(true)`，没有 `await`；Cli Claw 当前 `await wsClient.start()` 后立即把 `lastWsStateConnected=true` 并调用 `onReady()`，这是乐观状态，不代表底层 socket 已稳定。

### Milestone 2：实现、验证、服务应用

Objective:
- 修复健康检查与 SDK 自动重连的冲突；缩短离线 backfill 间隔。
- 完成验证、review、提交、push 和安全重启。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/index.ts`
- `tests/integration/messaging/feishu/connection.test.ts`
- 必要时同步 owner docs

Validation:
- 新增定向测试通过
- `npx vitest run tests/integration/messaging/feishu/connection.test.ts`
- `npm run typecheck:backend`
- `git diff --check`
- `./scripts/review.sh`
- 安全重启后 `/api/health` healthy，并观察 Feishu 日志

Status:
- done

Validation status:
- passed:
  - `npx vitest run tests/integration/messaging/feishu/connection.test.ts -t "keeps SDK reconnect"`
  - `npx vitest run tests/integration/messaging/feishu/connection.test.ts`
  - `npx vitest run tests/integration/messaging/feishu/kol-command-e2e.test.ts tests/integration/messaging/feishu/e2e.test.ts`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/validate.sh`
  - `bun src/cli.ts restart`
  - `curl -fsS http://127.0.0.1:3000/api/health`

Review status:
- passed: `./scripts/review.sh` 通过；人工 diff review 未发现 blocking/important 问题

Risks / Notes / Handoff:
- 不改变 Feishu SDK 自身自动重连策略；本轮只避免 Cli Claw 与 SDK 重连相互打断，并减少 fallback 轮询延迟。
- 若后续仍持续 `ws connect failed`，剩余根因更可能在本机到飞书 WS 网关的网络路径或 Feishu 长连接服务侧，需要用 SDK endpoint / 网络探针继续定位。
- `./scripts/validate.sh` 已通过；输出中仍有既有 `MaxListenersExceededWarning` 与 Vite chunk size warning，非本轮新增失败。
- 安全重启 intent `restart-2026-06-05T09-09-32-003Z-aef02a62` 状态 `passed`；当前 backend PID `20678`；连续健康检查均为 `healthy`。
- 重启后观察：`05:09:48` 到 `05:14:48` 仍有 SDK `[ws] ws connect failed`，但未再出现 Cli Claw 手动 `Feishu WebSocket reconnected` 或 `ws client closed manually` 循环；`offline-health-check` backfill 约 15 秒级持续运行。

## Handoff

Current milestone:
- Milestone 2 done

Current status:
- 已定位到“真实 WS 连接失败 + 本地健康检查重建放大”的组合根因；红测已先失败后通过，完整验证、review gate、安全重启和日志观察均已通过，等待提交并 push。

Changed files:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/index.ts`
- `tests/integration/messaging/feishu/connection.test.ts`

Findings:
- REST `https://open.feishu.cn` 当前可达；日志里的 WS 错误是长连接路径，不是普通 REST 全断。
- 当前实现的 60s offline backfill 会把断线期间消息延迟放大；上一轮 token recovery 修复了静默丢消息，但没有解决 WS 重连抖动。

Next step:
- 提交并 push。
