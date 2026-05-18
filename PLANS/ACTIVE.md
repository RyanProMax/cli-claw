# 当前任务：`/hkipo` Workflow 数据采集增强重构

> **给 agentic workers：** 必须使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`，并保留 validation / review gate。计划统一写在 `PLANS/`；不要在 `docs/superpowers` 下新增计划。

## 目标

- 保留用户入口 `/hkipo [--all]`，但内部改为触发 `hkipo` workflow，而不是生成单 agent 长 prompt。
- 将 `/hkipo` 编排为“确定性数据节点 + 专门采集/核验角色”的 8 节点工作流。
- Futu/OpenD 只负责 IPO 池和基础字段；Futu 可用但热度字段缺失时，必须进入二级热度采集节点补齐孖展、公开认购、一手中签率、暗盘、来源时间和冲突来源。
- 新增 workflow `local_task` 节点，只允许注册过的只读 taskId，不接受任意 shell。
- 新增 `stock-analysis-api` 只读 CLI `scripts/hkipo_heat_scan.py`，为 workflow 提供结构化 heat evidence。
- workflow state 支持结构化 artifacts，让角色读取 JSON artifact，而不是解析上一轮长文本。

## 完成标准

- `.agents/workflows/hkipo.json` 定义 8 节点工作流：`ipo_pool_discovery`、`pool_normalizer`、`heat_data_crawler`、`heat_data_verifier`、`official_doc_crawler`、`structure_fundamental_analyst`、`backtest_calibrator`、`ranking_report_editor`。
- `.agents/agent-roles/*.md` 中有职责清晰的 HK IPO runtime role cards，且 tool allowlist 仍由 runner 硬过滤。
- `/hkipo` 和 `/hkipo --all` 进入 `hkipo` workflow；`--all` 传入 workflow state，默认只看仍可认购 IPO。
- `local_task` 仅允许 `stock.hkipo.fetch_pool`、`stock.hkipo.scan_heat`、`stock.hkipo.fetch_official_docs`、`stock.hkipo.run_backtest` 等注册任务。
- Futu/OpenD 不可用时，pool discovery 明确失败；Futu pool 正常但热度缺失时，必须调用 `heat_data_crawler`。
- heat evidence 每条记录包含 `source`、`source_family`、`field`、`value`、`unit`、`published_at/update_at`、`url`、`confidence`、`staleness_status`；缺少关键来源信息时失败或降级。
- 无同日热度时，最终报告必须出现“热度未达当日核验门槛”，且降低 Subscription Heat / Evidence Quality。
- owner docs 同步 `/hkipo` workflow、local task、结构化 artifact 和 stock-analysis-api 边界。
- 本轮 validation 和 review gate 均通过；如有跨轮次事项，回写 `PLANS/ROADMAP.md`。

## Milestones

### Milestone 9：Workflow 触发即时回执与异常终态通知

Objective:
- 修复 Web / IM 触发 workflow 后长时间无可见反馈的问题：工作流创建并开始派发时立即回复“已启动”，成功、失败或 runner 超时后再向同一触发会话发送终态消息。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/agent/workflow/command.ts`
- `src/index.ts`
- `src/web/app.ts`
- `src/web/context.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/integration/web/slash-command.test.ts`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`

Validation:
- TDD 红测：background workflow 立即返回启动回执，完成后异步发送成功终态。
- TDD 红测：background workflow 内部抛错或超时错误时异步发送失败终态。
- `npm test -- tests/unit/agent/workflow/command.test.ts tests/integration/web/slash-command.test.ts`
- `npm run typecheck`
- `npm run build`
- `./scripts/review.sh`
- 安全重启并做真实 `/hkipo [e2e]`：确认飞书先收到启动回执，最终 run 成功/失败都有终态消息。
- 回归修复：Web slash command 集成测试必须隔离临时 HOME，不污染真实 DB；服务启动遇到历史陈旧 workspace `custom_cwd` 时不能拖垮整个 backend。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 现状：`executeWorkflowCommand` 会同步等待整个 LangGraph run；Feishu / Web 只能在 workflow 完成后看到一条回复。上轮 `/hkipo` 线上 E2E 约 356s，用户无法确认是否派发成功。
- 目标实现应保持用户会话与 workflow context 解耦，只新增触发会话的可见 lifecycle 消息，不把 workflow state 写入主 runtime session。
- 重启排查发现 `tests/integration/web/slash-command.test.ts` 的顶层 import 提前加载真实 HOME，导致测试注册的 `web:hkipo*` 临时 workspace 写入真实 DB；临时目录删除后，backend 启动校验历史 `custom_cwd` 时失败。需同时修测试隔离和启动健壮性。
- 已实现 background workflow lifecycle：run 创建后立即返回 `🚀 已启动工作流 ...`，后台成功时回填 `✅ 完成`，抛错或 runner timeout 时回填 `❌ 失败`，IM 入口通过 `sendMessage` 回到原触发会话，Web 入口写入同一会话消息流。
- 已修复测试隔离：Web slash command 集成测试改为在临时 HOME 后动态 import，避免把临时 workspace 写入真实 `~/.cli-claw/db/messages.db`。
- 已修复启动健壮性：历史 workspace `custom_cwd` 指向已删除目录时记录 warning 并跳过，不再阻断 backend 启动；缺省 workspace 物化启动 cwd 仍保持硬校验。
- 已运行并通过：
  - `npm test -- tests/unit/agent/workflow/command.test.ts tests/integration/web/slash-command.test.ts`（9 passed）
  - `npm run typecheck`
  - `npm run build`（通过；保留既有 Vite chunk warning）
  - `./scripts/review.sh`
  - `./scripts/validate.sh tests/unit/agent/workflow/command.test.ts tests/integration/web/slash-command.test.ts`
  - 安全重启：`bun src/cli.ts restart`，`/api/health` healthy；启动日志中陈旧 `web:hkipo*` workspace 降级为 warning。
  - 飞书 live smoke：`FEISHU_LIVE_E2E=1 ... npm test -- tests/live/feishu/message-smoke.test.ts`（1 passed，真实发送并读回 `[e2e] ...`）。
  - 线上 `/hkipo [e2e]` workflow：run `wfrun_c9038740-5b03-461b-9a52-4a7c04c42f19`，消息顺序为 `/hkipo [e2e]` → `🚀 已启动工作流 ...` → `✅ 工作流 ... 完成`，8 个节点均 `success`，总耗时约 349 秒。

### Milestone 8：`/hkipo` 飞书报告可读性与中文名修复

Objective:
- 修复 `/hkipo` 最终报告在飞书普通文本气泡中 Markdown 标记外露、重点不突出、公司名称只显示英文简称的问题，并重新确认默认 IPO 池范围。

Allowed scope:
- `PLANS/ACTIVE.md`
- `.agents/agent-roles/hkipo-*.md`
- `.agents/workflows/hkipo.json`
- `tests/unit/agent/workflow/**`
- `tests/contracts/openai/**`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `/Users/ryan/projects/stock-analysis-api/src/services/futu_market_data_cli.py`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_heat_scan_service.py`
- `/Users/ryan/projects/stock-analysis-api/tests/**`
- `/Users/ryan/projects/stock-analysis-api/docs/plan.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/hkipo-heat-scan-cli.md`

Validation:
- 用上一轮真实 workflow artifact 复盘英文名来源与报告格式问题。
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "futu_market_data_cli or hkipo_heat_scan or hkipo"`
- `npm test -- tests/unit/agent/workflow/config.test.ts tests/contracts/openai/runner-request.test.ts`
- `npm run typecheck`
- `./scripts/review.sh`
- 真实 `/hkipo [e2e]` full-chain E2E：确认 `workflow_runs.status='success'`、最终飞书回复使用中文公司名、纯文本格式、emoji 重点、并包含池子校验说明。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 根因 1：Futu/OpenD `ipo-list` 当前默认返回的 `name` 为英文简称，`name_zh/cn_name/stock_name` 均为空；上一轮默认池 4 只为 `HK.02723 DEEPZERO`、`HK.06872 TENNOR THERAP-B`、`HK.00901 SDMC`、`HK.03310 VIEWTRIX TECH`，票池来自 Futu，范围正确。
- 根因 2：workflow 完成回复进入飞书普通文本气泡，Markdown `**` 不会渲染成粗体；最终报告 role 仍按 Markdown 短报输出，导致截图里格式拥挤且重点不突出。
- 已在 `stock-analysis-api` 数据层补充 HK IPO 中文展示名：02723 深演智能、06872 丹诺医药-B、03310 云英谷科技、00901 华曦达；`--all` 还会含已截止未上市的 01511 驭势科技、07688 拓璞数控。Futu 原始英文 `name` 仍保留为 `name_en` / `english_name`，不靠最终 LLM 临场翻译。
- 已改 `hkipo` workflow role card 和 prompt：最终报告面向飞书普通文本气泡，不使用 Markdown 粗体/表格，中文名优先，用 emoji 突出排名、热度、入场费、风险和池子校验。
- 已运行并通过：
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "futu_market_data_cli or hkipo_heat_scan or hkipo"`（19 passed）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run python scripts/futu_market_data.py ipo-list --market HK --json`，真实 Futu/OpenD pool 返回 6 只；默认可申购 4 只：02723、06872、00901、03310。
  - `npm test -- tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/config.test.ts tests/contracts/openai/runner-request.test.ts`（19 passed）
  - `npm run typecheck`
  - `npm run build`（通过；保留既有 Vite chunk warning）
  - `./scripts/review.sh`
  - `./scripts/validate.sh tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/config.test.ts tests/contracts/openai/runner-request.test.ts`
  - 安全重启：`bun src/cli.ts restart`，`/api/health` healthy。
  - 真实飞书 full-chain E2E：发送 `/hkipo [e2e]`，run `wfrun_183a282b-557a-4869-94fa-1cdd3a81c2c5`，耗时约 356s，`workflow_runs.status=success`，8 个节点全 `success`，最终飞书消息包含 emoji、4 个中文公司名、“池子校验”和“热度未达当日核验门槛”，且不含裸露 `**`。
- Review gate：scope 覆盖 cli-claw 与 stock-analysis-api 两侧；新增数据层名称补齐不改变 Futu/OpenD 原始池选择；最终报告格式由 role card 和 workflow prompt 双重约束；长期风险是当前中文名 alias map 需要后续自动化来源维护，已回写 `PLANS/ROADMAP.md`。

### Milestone 7：`/hkipo` 线上全链路 E2E 超时修复

Objective:
- 修复真实飞书 `/hkipo` workflow 线上链路在 role node 超时 30 分钟的问题，并把完整线上链路 E2E 作为本轮完成门槛。

Allowed scope:
- `PLANS/ACTIVE.md`
- `.agents/workflows/hkipo.json`
- `.agents/agent-roles/hkipo-*.md`
- `src/agent/workflow/**`
- `src/agent/runner/**`
- `container/agent-runner/src/**`
- `container/agent-runner/dist/**`
- `tests/unit/agent/workflow/**`
- `tests/unit/agent/runner/**`
- `tests/contracts/openai/**`
- `tests/integration/**`
- `tests/live/feishu/**`
- `docs/RUNTIME.md`
- `docs/E2E.md`
- `package.json`
- `package-lock.json`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_heat_scan_service.py`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_heat_scan_cli.py`
- `/Users/ryan/projects/stock-analysis-api/scripts/hkipo_heat_scan.py`
- `/Users/ryan/projects/stock-analysis-api/tests/**`
- `/Users/ryan/projects/stock-analysis-api/docs/plan.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/hkipo-heat-scan-cli.md`

Validation:
- 查询真实失败 run/step/log，确认失败节点和错误链路。
- `npm test -- tests/unit/agent/runner/output-parser.test.ts tests/unit/agent/workflow/engine.test.ts tests/contracts/openai/agent-runtime.test.ts tests/contracts/openai/runner-request.test.ts`
- `npm test -- tests/integration`
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo"`
- `npm run typecheck`
- `npm run build`
- `./scripts/review.sh`
- 真实飞书 full-chain E2E：向当前飞书私聊发送 `[e2e] /hkipo`，等待 workflow 完成，并用 DB / 飞书读回确认 `workflow_runs.status='success'`、8 个节点均成功、最终回复不是 timeout。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 已定位真实失败 run：`wfrun_7d6226ca-a535-4253-8d0a-615cc1254d75`。
- 失败链路：`ipo_pool_discovery` 成功；`pool_normalizer` role node 首次运行 37 秒后 OpenAI 404（`Items are not persisted when store=false`），期间错误调用 `send_message` 把中间 JSON 直接发到飞书；LangGraph retry 后 role runner 完成首轮但继续等待 IPC 下一轮，最终 `Agent Process timed out after 1800000ms`。
- 初步根因：workflow role node 需要 single-turn runner 语义；legacy output parser 不能取第一个 stream marker；HK IPO runtime role 不应允许用户可见 `send_message` 工具。
- 二次真实线上触发 run：`wfrun_91598ff6-d4c1-4fd4-8f73-ff448e63ca08`，已通过 `pool_normalizer`，但 `heat_data_crawler` 执行 `hkipo_heat_scan.py` 超出 local task 时间预算失败。
- 二次根因：`stock-analysis-api` heat scan 对每只 IPO 顺序访问约 10 个公开来源，每个来源 `urlopen(timeout=12)`；真实 IPO 池 4 只时最坏约 480 秒，超过 Cli Claw local task 120 秒预算。需要把来源扫描改为有界并发，并让 workflow 在公开网页采集失败时输出降级 artifact，而不是直接中断整个工作流。
- 已修复：
  - workflow role node 下发 `singleTurn=true`，OpenAI runner 首轮完成后直接退出，不再等待 IPC 下一轮。
  - legacy output parser 改为读取最后一个有意义的 success/error marker，避免误取首个 stream marker。
  - HK IPO runtime role cards 移除 `send_message` allowlist，防止中间 artifact 直接泄漏到触发会话。
  - `stock-analysis-api` heat scan 改为单 IPO 内多来源有界并发，默认每来源 6 秒超时；单个来源失败只写 source error。
  - `stock.hkipo.scan_heat` 在 scanner 进程级失败或超时时返回 `status=degraded` 的 heat artifact，后续 verifier/report 继续写“热度未达当日核验门槛”。
- 已运行并通过：
  - `uv run pytest tests -k "hkipo_heat_scan or hkipo"`（stock-analysis-api，6 passed）
  - `npm test -- tests/unit/agent/runner/output-parser.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/engine.test.ts tests/contracts/openai/runner-request.test.ts`（18 tests）
  - `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/command.test.ts tests/contracts/openai/agent-runtime.test.ts tests/contracts/openai/runner-request.test.ts tests/unit/agent/runner/output-parser.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/engine.test.ts`（37 tests）
  - `npm test -- tests/integration`（13 files, 136 tests）
  - `npm run typecheck`
  - `npm run build`（通过；保留既有 Vite chunk warning）
  - `./scripts/review.sh`（format check passed；已按 `RUNBOOKS/Review.md` 完成语义 review）
  - 真实 heat scan：Futu IPO 池 4 只，`hkipo_heat_scan.py` 约 50.47s 返回 `status=ok`，无同日热度时全部降级。
  - 线上 full-chain E2E：通过正在运行的服务向 Feishu 会话触发 `/hkipo [e2e]`，run `wfrun_2559b902-d2eb-4a3c-b0f5-f32bb063be23`，耗时约 390.64s，`workflow_runs.status=success`，8 个节点均 `success`，最终回复已落库并包含“热度未达当日核验门槛”，未出现 timeout。
- Review gate：scope 已覆盖 cli-claw 和 stock-analysis-api 两侧修改；Futu/OpenD pool discovery 仍保持硬失败，只有补充热度 scanner 做降级；文档已同步 `docs/ARCHITECTURE.md`、`docs/RUNTIME.md`、stock-analysis-api `docs/plan.md` / spec。
- 后续风险：本次 E2E 中 `backtest_calibrator` 成功但耗时约 119 秒，且 artifact 约 100KB；已回写 `PLANS/ROADMAP.md` 为后续 summary-only / artifact budget 治理项。

### Milestone 6：Bun runtime checkpoint 兼容修复

Objective:
- 修复 `/hkipo` 在 Bun 服务运行时触发 LangGraph SQLite checkpoint 报 `'better-sqlite3' is not yet supported in Bun` 的回归。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/agent/workflow/**`
- `src/storage/sqlite-compat.ts`
- `tests/unit/agent/workflow/**`
- `docs/RUNTIME.md`
- `docs/MODULE.md`
- `package.json`
- `package-lock.json`

Validation:
- `bun -e "import('./src/agent/workflow/engine.ts').then(m => { m.getPersistentWorkflowCheckpointer(); console.log('ok') })"`
- `npm test -- tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/checkpointer-runtime.test.ts`
- `npm run build`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 用户真实触发 `/hkipo` 时暴露：LangGraph 官方 SQLite saver 静态依赖 `better-sqlite3`，而当前服务由 Bun 启动；此前验证覆盖了 Node/Vitest/build，没有覆盖 Bun runtime checkpoint 初始化。
- 已修复：workflow checkpoint 改用仓库内 `WorkflowSqliteSaver`，底层走 `sqlite-compat`，Bun 路径使用 `bun:sqlite`，不再导入 `@langchain/langgraph-checkpoint-sqlite` / `better-sqlite3`。
- 已移除 `@langchain/langgraph-checkpoint-sqlite` 依赖，并补充 Bun runtime 回归测试，避免 Node/Vitest 通过但 Bun 服务失败。
- 已运行并通过：
  - `bun -e 'const { getPersistentWorkflowCheckpointer } = await import("./src/agent/workflow/engine.ts"); getPersistentWorkflowCheckpointer(); console.log("ok")'`
  - `env HOME="$(mktemp -d)" bun -e '<minimal checkpointed workflow graph>'`，输出 `{"echo":{"status":"ok"}}`
  - `npm test -- tests/unit/agent/workflow/checkpointer-runtime.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/command.test.ts`（3 files, 7 tests）
  - `npm run typecheck`
  - `npm run build`（通过；保留既有 Vite chunk size warning）
  - `./scripts/review.sh`（diff hygiene / format check passed）
- 语义 review gate：scope 已补充 `docs/MODULE.md`；目标覆盖原始 Bun checkpoint 报错；实现复用现有 `sqlite-compat` 和 LangGraph checkpoint contract；新增测试直接用 Bun 执行 checkpoint graph；文档同步 runtime 边界；未发现阻塞回归。

### Milestone 1：计划与现状审计

Objective:
- 锁定 `/hkipo` 现有入口、workflow engine、skill command、stock-analysis-api 脚本和测试结构，更新 active plan。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读：`src/agent/workflow/**`、`src/skills/**`、`shared/**`、`tests/**`
- 只读：`/Users/ryan/projects/stock-analysis-skill/**`
- 只读：`/Users/ryan/projects/stock-analysis-api/**`

Validation:
- `git status --short --branch`
- 只读审计记录写入本计划

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 已完成只读审计：
  - `src/agent/workflow/config.ts` 当前只支持 `role_task | router | parallel | join | final`，需要新增 `local_task`、`taskId` 与可选 `outputArtifact`。
  - `src/agent/workflow/engine.ts` 当前 state 只有 `prompt/result/stepResults`，需要新增 `input/artifacts`；`router/parallel/join/final` 仍是 no-op，本轮 HK IPO 先按顺序 8 节点落地。
  - `/hkipo` 当前由 `stock-analysis-skill/commands/hkipo.py` 返回 `assistant_prompt` 长 prompt；本轮要改成 skill executor 返回 `workflow` 类型，由 Web/IM 桥接到 `executeWorkflowCommand`。
  - `stock-analysis-api` 适合新增 `scripts/hkipo_heat_scan.py` 薄 wrapper、`src/services/hkipo_heat_scan_cli.py` 和 service，测试通过 fake service / fixture，CI 不访问真实网页。
  - 当前仓库没有 `.agents/workflows/hkipo.json` 与 `.agents/agent-roles/*`，Milestone 4 新增。
- 已运行只读校验：`git status --short --branch`。

### Milestone 2：TDD 覆盖与最小运行契约

Objective:
- 先写失败测试，再实施最小代码让 `/hkipo` workflow trigger、`local_task` allowlist、workflow artifact、heat evidence schema 和无同日热度降级契约变绿。

Allowed scope:
- `src/agent/workflow/**`
- `src/skills/**`
- `src/web/**`
- `src/index.ts`
- `tests/unit/agent/workflow/**`
- `tests/unit/skills/**`
- `tests/unit/messaging/**`
- `tests/integration/web/**`
- `/Users/ryan/projects/stock-analysis-skill/commands/hkipo.py`
- `/Users/ryan/projects/stock-analysis-skill/tests/**`
- `/Users/ryan/projects/stock-analysis-api/scripts/hkipo_heat_scan.py`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_heat_scan_*.py`
- `/Users/ryan/projects/stock-analysis-api/tests/**`

Validation:
- `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/skills/command-dispatch.test.ts tests/integration/web/slash-command.test.ts`
- `cd /Users/ryan/projects/stock-analysis-skill && python3 -m unittest tests/test_hkipo_command.py`
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo"`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 已遵循 TDD：新增测试已确认失败，失败点分别是缺少 workflow reply、`local_task` schema、artifact state、`initialInput` 传递和 API heat scan 模块。
- 已运行并通过：
  - `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/skills/command-dispatch.test.ts tests/integration/web/slash-command.test.ts`（26 tests）
  - `cd /Users/ryan/projects/stock-analysis-skill && python3 -m unittest tests/test_hkipo_command.py`（15 tests）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests/test_hkipo_heat_scan_cli.py`（2 tests）
- Review gate：scope 已修正为红测 + 最小实现；新增 `local_task` 只通过 registry 执行，不接受 workflow JSON command/path。

### Milestone 3：stock-analysis-api heat scan 只读 CLI

Objective:
- 新增 `scripts/hkipo_heat_scan.py` 和 fixture tests，输出多源 heat evidence schema；不依赖真实网页作为 CI 必过条件。

Allowed scope:
- `/Users/ryan/projects/stock-analysis-api/scripts/hkipo_heat_scan.py`
- `/Users/ryan/projects/stock-analysis-api/src/**`
- `/Users/ryan/projects/stock-analysis-api/tests/**`
- `/Users/ryan/projects/stock-analysis-api/requirements*.txt`
- `/Users/ryan/projects/stock-analysis-api/pyproject.toml`
- `/Users/ryan/projects/stock-analysis-api/docs/**`

Validation:
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo"`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 网页抓取只做公开只读采集，不登录券商账户，不绕过付费、验证码或反爬限制。
- 真实网页结构变化时 local task 返回 source-level error，由 verifier 降级，不编造数据。
- 已新增 `scripts/hkipo_heat_scan.py`、`src/services/hkipo_heat_scan_cli.py`、`src/services/hkipo_heat_scan_service.py`、`tests/test_hkipo_heat_scan_cli.py` 和 `docs/specs/hkipo-heat-scan-cli.md`，并同步 `docs/plan.md`。
- 已运行并通过：`uv run pytest tests -k "hkipo_heat_scan or hkipo"`（2 passed, 231 deselected）。
- Review gate：新增 CLI 为内部只读脚本，不新增公共 HTTP API；CI 使用 fake service，不依赖真实网页。

### Milestone 4：Cli Claw workflow engine、local task 与 `/hkipo` 重编排

Objective:
- 实现 `local_task` 节点、结构化 artifacts、HK IPO local task registry、`hkipo` workflow 配置、runtime role cards，并让 `/hkipo` 入口触发 workflow。

Allowed scope:
- `.agents/workflows/**`
- `.agents/agent-roles/**`
- `src/agent/workflow/**`
- `src/skills/**`
- `shared/runtime-command-registry.ts`
- `src/messaging/**`
- `src/web/**`
- `/Users/ryan/projects/stock-analysis-skill/commands/hkipo.py`
- `/Users/ryan/projects/stock-analysis-skill/commands.json`
- `/Users/ryan/projects/stock-analysis-skill/SKILL.md`
- `/Users/ryan/projects/stock-analysis-skill/references/hkipo.md`
- `/Users/ryan/projects/stock-analysis-skill/tests/**`
- `tests/unit/agent/workflow/**`
- `tests/unit/skills/**`
- `tests/unit/messaging/**`
- `tests/integration/web/**`

Validation:
- `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/context.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/command.test.ts`
- `npm test -- tests/unit/messaging/slash-command.test.ts tests/integration/web/slash-command.test.ts`
- `cd /Users/ryan/projects/stock-analysis-skill && python -m unittest tests/test_hkipo_command.py`
- `npm run typecheck`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- `local_task` 不得成为任意命令执行后门；task registry 必须显式 allowlist。
- role card 的 `allowedTools` 仍必须在 runner tool factory 层硬过滤。
- 已新增 `.agents/workflows/hkipo.json` 和 4 张 runtime role cards：pool normalizer、heat verifier、structure/fundamental analyst、ranking report editor。
- 已实现内置 workflow fallback：工作区配置优先，工作区缺失时使用 Cli Claw 自带 `.agents/workflows` / `.agents/agent-roles`。
- 已运行并通过：
  - `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/context.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/command.test.ts`（18 tests）
  - `npm test -- tests/unit/messaging/slash-command.test.ts tests/integration/web/slash-command.test.ts`（7 tests）
  - `cd /Users/ryan/projects/stock-analysis-skill && python3 -m unittest tests/test_hkipo_command.py`（15 tests）
  - `npm run typecheck`
- Review gate：`local_task` 只接受 `taskId` registry，workflow JSON 不能声明 shell command；Web skill workflow 分支已补异常捕获。

### Milestone 5：文档、全量验证、review 与提交

Objective:
- 同步 owner docs、运行完整 validation/review gate，回写 handoff / roadmap，并提交。

Allowed scope:
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `docs/COMMAND.md`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- 本任务前序 milestones 已修改文件

Validation:
- `npm run build`
- `npm --prefix web run build`
- `./scripts/validate.sh`
- `./scripts/review.sh`
- `cd /Users/ryan/projects/stock-analysis-skill && python -m unittest tests/test_hkipo_command.py && python -m py_compile commands/*.py`
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo"`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 已运行并通过：
  - `npm run build`
  - `npm --prefix web run build`
  - `./scripts/validate.sh`（67 test files passed, 1 skipped；480 tests passed, 1 skipped；typecheck/build passed）
  - `./scripts/review.sh`（diff hygiene / format check passed）
  - 语义 review gate：scope、目标覆盖、local task allowlist、artifact contract、文档同步和数据新鲜度降级均通过。
  - `cd /Users/ryan/projects/stock-analysis-skill && python3 -m unittest tests/test_hkipo_command.py && python3 -m py_compile commands/*.py && git diff --check`
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo" && uv run black --check --line-length 100 --target-version py312 scripts/hkipo_heat_scan.py src/services/hkipo_heat_scan_cli.py src/services/hkipo_heat_scan_service.py tests/test_hkipo_heat_scan_cli.py && git diff --check`
- 验证警告均为既有噪声或构建提示：locale `LC_ALL` warning、测试内预期 Feishu fallback/error logs、MaxListeners warning、Vite chunk size warning。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮复杂任务执行的单一真相源。
- 一次只允许一个 milestone 处于 `in_progress`。
- 不隐式扩 scope；目标、方案、验证方式或涉及文件变化时，先更新 active plan。
- 每个 milestone 必须先写失败测试，再实现，再运行 validation，再走 review gate。
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 6

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `package.json`
- `package-lock.json`
- `src/agent/workflow/engine.ts`
- `src/agent/workflow/sqlite-checkpointer.ts`
- `docs/RUNTIME.md`
- `docs/MODULE.md`
- `tests/unit/agent/workflow/checkpointer-runtime.test.ts`

Last failure summary:
- `/hkipo` 在 Bun 服务路径触发 workflow checkpoint 时失败：官方 SQLite saver 静态加载 `better-sqlite3`，Bun 当前不支持该 native package。已改为仓库内 Bun/Node 兼容 SQLite saver，并补充 Bun runtime 回归。

Suspected cause:
- none

Next step:
- 提交本次 cli-claw 回归修复，并按安全重启路径应用服务变更。
