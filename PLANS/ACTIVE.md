# 当前任务：修复 e2e 验证报错

## Goal

- 复现当前 e2e 验证流程的报错，定位根因并完成最小修复。
- 跑通本轮要求的 e2e 验证流程、仓库验证和 review gate 后再结束。

## Done when

- 已记录 e2e 失败现象、根因和修复点。
- 相关 e2e 用例通过；若涉及飞书 live smoke，按 `docs/E2E.md` 只读发现凭据并使用 `[e2e]` 消息前缀执行。
- `./scripts/validate.sh` 和 `./scripts/review.sh` 通过，或清楚记录不可运行的外部阻塞。
- 当前 diff 只包含本轮修复、计划记录和必要的测试/文档同步。
- validation 和 review 都通过后提交本轮改动。

## Milestones

### Milestone 1：复现并定位 e2e 报错

Objective:
- 用真实验证命令复现 e2e 报错，沿错误栈和相关代码定位根因。

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/E2E.md`
- `tests/**`
- `src/**`
- `shared/**`
- `container/agent-runner/**`
- `package.json`
- `scripts/**`
- 只读检查 `~/.cli-claw/db/messages.db` 和 `~/.cli-claw/config/feishu-provider.json` 的凭据状态，不打印 secret。

Validation:
- 运行直接相关 e2e 命令并记录失败输出。
- 必要时运行只读凭据发现查询。

Status:
- done

Validation status:
- passed：`npm test -- tests/integration/messaging/feishu/e2e.test.ts` 通过；`FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=oc_98f0bb60f284627bf20f9386704f8c82 npm test -- tests/live/feishu/message-smoke.test.ts` 通过；`./scripts/validate.sh` 通过但输出中存在 `client.cardkit.v1` 缺失导致的 fallback TypeError 日志。

Review status:
- passed：复现阶段只做只读凭据发现和验证命令执行；未写入真实 DB 或 secret，根因记录与后续修复方向一致。

Risks / Notes / Handoff:
- 根因：`StreamingCardController.appendThinking()` 会在 idle 状态异步创建卡片；部分测试用 `{}` client 只验证内部状态，但实现先无条件访问 `client.cardkit.v1.card.create`，缺少 CardKit 能力判断，导致进入 legacy fallback 前先抛 TypeError 并污染验证日志。真实 e2e 与 live smoke 均通过，问题是 fallback 可观测噪音而非消息链路失败。

### Milestone 2：修复根因并补充回归覆盖

Objective:
- 针对已确认根因做最小修复，并用相关 e2e / 单测证明回归不再出现。

Allowed scope:
- `PLANS/ACTIVE.md`
- `docs/E2E.md`
- `tests/**`
- `src/**`
- `shared/**`
- `container/agent-runner/**`
- `package.json`
- `scripts/**`

Validation:
- 失败的相关 e2e 命令通过。
- 如新增或调整测试，完成 red / green 或等价回归验证记录。

Status:
- done

Validation status:
- passed：新增回归测试先在旧实现上失败，失败信息确认旧路径会记录 `CardKit full-update unavailable...` 且 `err` 是 `Cannot read properties of undefined (reading 'v1')`；实现后该测试通过。`npm test -- tests/unit/messaging/feishu/streaming-card.test.ts` 47/47 通过，`npm test -- tests/integration/messaging/feishu/e2e.test.ts` 14/14 通过，`FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=oc_98f0bb60f284627bf20f9386704f8c82 npm test -- tests/live/feishu/message-smoke.test.ts` 1/1 通过。

Review status:
- passed：修复限制在 Feishu streaming card client capability 判断和对应单测；未改变消息内容、路由或 live smoke 契约。

Risks / Notes / Handoff:
- 真实 e2e 输出仍包含测试夹具刻意模拟的 OpenAI runtime error 文案，以及既有 `MaxListenersExceededWarning`，但本轮复现的 CardKit 缺失 TypeError fallback 日志已由回归测试覆盖并消除。

### Milestone 3：全量验证、review gate 与提交

Objective:
- 跑通仓库统一验证与 review gate，完成语义复核并提交。

Allowed scope:
- `PLANS/ACTIVE.md`
- 本轮已修改文件

Validation:
- `./scripts/validate.sh`
- `./scripts/review.sh`
- 语义 review 对照 `RUNBOOKS/Review.md`

Status:
- done

Validation status:
- passed：`./scripts/validate.sh` 通过；全量 Vitest 509 passed / 1 skipped，typecheck 通过，backend / web / agent-runner build 通过。

Review status:
- passed：`./scripts/review.sh` 通过，format check 通过；语义 review 对照 `RUNBOOKS/Review.md` 未发现 scope violation、缺失验证、残留 debug、文档同步缺口或明显回归风险。

Risks / Notes / Handoff:
- 全量验证仍输出既有 `MaxListenersExceededWarning` 和测试夹具内的模拟 OpenAI runtime error 日志；这些不是本轮 CardKit fallback TypeError 根因，且没有导致验证失败。后续若要收敛测试噪音，可另开任务处理 listener 清理。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 验证失败和 review 失败都留在当前 milestone 修复，不能跳过。
- 只有 `Validation status: passed` 且 `Review status: passed` 后，milestone 才能标记为 `done`。

## Handoff

Current milestone:
- complete

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/streaming-card.ts`
- `tests/unit/messaging/feishu/streaming-card.test.ts`

Last failure summary:
- 已修复：CardKit v1 不可用时先进入 legacy delivery，不再通过 TypeError 驱动 fallback。

Suspected cause:
- CardKit v1 client capability 未显式检测；测试里的空 client 触发异步创建路径后先抛 TypeError，再 fallback。

Next step:
- 提交本轮修复。
