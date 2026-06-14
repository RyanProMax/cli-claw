# 当前任务：二次修复 KOL 进度卡与无效情报报告

## Goal

- 根据真实飞书截图继续优化 `/kol` workflow 进度卡：标题字号恢复可读，只保留用户需要的状态、节点数、耗时和开始时间，删除 Run ID、更新时间和任务名等噪音。
- 处理 KOL 终态报告“没有任何有用信息”的问题：当原文不可核验或没有高信号主题时，不再生成长篇伪报告，而是输出短失败/低信号说明和可执行修复建议。
- 使用独立 reviewer agent 参与审查报告质量和卡片可读性，主 agent 负责最终实现、验证和提交。

## Done when

- 飞书 workflow 进度卡顶部不再展示 Run ID、更新时间、任务名，标题不再被压成小号 notation/五级标题。
- workflow 节点摘要不再把最终报告长正文塞进进度卡，只显示短状态摘要。
- KOL 结果在 `x_preflight` 未恢复、没有可核验原文或没有高信号主题时，返回短而明确的“暂无可用情报”结果，不输出带股票代码示例的空泛长报告。
- reviewer agent 给出结构化审查意见，并且本轮修复覆盖其 blocking 建议。
- targeted tests、飞书 workflow E2E、typecheck、review gate、必要 build/restart 通过；结果与 handoff 回写本文件。

## Milestones

### Milestone 1：复现真实截图问题并锁定根因

Objective:
- 用测试复现顶部卡片噪音/字号问题、节点内容过长问题，以及 KOL 无高信号时仍生成长伪报告的问题。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/workflow-progress-card.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
- `src/agent/workflow/local-tasks.ts`
- `.agents/workflows/kol.json`
- `.agents/agent-roles/kol-intel-reporter.md`
- `docs/COMMAND.md`
- `tests/unit/messaging/feishu/workflow-progress-card.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/agent/workflow/engine.test.ts`
- `tests/integration/messaging/feishu/e2e.test.ts`

Validation:
- 先补红线测试并确认失败：
  - `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/engine.test.ts tests/integration/messaging/feishu/e2e.test.ts`

Status:
- done

Validation status:
- passed
- 2026-06-14 10:42 EDT：补充红线后运行
  `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/engine.test.ts tests/integration/messaging/feishu/e2e.test.ts`，确认失败点覆盖：
  - workflow 进度卡标题被 `optimizeMarkdownStyle` 降成 `#####`。
  - 头部仍展示 Run ID、更新时间、任务名，metadata 过密。
  - role 节点把最终长报告正文塞进进度卡摘要。
  - KOL 无高信号报告仍保留作者名单和模板标的。

Review status:
- passed
- 根因与截图一致：卡片展示边界和 KOL 低信号投递边界都缺少硬约束。
- 独立 reviewer agent `019ec65b-5bbc-7c81-96e2-dfc9c7513a5e` 仍无法通过当前线程工具读取，最终 Milestone 3 继续记录该限制并做本地 review gate。

Risks / Notes / Handoff:
- 截图显示上一轮把顶部拆成多元素后又给 metadata 全部加了 `text_size: notation`，标题还经过 `optimizeMarkdownStyle` 被 H2 降成 H5，实际视觉偏小。
- 截图中的最终报告并不是“情报报告”，而是 preflight 不可核验后的长说明；它还输出了 `NVDA/TSM/AVGO/...` 等模板示例，容易被误读成实际方向。

### Milestone 2：实现卡片与低信号报告修复

Objective:
- 精简 workflow 进度卡头部和节点摘要；把无高信号 KOL 结果变成短、明确、无伪标的的低信号结果。

Allowed scope:
- Milestone 1 允许范围内的实现、prompt、测试文件
- 必要时同步 `docs/COMMAND.md` 中 `/kol` 输出契约

Validation:
- `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/engine.test.ts tests/integration/messaging/feishu/e2e.test.ts`
- 补跑 KOL local task/config 相关测试，如 prompt/template 被修改

Status:
- done

Validation status:
- passed
- 2026-06-14 10:45 EDT：
  `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/integration/messaging/feishu/e2e.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`
  通过，7 个测试文件 / 58 个用例。

Review status:
- passed
- 2026-06-14 11:01 EDT：独立 reviewer agent `019ec6a2-d71c-74f2-abfb-a77371b13847` 返回 `blocking_findings: none`。
- 已采纳 reviewer 非阻塞建议：把 `local-tasks.ts` 的 KOL 高信号模板从“典型股票/ETF”收敛为“来源明确支撑；没有就写暂无”。

Risks / Notes / Handoff:
- 不能因为无高信号就静默失败；用户仍需要知道“为什么没有报告”和“下一步该怎么恢复数据源”。
- 已同步 role card、workflow prompt、local task artifact 和 `docs/COMMAND.md`，避免模型源头继续生成低信号长报告；投递层仍保留确定性归一化兜底。

### Milestone 3：独立 review、E2E、自测和提交

Objective:
- 等 reviewer agent 返回意见后做 final review，跑 E2E/真实 smoke/安全重启并提交。

Allowed scope:
- 本轮修改文件
- `PLANS/ACTIVE.md`
- Git commit

Validation:
- `git diff --check`
- targeted tests
- `npm run typecheck:backend`
- `FEISHU_LIVE_E2E=1 ... message-smoke`
- `./scripts/review.sh`
- `npm run build:backend`
- `bun src/cli.ts restart`
- `curl -fsS http://127.0.0.1:3000/api/health`

Status:
- done

Validation status:
- passed
- 2026-06-14 11:01 EDT：最终验证通过：
  - `git diff --check`
  - `npx vitest run tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/integration/messaging/feishu/e2e.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`，7 个测试文件 / 58 个用例。
  - `npm run typecheck:backend`
  - `npm run build:backend`
  - `./scripts/review.sh`
  - `FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=oc_98f0bb60f284627bf20f9386704f8c82 npm test -- tests/live/feishu/message-smoke.test.ts`
  - `bun src/cli.ts restart`
  - `curl -fsS http://127.0.0.1:3000/api/health` 返回 `{"status":"healthy","checks":{"database":true,"queue":true,"uptime":4}}`

Review status:
- passed
- `./scripts/review.sh` 通过；独立 reviewer agent 结论为无 blocking。

Risks / Notes / Handoff:
- 用户明确要求不要只自审，必须使用独立 reviewer role 推进；最终总结需说明 reviewer 结论和采纳情况。
- 残余风险：no-signal 归一化依赖模型输出中出现“高信号主题：暂无/未形成”等低信号措辞；已在 role prompt、workflow prompt、local task artifact 和投递层兜底多层约束。

## Handoff

Current milestone:
- Milestone 3

Current status:
- complete; validation, review, live smoke, build, safe restart and health check passed

Changed files:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/workflow-progress-card.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
- `src/agent/workflow/local-tasks.ts`
- `.agents/workflows/kol.json`
- `.agents/agent-roles/kol-intel-reporter.md`
- `docs/COMMAND.md`
- related unit/integration tests

Last failure summary:
- 无待处理失败；最终验证全部通过。

Suspected cause:
- 已修复：卡片标题不再走 markdown optimizer，头部字段收敛；role 节点正文只显示短摘要；KOL 无高信号和 runtime fallback 都输出短低信号结果。

Next step:
- 提交本轮变更。
