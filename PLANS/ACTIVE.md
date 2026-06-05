# 当前任务：修复 `/kol` 无响应

## Goal

- 排查并修复飞书输入 `/kol` 没有任何反应的问题。
- 明确根因，补类似线上入口的 E2E，覆盖用户实际输入 `/kol` 的可见启动回执、workflow 启动分发和离线 backfill 恢复。
- 扫描相邻 slash workflow / skill workflow 场景，避免 `/hkipo`、`/workflow kol ...` 或 repository skill workflow 再次静默。
- 验证、review、提交、push；如影响运行服务，按 `docs/COMMAND.md` 安全重启并确认健康。

## Done when

- 已复现 `/kol` 当前失败或证明失败所在边界，并记录根因。
- `/kol` 在 Feishu in-process E2E 中走真实 slash command / skill command 分发路径，不再只测直接 `executeWorkflowCommand`。
- E2E 断言 `/kol` 至少产生可见启动回执，并验证真实 skill command 分发到 workflow command。
- 相邻 workflow slash 场景已扫描并覆盖关键入口。
- 相关测试、typecheck、review gate 通过。
- 受当前工具约束不主动派生 subagent；以 `RUNBOOKS/Review.md` 的 review gate 加人工 diff review 确认无 blocking/important 问题。
- 提交并 push；必要时安全重启服务并确认 `/api/health` healthy。

## Milestones

### Milestone 1：复现与根因定位

Objective:
- 从 Feishu slash command 真实入口复现 `/kol` 无响应。
- 沿 `Feishu provider -> onCommand -> handleCommand -> skill command -> workflow command -> sendMessage/progress card` 跟踪断点。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `src/index.ts`
- 只读检查 `src/messaging/providers/feishu/`
- 只读检查 `src/messaging/slash-command.ts`
- 只读检查 `src/agent/skills/`、`.agents/skills/`
- 只读检查 `src/agent/workflow/`
- 只读检查 `tests/integration/messaging/feishu/`
- 只读检查 `docs/COMMAND.md`、`docs/RUNTIME.md`

Validation:
- 有可复现失败命令或可证明的代码路径断点。

Status:
- done

Validation status:
- passed: `npx vitest run tests/integration/messaging/feishu/connection.test.ts -t "refreshes the Feishu REST client"` 先红后绿

Review status:
- passed: 根因定位只读复核，无 scope 扩张

Risks / Notes / Handoff:
- 根因：飞书长连接反复离线后，REST `lark.Client` 的 token 状态出现 `tenant_access_token` 空值；offline/startup backfill 捕获错误后只记录 warning，不刷新 REST client，也不重试，导致离线期间输入的 `/kol` 进不了 command handler。
- 用户看到的“无反应”发生在接入层：live WS 未收到消息，backfill 又没有兜回来；不是 `/kol` parser 或 skill executor 本身不能工作。
- 现有测试问题：此前飞书 `/kol` 测试把 `onCommand` 直接 mock 成成功文本，只证明 provider 会调用回调，没有覆盖真实 `handleCommand -> skill dispatch -> workflow command` 拼接层，也没有覆盖 REST token 空值后的 backfill 恢复。

### Milestone 2：TDD 修复 `/kol` 真实入口

Objective:
- 先写失败 E2E，覆盖 `/kol` 从 Feishu inbound event 进入真实 command 分发后有可见响应。
- 修复根因，保持 slash command、skill command、workflow run/context 和 progress card 边界清晰。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/index.ts`
- `src/messaging/`
- `src/agent/skills/`
- `src/agent/workflow/`
- `.agents/skills/`
- `tests/integration/messaging/feishu/`
- 必要时同步 owner docs

Validation:
- 新增测试先红后绿。
- `/kol`、`/workflow kol ...`、至少一个相邻 workflow skill command 测试通过。

Status:
- done

Validation status:
- passed: 新增 backfill token 恢复测试先红后绿；新增 `/kol` Feishu E2E 仿真已通过；相邻 workflow slash / skill command 测试已通过

Review status:
- passed: diff 复核未发现 blocking 问题

Risks / Notes / Handoff:
- 如果 `/kol` skill executor 依赖外部 stock-kol-intel 资源，E2E 要 mock/fixture 到 executor 边界，不能要求真实网络或真实 Feishu。
- 新增 `handleImCommandForTests` 只作为测试导出口；E2E 中真实执行 `.agents/skills/stock-kol-intel/commands/dispatch.py`，workflow executor 用轻量 mock 避免真实网络和外部 agent。
- 相邻入口已覆盖：`/workflow kol ...` 走 workflow slash 测试，repository skill workflow 走 `/kol` E2E，已有 `/hkipo` contract 覆盖 skill dispatch 形态。

### Milestone 3：验证、review、提交与服务应用

Objective:
- 跑相关测试、typecheck、review gate。
- 按 `RUNBOOKS/Review.md` 做 review gate；当前 subagent 工具要求用户明确授权才可派生，因此本轮不主动派生。
- 提交、push；若影响服务，安全重启并确认健康。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`（仅跨轮次事项）
- 本轮已修改文件

Validation:
- 与 `/kol` 入口相关的 Feishu E2E
- 相邻 workflow slash / skill command 测试
- `npm run typecheck:backend`
- `git diff --check`
- `./scripts/review.sh`
- 人工 diff review gate
- push 后 `git status -sb` 对齐
- 如重启，`/api/health` healthy

Status:
- done

Validation status:
- passed:
  - `npx vitest run tests/integration/messaging/feishu/connection.test.ts -t "refreshes the Feishu REST client"`
  - `npx vitest run tests/integration/messaging/feishu/kol-command-e2e.test.ts`
  - `npx vitest run tests/integration/messaging/feishu/connection.test.ts`
  - `npx vitest run tests/integration/web/slash-command.test.ts tests/unit/skills/command-dispatch.test.ts tests/contracts/skills/stock-kol-command.test.ts`
  - `npx vitest run tests/unit/agent/workflow/command.test.ts`
  - `npx vitest run tests/integration/messaging/feishu/e2e.test.ts`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/validate.sh`
  - `bun src/cli.ts restart`
  - `curl -fsS http://127.0.0.1:3000/api/health`

Review status:
- passed: `./scripts/review.sh` 通过；按 `RUNBOOKS/Review.md` 人工复核 scope/objective/pattern/test/hygiene，未发现 blocking/important 问题

Risks / Notes / Handoff:
- 若发现旧测试只覆盖直接函数调用，需要把原因写入 handoff，避免继续给人“测了但没测入口”的错觉。
- `./scripts/validate.sh` 已通过；输出中仍有既有 `MaxListenersExceededWarning` 与 Vite chunk size warning，非本轮新增失败。
- 语义 review 中发现新增 E2E 未显式 `connection.stop()`，已改为 `try/finally` 并重新跑新增 E2E、完整 validate 和 review。
- 安全重启 intent `restart-2026-06-05T08-36-01-769Z-947442f0` 状态 `passed`；当前 backend PID `17911`；`/api/health` 返回 `healthy`。

## Handoff

Current milestone:
- Milestone 3 done

Current status:
- 根因已定位并修复：Feishu REST token 状态坏掉时刷新 REST client 并重试当前 backfill chat 一次；已补 `/kol` 真实 slash 链路仿真；完整 validate、review gate 和安全重启均已通过，等待最终提交和 push。

Changed files:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/index.ts`
- `src/index.ts`
- `tests/integration/agent/restart-recovery.test.ts`
- `tests/integration/messaging/feishu/connection.test.ts`
- `tests/integration/messaging/feishu/kol-command-e2e.test.ts`

Findings:
- 日志证据：当前服务存在 Feishu WS `ECONNREFUSED` / `timeout of 15000ms exceeded`，offline-health-check backfill 报 `Cannot destructure property 'tenant_access_token' from null or undefined value`。
- 红测证据：新增 backfill token 空值测试修复前只调用一次 `message.list`，不会处理 `/kol --days=7`；修复后刷新 REST client 并重试成功。
- E2E 证据：`/kol --days=7` 通过真实 Feishu event、真实 `handleCommand`、真实 skill discovery 和真实 `dispatch.py`，最终调用 workflow command 并发出启动回执。
- 验证中暴露一个既有静态 fallback footer 断言漂移；测试断言已修正为当前产品行为 `Feishu（主线） | HH:MM`。

Next step:
- 提交并 push。
