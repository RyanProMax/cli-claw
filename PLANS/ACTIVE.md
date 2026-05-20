# 当前任务：`/hkipo` Workflow 数据采集增强重构

> **给 agentic workers：** 必须使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`，并保留 validation / review gate。计划统一写在 `PLANS/`；不要在 `docs/superpowers` 下新增计划。

## 目标

- 保留用户入口 `/hkipo [--all]`，但内部改为触发 `hkipo` workflow，而不是生成单 agent 长 prompt。
- 将 `/hkipo` 编排为“确定性数据节点 + 专门采集/核验角色”的 9 节点工作流。
- Futu/OpenD 只负责 IPO 池和基础字段；Futu 可用但热度字段缺失时，必须进入二级热度采集节点补齐孖展、公开认购、一手中签率、暗盘、来源时间和冲突来源。
- 新增 workflow `local_task` 节点，只允许注册过的只读 taskId，不接受任意 shell。
- 新增 `stock-analysis-api` 只读 CLI `scripts/hkipo_heat_scan.py`，为 workflow 提供结构化 heat evidence。
- workflow state 支持结构化 artifacts，让角色读取 JSON artifact，而不是解析上一轮长文本。

## 完成标准

- `.agents/workflows/hkipo.json` 定义 9 节点工作流：`ipo_pool_discovery`、`pool_normalizer`、`core_data_researcher`、`heat_data_crawler`、`heat_data_verifier`、`official_doc_crawler`、`structure_fundamental_analyst`、`backtest_calibrator`、`ranking_report_editor`。
- `.agents/agent-roles/*.md` 中有职责清晰的 HK IPO runtime role cards，且 tool allowlist 仍由 runner 硬过滤。
- `/hkipo` 和 `/hkipo --all` 进入 `hkipo` workflow；`--all` 传入 workflow state，默认只看仍可认购 IPO。
- `local_task` 仅允许 `stock.hkipo.fetch_pool`、`stock.hkipo.scan_heat`、`stock.hkipo.fetch_official_docs`、`stock.hkipo.run_backtest` 等注册任务。
- Futu/OpenD 不可用时，pool discovery 明确失败；Futu pool 正常但热度缺失时，必须调用 `heat_data_crawler`。
- heat evidence 每条记录包含 `source`、`source_family`、`field`、`value`、`unit`、`published_at/update_at`、`url`、`confidence`、`staleness_status`；缺少关键来源信息时失败或降级。
- 无同日热度时，最终报告必须出现“热度未达当日核验门槛”，且降低 Subscription Heat / Evidence Quality。
- owner docs 同步 `/hkipo` workflow、local task、结构化 artifact 和 stock-analysis-api 边界。
- 本轮 validation 和 review gate 均通过；如有跨轮次事项，回写 `PLANS/ROADMAP.md`。

## Milestones

### Milestone 15：HKIPO Agent Process Socket 异常恢复

Objective:
- 分析并修复 `/hkipo` workflow 在 role node 调用 agent runtime 时遇到 `undici UND_ERR_SOCKET` / `Agent process exited with code 1` 后直接失败的问题；要求工作流不要因为 OpenAI/网络 socket 瞬断丢失已采集数据，至少能在可降级节点给出可见失败说明或 deterministic fallback 报告。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `.agents/workflows/hkipo.json`
- `.agents/agent-roles/*.md`
- `src/agent/workflow/**`
- `src/agent/runner/**`
- `src/messaging/**`
- `tests/unit/agent/workflow/**`
- `tests/unit/messaging/**`
- owner docs if runtime/error contract changes

Validation:
- Root-cause：定位失败 workflow run、失败节点、agent stderr/exit 信息与最近改动关系。
- TDD 红测：模拟 role runner 抛出 `Agent process exited with code 1 ... UND_ERR_SOCKET` 时，hkipo 可降级节点不会让整条工作流直接终止，最终能返回含 run id / 降级原因 / 已采集数据摘要的可见结果。
- `npm test -- tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/command.test.ts`
- `npm run typecheck`
- 真实 `/hkipo` E2E 或等价 workflow live smoke，确认 Feishu/Web 收到启动回执、失败/降级或成功终态。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 根因已定位到 workflow run `wfrun_1102c43a-ecdd-41f0-893e-455e34339486` 的 `core_data_researcher` role node：agent runtime 进程因 OpenAI/undici transient socket 异常退出，错误包含 `UND_ERR_SOCKET`，上一版 `hkipo` workflow `maxRetries=0` 且 role node 直接 rethrow，导致整条 workflow 失败并把底层 socket 堆栈暴露给用户。
- 已处理：`hkipo` role node 对 `UND_ERR_SOCKET`、`ECONNRESET`、`ETIMEDOUT` 等 transient runtime/socket 错误做有界重试；非最终 role node 重试后仍失败或 timeout 时写 `status=degraded` artifact 继续执行；最终 `ranking_report_editor` 失败时基于已完成本地 artifacts 生成 deterministic 降级报告。
- 已处理：`hkipo` workflow `maxRetries=1`，并给单个 role agent process 设置 180s runtime 预算，避免再次拖到全局 30min 后才失败。
- 仍保留边界：鉴权、额度、schema、prompt 或不可识别 runtime 错误不降级，仍按失败处理，避免吞掉真实实现错误。
- 已运行并通过：
  - 红测：`npm test -- tests/unit/agent/workflow/engine.test.ts` 曾在实现前复现 socket 错误会终止 workflow；实现后通过。
  - `npm test -- tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/command.test.ts`
  - `npm test -- tests/unit/agent/workflow/engine-runner-options.test.ts tests/unit/agent/workflow/engine.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `./scripts/validate.sh`（72 test files passed, 1 skipped；500 tests passed, 1 skipped；typecheck/build passed）
  - `./scripts/review.sh`（diff hygiene / format check passed）
  - `git diff --check`
- 真实 E2E：安全重启后通过 Web/API 入口向 Feishu 绑定会话发送 `/hkipo [e2e] e2e-socketfix-1779287948`，创建 run `wfrun_43395015-896a-47e2-acf0-dfacf25f6d97`；触发会话写入启动回执，9 个 workflow steps 全部 `success`，最终消息写入 `✅ 工作流 港股 IPO 打新工作流 (hkipo) 完成：`，结果不包含 `UND_ERR_SOCKET`，包含 `融资/孖展超额` 与 `TradeSmart IPO Tracker`，且不再出现旧文案 `孖展多源未取到`。
- 验证警告均为既有噪声或构建提示：locale `LC_ALL` warning、测试内预期 Feishu fallback/error logs、MaxListeners warning、Vite chunk size warning。

### Milestone 14：HKIPO 孖展术语文案与数据源决策

Objective:
- 澄清 `/hkipo` 报告中“认购倍数”与“孖展/融资倍数”的展示语义：不再输出“孖展多源未取到”这类难懂文案，改为明确“融资/孖展倍数暂无多源核验”；同时调研公开网页中稳定可用的港股 IPO 孖展数据源，解释当前为什么拿不到，并决定本轮是否接入新 source-specific parser。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `.agents/agent-roles/hkipo-ranking-report-editor.md`
- `src/agent/workflow/command.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `/Users/ryan/projects/stock-analysis-api/docs/plan.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/hkipo-heat-scan-cli.md`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_heat_scan_service.py`
- `/Users/ryan/projects/stock-analysis-api/tests/test_hkipo_heat_scan_cli.py`

Validation:
- Root-cause：列出现有 `hkipo_heat_scan` 为什么只有 `subscription_multiple`，没有 `margin_multiple` 的证据。
- Web research：核验至少 AASTOCKS、AiPO/TradeGo、ETNet、券商新股中心这几类来源的公开页面稳定性和字段语义。
- TDD 红测：最终报告/投递 normalizer 不再出现“孖展多源未取到”，改成“融资/孖展倍数暂无多源核验”。
- `npm test -- tests/unit/agent/workflow/command.test.ts`
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests/test_hkipo_heat_scan_cli.py -q`
- 如改实现，补跑 `npm run typecheck`、`npm run build`、相关 `uv run pytest` 和 review gate。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- Root cause：上一版 scanner 主要从致富证券详情页拿到 `subscription_multiple=认购倍数`，并且正确没有把它改名为 `margin_multiple=融资/孖展超额倍数`；AASTOCKS/ETNet/TradeGo 搜索页、智通/格隆汇、个别券商中心在 live smoke 中出现超时、404 或 500，导致 `margin_multiple` 为空。
- Web research：TradeSmart IPO Tracker 公开页面当前内嵌 AiPO margin records，能解析 `oversubscription_ratio`、`margin_total_hkd_yi`、`observed_at` 和上游 URL；AASTOCKS/ETNet 更适合作 IPO 基础资料和新闻 fallback；AiPO 页面提示服务将关闭，不能作为唯一长期主源。
- 已实现：stock-analysis-api 新增 TradeSmart source-specific parser，Cli Claw 报告口径拆分 `margin_multiple` / `subscription_multiple`，旧版“孖展多源未取到”会归一化为“融资/孖展倍数暂无多源核验”。
- 真实 smoke：2026-05-19 当前池 02723/03310/06872/00901 均解析出同日 `margin_multiple`、`margin_amount_hkd_yi` 和致富证券同日 `subscription_multiple`。
- 线上链路 E2E：Feishu 触发 `/hkipo [e2e] hkipo-margin-1779157651`，workflow run `wfrun_e24de0be-2940-4fdb-926c-c480859fa734` 9 个节点全部 success；最终结果包含“融资/孖展超额 ...（TradeSmart IPO Tracker，5/19，多券商聚合）”，不再包含“孖展多源未取到”。
- 已运行并通过：
  - `npm test -- tests/unit/agent/workflow/command.test.ts`
  - `npm test -- tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/config.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `./scripts/validate.sh`
  - `./scripts/review.sh`
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests/test_hkipo_heat_scan_cli.py -q`
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo_official_doc or hkipo" -q`
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -q`

### Milestone 13：HKIPO 核心因子可用性与评分护栏

Objective:
- 修复 `/hkipo` 最终报告在孖展/公开认购/绿鞋/基石/回拨/估值区间等核心因子缺失时仍输出看似可比较分数的问题；补入可公开访问的券商新股详情数据源（优先致富证券等），把当前可见的认购倍数、保荐、主营、发行市值、PE 等字段纳入结构化 evidence；评分卡必须在核心因子缺失时降为 0 / N/A，并在最终报告中明确“数据不足，不给有效热度分/估值分”。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `.agents/agent-roles/hkipo-heat-verifier.md`
- `.agents/agent-roles/hkipo-ranking-report-editor.md`
- `.agents/agent-roles/hkipo-structure-fundamental-analyst.md`
- `.agents/workflows/hkipo.json`
- `src/agent/workflow/command.ts`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `tests/unit/agent/workflow/command.test.ts`
- `/Users/ryan/projects/stock-analysis-api/docs/plan.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/hkipo-heat-scan-cli.md`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_heat_scan_service.py`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_official_doc_service.py`
- `/Users/ryan/projects/stock-analysis-api/tests/test_hkipo_heat_scan_cli.py`
- `/Users/ryan/projects/stock-analysis-api/tests/test_hkipo_official_doc_cli.py`

Validation:
- Root-cause：真实 run 证明原问题不是 IPO 池错误，而是核心因子 evidence 覆盖不足、最终报告会吞掉来源标签或输出内部短码；本轮补齐致富证券详情页解析、官方文件误报过滤、报告 prompt 约束和投递前 normalizer。
- TDD 红测：heat scanner 能从券商新股详情页提取 `subscription_multiple`、`sponsor`、`core_business`、`offer_market_cap`、`pe_ratio`，并带 URL/source time/confidence/staleness。
- TDD 红测：报告/评分规则在无同日孖展或公开认购 evidence 时热度分为 0 或 N/A，不允许出现“热5”；估值区间缺失时估值分为 0 或 N/A。
- 真实源验证：当前 Futu pool 至少 00901、03310、06872 可从公开券商页解析到认购倍数；如 02723 暂无券商详情页，必须明确缺失而不是给热度分。
- 真实飞书 full-chain E2E：发送 `[e2e] /hkipo`，最终消息不再出现“热5”这类无核心因子分数；有证据的标的展示认购倍数来源，无证据的标的热度分 N/A/0。
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests/test_hkipo_heat_scan_cli.py tests/test_hkipo_official_doc_cli.py -q`
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo_official_doc or hkipo" -q`
- `npm test -- tests/unit/agent/workflow/config.test.ts`
- `npm run typecheck`
- `npm run build`
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 不把“认购倍数”强行等同“孖展倍数”；如果来源只写认购倍数，字段只能记为 `subscription_multiple`，报告中必须如实显示“公开/券商认购倍数”，孖展字段仍为缺失。
- 当前券商页可能是 live snapshot 且页面未显式更新时间；只有在招股窗口覆盖 report date 时，才允许以 `updated_at=report_date`、`source_time_mode=active_subscription_window` 低一档置信度纳入同日证据。
- 本轮仍只采公开只读页面，不登录、不绕过验证码/付费/反爬。
- `hkipo_heat_scan.py` 已用真实源验证当前 Futu pool 4 只均可从致富证券详情页解析同日 `subscription_multiple`、保荐、主营、发行市值和 PE；latest live summary 为 `same_day_heat_count=4`、`degraded_count=0`。
- `hkipo_official_docs.py` 已用真实源验证当前 pool 4 只共 8 个 HKEX 文件，官方 parser 能提取公开发售比例、00901/03310/06872 绿鞋 15%，并过滤佣金、规则豁免、角色标签等误报。
- command 层只对 `hkipo` 最终投递文本做展示归一化，不改 workflow state / step audit：旧来源名统一为“致富证券 IPO”，旧内部短码统一改为 `🧮 评分` 行。
- 真实飞书 full-chain E2E 已通过：run `wfrun_095c276e-e33d-4b37-a8fe-5a497552e04f`，9 个节点全部 success，`heat_data_crawler.summary.same_day_heat_count=4`，最终 `[e2e]` 消息 `om_x100b6f80c54f3538c3549289a96d741` 已从飞书 API 读回，断言包含中文来源与具体认购倍数，且不含 `Chief Securities IPO` / `卡：热xx` / `热5`。
- 已运行并通过：
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests/test_hkipo_heat_scan_cli.py tests/test_hkipo_official_doc_cli.py -q`（20 passed）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo_official_doc or hkipo" -q`（20 passed, 231 deselected）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -q`（251 passed）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run black --check ...`（4 files unchanged；保留 Black/Python 版本提示）
  - `npm test -- tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/config.test.ts`（15 passed）
  - `npm run typecheck`
  - `npm run build`
  - `npm --prefix web run build`
  - `./scripts/validate.sh`（71 passed, 1 skipped；497 passed, 1 skipped；typecheck/build passed）
  - `./scripts/review.sh`（diff hygiene / format check passed；semantic review 通过）
- 服务已在 build 后通过 `bun src/cli.ts restart` 安全重启，`/api/health` 返回 healthy；latest loaded build mtime 为 2026-05-18 16:58。
- Review gate：scope 已补记 official doc parser 误报过滤；目标覆盖核心因子提取、评分护栏、报告格式、真实飞书 E2E 与文档同步；未发现阻塞回归。后续仍需补多券商孖展/公开认购/一手中签率/暗盘来源，不把单一券商认购倍数当多源共识。

### Milestone 12：HKIPO 官方数据源文件解析

Objective:
- 将 `/hkipo` 的 `official_doc_crawler` 从“HKEX 搜索入口定位”升级为“官方公告/招股书下载与正文解析”：先尝试 HKEX 标题检索，再回退解析 HKEX “新上市资料” Main Board / GEM 表格；PDF 正文优先用 PyMuPDF 抽取、pypdf 兜底；解析招股章程、配发结果、定价公告、稳定价格公告等文件中的绿鞋/超额配股权、稳定价格操作人、基石投资者、保荐人、公开发售/回拨、发行后市值、所得款用途与核心业务字段，并输出结构化 evidence。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/agent/runner/container-runner.ts`
- `src/agent/workflow/local-tasks.ts`
- `tests/unit/agent/runner/container-runner-preflight.test.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`
- `.agents/workflows/hkipo.json`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `/Users/ryan/projects/stock-analysis-api/AGENTS.md`
- `/Users/ryan/projects/stock-analysis-api/docs/plan.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/hkipo-official-docs-cli.md`
- `/Users/ryan/projects/stock-analysis-api/pyproject.toml`
- `/Users/ryan/projects/stock-analysis-api/requirements.txt`
- `/Users/ryan/projects/stock-analysis-api/scripts/hkipo_official_docs.py`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_official_doc_cli.py`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_official_doc_service.py`
- `/Users/ryan/projects/stock-analysis-api/tests/test_hkipo_official_doc_cli.py`

Validation:
- TDD 红测：官方 docs CLI 从 IPO pool 和 HKEX title search fixture 中定位招股书/配发结果/稳定价格公告链接，并输出 documents metadata。
- TDD 红测：官方 docs parser 从 HTML / PDF-like fixture 正文中提取绿鞋、基石、保荐、回拨、公开发售比例、发行后市值、所得款用途和核心业务 evidence。
- TDD 红测：HKEX 标题搜索无静态结果时，回退解析“新上市资料”表格，并按代码/中文名匹配当前 IPO 的新上市公告、招股章程和配发结果链接。
- 真实源验证：用当前 `HK.02723` 招股书验证 stdout 为严格 JSON，并解析到 `public_float_pct`、`core_business`、`use_of_proceeds`、`offer_market_cap`。
- TDD 红测：缺少文件、下载失败或不可解析 PDF 时输出 source-level error 和降级，不中断整只 IPO 处理。
- TDD 红测：cli-claw `stock.hkipo.fetch_official_docs` 调用 stock-analysis-api 的 `hkipo_official_docs.py`，并使用 `src/core/cache.ts` 的 cache namespace，而不是临时散落到系统 tmp。
- TDD 红测：agent-runner preflight 不能用 `<package>/package.json` 误判 `exports` 隐藏 package.json 的依赖缺失。
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests/test_hkipo_official_doc_cli.py -q`
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_official_doc or hkipo_heat_scan or hkipo" -q`
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -q`
- `npm test -- tests/unit/agent/workflow/local-tasks.test.ts`
- `npm test -- tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/runner/container-runner-preflight.test.ts`
- `npm run typecheck`
- `npm run build`
- 真实飞书 full-chain E2E：发送 `[e2e] /hkipo`，确认 `workflow_runs.status=success`、9 个节点均 `success`、`official_doc_crawler` 输出 `status=ok` 且 `degraded_count=0`。
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 本轮只做公开只读文件定位、下载与解析；不登录券商、不绕过验证码/付费/反爬限制。
- workflow artifact 只能保存 URL、hash、source time、短 snippet 和结构化字段；不得把招股书全文塞进 workflow state。
- PDF/HTML 结构会随 HKEX 页面变化而漂移；真实源失败时必须输出 source-level error 和降级，不能编造绿鞋/基石/估值字段。
- 已新增 stock-analysis-api `scripts/hkipo_official_docs.py`：支持 HKEX title search、HKEX “新上市资料” Main Board / GEM fallback、PDF 正文 PyMuPDF 优先 / pypdf 兜底、stdout 严格 JSON、文件 cache、source-level error 降级。
- 官方文件 source time 优先取 HKEX URL 公告日期，避免 PDF 正文里的上市日期或未来日期污染 `published_at`。
- `stock.hkipo.fetch_official_docs` 使用统一 cache namespace `hkipo-official-docs`；IPO pool 输入走 `withCacheTempDir` 自动清理；官方 PDF cache 由通用 cache cleanup loop 后续统一清理。
- 官方文件解析冷缓存会超过通用 120s local task 预算，本轮将该 task 的有界进程预算提升到 300s；heat scan 仍保留 120s 预算和降级策略。
- 线上 E2E 过程中暴露 agent-runner preflight 对 `@openai/agents/package.json` 的误判：该包已安装但 `exports` 隐藏 package.json。已改为解析包入口本身，并用 fixture 覆盖该导出形态。
- 真实源验证：当前 Futu pool 4 只 IPO 解析到 8 个官方文件；`HK.02723 深演智能` 解析到 `public_float_pct`、`core_business`、`use_of_proceeds`、`offer_market_cap`。
- 真实飞书 full-chain E2E：run `wfrun_d65e3363-2dde-4398-af6e-d8dd80b7b8f0`，`workflow_runs.status=success`，9 个节点均 `success`，`official_doc_crawler` 输出 `status=ok`、`parsed_document_count=8`、`degraded_count=0`；最终 `[e2e]` 飞书消息含中文公司名、emoji、无裸露 `**`。
- 已运行并通过：
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests/test_hkipo_official_doc_cli.py -q`（4 passed）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_official_doc or hkipo_heat_scan or hkipo" -q`（14 passed）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -q`（245 passed）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run black --check ...`
  - `npm test -- tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/runner/container-runner-preflight.test.ts`（12 passed）
  - `npm run typecheck`
  - `npm run build`（通过；保留既有 Vite chunk warning）
  - `./scripts/validate.sh`（71 files passed, 1 skipped；496 tests passed, 1 skipped；typecheck/build passed）
  - `./scripts/review.sh`（diff hygiene / format check passed）
- 语义 review gate：scope 已补充 agent-runner preflight 阻塞修复；目标覆盖官方文件定位、下载、解析、cache 与 E2E；文档已同步 owner docs；未发现阻塞回归。后续仍需继续扩大绿鞋/基石/回拨/估值字段的 source-specific parser 覆盖，真实缺字段时继续降级而不编造。

### Milestone 11：通用缓存目录与统一清理机制

Objective:
- 为 Cli Claw 增加统一缓存根目录和清理机制，后续 HKEX PDF、网页快照、附件下载等临时/可重建文件都落到同一 cache root；服务启动和运行期间定时清理，避免长期磁盘增长。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `src/core/config.ts`
- `src/core/cache.ts`
- `src/index.ts`
- `tests/unit/core/cache.test.ts`
- `docs/RUNTIME.md`
- `docs/MODULE.md`

Validation:
- TDD 红测：cache namespace 只能解析到 `~/.cli-claw/cache/<namespace>` 下，拒绝路径穿越。
- TDD 红测：cleanup 会删除超过 TTL 的文件并清理空目录，保留新文件。
- TDD 红测：cleanup 会按 mtime 删除最旧文件，直到总大小不超过 max bytes。
- TDD 红测：定时清理 loop 启动时先跑一次，随后按 interval 调用，并可 stop。
- `npm test -- tests/unit/core/cache.test.ts`
- `npm run typecheck`
- `npm run build`
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 已新增 `src/core/cache.ts`：统一 cache namespace 解析、目录创建、临时目录、`withCacheTempDir` 自动清理、TTL/容量 cleanup 和定时 cleanup loop。
- 服务启动时会立即运行 cache cleanup，并按 `CLI_CLAW_CACHE_CLEANUP_INTERVAL_MS` 定时清理；shutdown 时停止定时器。
- 本轮只提供通用 cache 基础设施；HKEX 正文下载与 PDF 解析迁移到该 helper 另开 milestone。
- 清理逻辑必须只在 cache root 内工作，不跟 `db`、`groups`、`ops`、runtime session 等持久化目录混用。
- cache 文件默认视为可重建：artifact / DB 只应保存 URL、hash、source time 和短证据片段，不依赖 cache 文件永久存在。
- 已运行并通过：
  - `npm test -- tests/unit/core/cache.test.ts`（6 passed）
  - `npm run typecheck`
  - `npm run build`
  - `./scripts/validate.sh`（70 files passed, 1 skipped；494 tests passed, 1 skipped；typecheck/build passed）
  - `./scripts/review.sh`（diff hygiene / format check passed）
  - 语义 review gate：scope、目标覆盖、清理边界、定时器生命周期、文档同步和测试覆盖均通过。

### Milestone 10：`/hkipo` 核心结构与估值证据增强

Objective:
- 修复 `/hkipo` 当前只报告“官方文件无法核验”的弱体验：为绿鞋、基石、回拨/公众货、保荐人、孖展/公开认购等核心字段建立专门的数据采集与核验路径；分析角色必须基于公司核心能力、行业现状、同类股票 PE / PS / PB 等可比估值，给出估值合理性和合理区间。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `.agents/workflows/hkipo.json`
- `.agents/agent-roles/hkipo-*.md`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/tools.ts`
- `tests/unit/agent/workflow/**`
- `tests/contracts/openai/**`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_heat_scan_service.py`
- `/Users/ryan/projects/stock-analysis-api/src/services/hkipo_heat_scan_cli.py`
- `/Users/ryan/projects/stock-analysis-api/scripts/hkipo_heat_scan.py`
- `/Users/ryan/projects/stock-analysis-api/tests/**`
- `/Users/ryan/projects/stock-analysis-api/docs/plan.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/hkipo-heat-scan-cli.md`

Validation:
- TDD 红测：heat scan artifact 必须包含 `structure_evidence` / `valuation_evidence`，覆盖绿鞋、基石、保荐、回拨/公众货、行业、同类股 PE/PS/PB 与估值区间；缺来源时间或 URL 时降级。
- TDD 红测：workflow prompt / role card 必须要求专门结构数据采集节点多源补证据，并要求分析角色输出核心能力、行业现状、同类估值和合理区间。
- `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo"`
- `npm test -- tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/contracts/openai/runner-request.test.ts`
- `npm run typecheck`
- `npm run build`
- `./scripts/review.sh`
- 安全重启并做真实 `/hkipo [e2e]` full-chain E2E：确认最终飞书报告不再泛泛说“无法核验”，而是列出每只 IPO 的绿鞋/基石/孖展证据状态、估值口径和合理区间；拿不到时明确“多源未取到/降级原因”。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 用户最新反馈：截图中仍大量显示“招股书正文、基石、绿鞋、回拨、估值口径无法核验”，这说明当前 `official_doc_crawler` 只定位入口，`structure_fundamental_analyst` 没有足够结构化证据；需要把数据节点扩展为确定性多源采集，而不是只依赖角色 prompt。
- 本轮仍保持只读公开数据采集，不登录券商、不绕过付费/验证码/反爬；拿不到时必须标注 source-level error 和降级，不得编造。
- 估值不输出买卖建议或本系统目标价；只输出发行估值口径、可比公司倍数区间、对应合理发行价/市值区间和偏高/合理/偏低的事实判断。
- 已新增 `hkipo-core-data-researcher` 专门角色，并把 bundled `hkipo` workflow 扩为 9 节点：核心数据采集计划在 `heat_data_crawler` 前置，`stock.hkipo.scan_heat` 输出 `structure_evidence` / `valuation_evidence`，后续 verifier / analyst / editor 使用结构化 artifact。
- `stock-analysis-api` 的 `hkipo_heat_scan` 现在会归一化绿鞋、基石、保荐、稳价人、公开发售/回拨、核心业务/能力、行业、同类 PE 和合理估值区间证据；无 URL / 来源时间 / confidence 时会降级，不纳入核心证据。
- E2E 发现 Futu 页面碎片会产生不可识别 `0x/5x/57x PE` 噪音，已加回归测试并限制 `peer_pe` 仅在“同类/可比/同业”上下文提取。
- 已运行并通过：
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests/test_hkipo_heat_scan_cli.py -q`（10 passed）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -k "hkipo_heat_scan or hkipo" -q`（10 passed, 231 deselected）
  - `cd /Users/ryan/projects/stock-analysis-api && uv run pytest tests -q`（241 passed）
  - `npm test -- tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/contracts/openai/runner-request.test.ts`（18 passed）
  - `npm run typecheck`
  - `npm run build`
  - `npm --prefix web run build`
  - `./scripts/validate.sh`（69 test files passed, 1 skipped；488 tests passed, 1 skipped；typecheck/build passed）
  - `./scripts/review.sh`（diff hygiene / format check passed；语义 review 通过）
  - `FEISHU_LIVE_E2E=1 ... npm test -- tests/live/feishu/message-smoke.test.ts`（1 passed）
  - 安全重启后真实 `/hkipo [e2e]`：`wfrun_7076ebcf-6ae4-44d1-8610-cc17455dd655`，9/9 节点 success，最终飞书消息包含 `🛡 结构` / `📊 估值` / `🔎 池子校验`，并确认 PE 噪音检查为 `clean`。
- 当前真实 IPO 池仍因公开源/官方正文不可取而大量降级，这是数据可得性结果，不再是编排缺失；后续若要进一步提升，需要增加 HKEX 正文/招股书 PDF 定位与解析能力。

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
- Milestone 15

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `.agents/workflows/hkipo.json`
- `src/agent/workflow/engine.ts`
- `src/agent/runner/container-runner.ts`
- `tests/unit/agent/workflow/engine.test.ts`
- `tests/unit/agent/workflow/engine-runner-options.test.ts`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`

Last failure summary:
- 线上失败 run `wfrun_1102c43a-ecdd-41f0-893e-455e34339486` 卡在 `core_data_researcher`，agent runtime 因 `UND_ERR_SOCKET` 退出；上一版 role node 没有 workflow 层 retry/degrade/fallback，直接让 `/hkipo` 失败并把底层 undici 堆栈发给用户。

Suspected cause:
- 已处理：这是 OpenAI/undici transient socket 断连触发的 runtime crash，不是 IPO 池或数据源本身错误；workflow 现在对可识别 transient runtime 错误做有界重试和 HKIPO 专用降级，最终节点还有 artifact fallback 报告兜底。

Next step:
- 已通过全量 validation、review gate 和真实 E2E；提交本轮 cli-claw 改动。
