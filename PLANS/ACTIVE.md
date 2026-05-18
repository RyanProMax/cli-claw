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
