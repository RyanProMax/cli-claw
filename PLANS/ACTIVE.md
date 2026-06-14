# 当前任务：修复 KOL X/Twitter 访问预检

## Goal

- 查清 `/kol` 结果提示 “X/Twitter 原文未完成可访问校验” 的真实原因。
- 修复 `stock.kol.prepare_context` 与 sibling `stock-kol-intel` 的 preflight 调用/环境适配问题，让可用账号池和网络条件下能完成 X/Twitter 原文校验。
- 保持低信号边界：如果 X 仍因真实账号池、代理或站点限制不可用，报告必须短说明原因，不输出伪主题。

## Done when

- 已复现当前机器上的 `x_preflight` 失败原因，并记录根因。
- 修复有红线测试覆盖：失败场景可诊断，可用场景不被误判为不可访问。
- `/kol` E2E 或等价 local task smoke 能产出结构化 `x_preflight`，且最终飞书结果不再把可修复的环境/调用问题误写成笼统“原文未完成可访问校验”。
- targeted tests、typecheck/build、review gate 和必要 live smoke / restart 通过；结果与 handoff 回写本文件。

## Milestones

### Milestone 1：复现 X preflight 失败并定位根因

Objective:
- 在当前机器上运行真实 `stock.kol.prepare_context` / `stock-kol-intel build_x_source_preflight`，确认失败是账号池、代理、依赖、X bootstrap、队列锁，还是 Agent Fabric 调用/缓存导致。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/agent/workflow/local-tasks.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`
- `.agents/workflows/kol.json`
- `.agents/agent-roles/kol-intel-reporter.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- 只读检查 sibling `/Users/ryan/projects/stock-kol-intel`；若必须修改 sibling 仓库，先在本计划记录原因和验证。

Validation:
- 真实 preflight smoke：
  - `STOCK_KOL_INTEL_ROOT=/Users/ryan/projects/stock-kol-intel npx vitest run tests/unit/agent/workflow/local-tasks.test.ts -t prepare_context`
- 直接 Python preflight 诊断，输出必须隐藏 cookie/secret，只保留 status/reason/queue 摘要。

Status:
- done

Validation status:
- passed
- 2026-06-14 11:35 EDT：默认 `~/.cli-claw/state/stock-kol-intel/twscrape/accounts.db` 不存在，`stock-kol-intel` 直接默认会判定账号库未配置。
- 2026-06-14 11:35 EDT：实际账号库位于 `~/.agent-fabric/state/stock-kol-intel/twscrape/accounts.db`，含 1 个 active twscrape 账号，队列锁为空。
- 2026-06-14 11:36 EDT：显式设置 `TWSCRAPE_DB_PATH=/Users/ryan/.agent-fabric/state/stock-kol-intel/twscrape/accounts.db` 后直接运行 `build_x_source_preflight(30, whitelist)` 成功，7 个白名单账号 `ok_results_count=7`，代理 `http://127.0.0.1:7897` 可达。
- 2026-06-14 11:36 EDT：红线测试
  `npx vitest run tests/unit/agent/workflow/local-tasks.test.ts -t 'passes the Agent Fabric twscrape account database'`
  按预期失败，`x_preflight.db_path` 为 `null`。

Review status:
- passed

Risks / Notes / Handoff:
- 截图中的终态说明来自 `x_preflight` 不可用后的低信号路径；这说明上一轮伪报告边界已经生效，但数据源访问还没有恢复。
- 根因：Agent Fabric 调用 sibling `stock-kol-intel` 时没有为新版 Agent Fabric 状态目录自动注入 `TWSCRAPE_DB_PATH`；`stock-kol-intel` 自身默认仍指向旧 `~/.cli-claw` 路径。

### Milestone 2：测试先行修复调用/环境适配

Objective:
- 基于 Milestone 1 根因写失败用例，修复 Agent Fabric 调用层或必要的 sibling preflight 适配。

Allowed scope:
- Milestone 1 允许范围内的实现、测试与必要文档。
- 若根因在 sibling `stock-kol-intel`，允许在 `/Users/ryan/projects/stock-kol-intel` 做最小修复，并单独记录该仓库验证。

Validation:
- 先补红线测试并确认失败。
- `npx vitest run tests/unit/agent/workflow/local-tasks.test.ts`
- 直接 Python preflight smoke。

Status:
- done

Validation status:
- passed
- 2026-06-14 11:38 EDT：红线测试转绿：
  `npx vitest run tests/unit/agent/workflow/local-tasks.test.ts -t 'passes the Agent Fabric twscrape account database'`。
- 2026-06-14 11:38 EDT：完整 local task 单测通过：
  `npx vitest run tests/unit/agent/workflow/local-tasks.test.ts`，8 个用例通过。
- 2026-06-14 11:40 EDT：真实 Agent Fabric local task smoke 通过；未显式设置 `TWSCRAPE_DB_PATH` 时，`stock.kol.prepare_context` 自动解析 `/Users/ryan/.agent-fabric/state/stock-kol-intel/twscrape/accounts.db`，`x_status=ok`，7/7 白名单账号预检成功。

Review status:
- passed

Risks / Notes / Handoff:
- 不把镜像、缓存或搜索结果提升成主证据；X 原文仍必须来自可核验 `x.com/.../status/...`。
- 修复点：Agent Fabric 调用 sibling helper 前自动发现并注入 twscrape DB 路径；KOL context cache key 纳入最终 DB 路径。

### Milestone 3：E2E、review、重启与提交

Objective:
- 跑 `/kol` 相关 E2E/live smoke，确认飞书终态展示和卡片结果可接受，完成 review gate、必要重启和提交。

Allowed scope:
- 本轮修改文件
- `PLANS/ACTIVE.md`
- Git commit

Validation:
- `git diff --check`
- targeted tests
- `npm run typecheck:backend`
- `npm run build:backend`
- `./scripts/review.sh`
- `FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=<可发现私聊> npm test -- tests/live/feishu/message-smoke.test.ts`
- 必要时 `bun src/cli.ts restart` 和 `/api/health`

Status:
- done

Validation status:
- passed
- 2026-06-14 11:41 EDT：KOL/workflow/飞书 targeted suite 通过：
  `npx vitest run tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/engine.test.ts tests/integration/messaging/feishu/e2e.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`，6 个测试文件 / 56 个用例。
- 2026-06-14 11:42 EDT：`git diff --check` 通过。
- 2026-06-14 11:42 EDT：`npm run typecheck:backend` 通过。
- 2026-06-14 11:43 EDT：`npm run build:backend` 通过。
- 2026-06-14 11:43 EDT：`./scripts/review.sh` 通过。
- 2026-06-14 11:43 EDT：真实飞书 API smoke 通过：
  `FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=oc_98f0bb60f284627bf20f9386704f8c82 npm test -- tests/live/feishu/message-smoke.test.ts`。
- 2026-06-14 11:43 EDT：`bun src/cli.ts restart` 已创建安全重启 intent。
- 2026-06-14 11:43 EDT：`curl -fsS http://127.0.0.1:3000/api/health` 返回 healthy。
- 2026-06-14 11:46 EDT：重启后真实 KOL preflight smoke 通过；未显式设置 `TWSCRAPE_DB_PATH` 时，`x_status=ok`，`x_db_path=/Users/ryan/.agent-fabric/state/stock-kol-intel/twscrape/accounts.db`，7/7 白名单账号成功。

Review status:
- passed
- 语义 review：改动范围只覆盖 KOL local task、测试、运行时文档和 active plan；显式 `TWSCRAPE_DB_PATH` 仍优先；自动发现只在未配置时介入；cache key 纳入最终账号库路径；没有改变低信号证据边界。

Risks / Notes / Handoff:
- 如果 GitHub push 仍受本机凭据阻塞，提交可以完成，但 push 需要用户重新认证后继续。

## Handoff

Current milestone:
- Milestone 3

Current status:
- complete; validation, review, live smoke, safe restart and post-restart KOL preflight smoke passed

Changed files:
- `PLANS/ACTIVE.md`
- `src/agent/workflow/local-tasks.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`
- `docs/RUNTIME.md`

Last failure summary:
- 已修复；红线测试原先显示 `x_preflight.db_path=null`，修复后自动注入新版 Agent Fabric twscrape DB 路径。

Suspected cause:
- 已确认：sibling `stock-kol-intel` 默认仍查旧 `~/.cli-claw/state/.../accounts.db`；真实账号池在 `~/.agent-fabric/state/.../accounts.db`。Agent Fabric 之前没有注入 `TWSCRAPE_DB_PATH`，导致 workflow 误判 X/Twitter 原文不可访问。

Next step:
- 提交本轮修复；push 仍取决于本机 GitHub 凭据是否恢复。
