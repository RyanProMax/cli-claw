# 当前任务：优化 KOL 工作流进度卡片与报告信息密度

## Goal

- 优化飞书 `/kol` workflow 进度卡片的顶部信息结构，避免 Run、状态、节点、耗时、时间和任务挤在同一段里。
- 分析并精简 KOL workflow 结果中冗余、低信息密度描述，只保留结论、方向、依据、标的/行业和下一步核验等关键信息。

## Done when

- Workflow 进度卡顶部按信息分组换行展示，移动端可读，不再混成一段。
- KOL 结果归一化会删除默认套话、空泛描述和重复标题，结论/核验拆成列表。
- 相关单元/integration/E2E 自测通过，并记录输出样式仍可优化的观察。
- validation 和 review gate 通过；结果与 handoff 已回写本文件。

## Milestones

### Milestone 1：复现与红线测试

Objective:
- 找到进度卡头部和 KOL 结果冗余的生成链路，并用测试固化当前问题。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/messaging/providers/feishu/workflow-progress-card.ts`
- `src/agent/workflow/command.ts`
- `.agents/workflows/kol.json`
- `.agents/agent-roles/kol-intel-reporter.md`
- `tests/unit/messaging/feishu/workflow-progress-card.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/integration/messaging/feishu/kol-command-e2e.test.ts`
- 只读检查相关 docs / E2E 入口

Validation:
- `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`

Status:
- done

Validation status:
- passed:
  - 红线先失败：`npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`，失败点分别命中进度卡头部单块 markdown 和 KOL 低价值内容未过滤。
  - 修复后同一 targeted 命令通过，14 tests passed。

Review status:
- passed

Risks / Notes / Handoff:
- 根因确认：进度卡把所有 run metadata join 成单个 markdown 元素并用 `<br>` 分隔，飞书渲染/移动端截图容易挤成一段；KOL 报告 prompt 与 normalize 只做格式清理，对“信息很长但无新证据”的空泛句子缺少确定性过滤。

### Milestone 2：实现样式与结果精简

Objective:
- 调整卡片结构与 KOL 报告归一化/角色约束，使输出更短、更分点、更聚焦。

Allowed scope:
- Milestone 1 允许范围内的实现、prompt、测试文件
- 必要时同步 `docs/COMMAND.md` 中 `/kol` 输出契约

Validation:
- `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`
- 运行 `/kol` 相关 in-process E2E 或 live smoke，记录真实输出观察

Status:
- done

Validation status:
- passed:
  - `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/engine.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts tests/integration/messaging/feishu/e2e.test.ts`，7 files / 56 tests passed。
  - `npm run typecheck:backend`
  - `FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=oc_98f0bb60f284627bf20f9386704f8c82 npm test -- tests/live/feishu/message-smoke.test.ts`，真实飞书 `[e2e]` 文本发送与读回通过。

Review status:
- passed: 人工检查 diff 后确认进度卡头部已拆成独立 card elements；KOL 精简只删除免责声明、泛泛观察句和第 4 个以后主题，保留来源提醒、来源链接、日期、股票/ETF 和具体事实。

Risks / Notes / Handoff:
- 精简规则是保守过滤：不删带来源、日期、股票代码、行业链或具体事实的内容；来源存疑提醒仍保留。
- 本轮观察：卡片顶部已从“标题 + `<br>` 拼接元信息”的单块 markdown 改为标题、Run、状态/节点/耗时、时间、任务五个元素；模拟 E2E payload 中首个元素不再包含 `🆔 Run` 或 `<br>`。

### Milestone 3：验证、review、提交

Objective:
- 完成本轮验证、review gate、必要服务应用与提交。

Allowed scope:
- 本轮修改文件
- `PLANS/ACTIVE.md`
- Git commit

Validation:
- `git diff --check`
- targeted tests
- `./scripts/review.sh`
- 如改动影响类型或构建，补跑对应 typecheck/build

Status:
- done

Validation status:
- passed:
  - `git diff --check`
  - `npm run typecheck:backend`
  - `npx vitest run tests/unit/messaging/feishu/workflow-progress-card.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/engine.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts tests/integration/messaging/feishu/e2e.test.ts`
  - `FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=oc_98f0bb60f284627bf20f9386704f8c82 npm test -- tests/live/feishu/message-smoke.test.ts`
  - `npm run build:backend`
  - `bun src/cli.ts restart`，restart intent `restart-2026-06-14T07-56-41-099Z-4c0d1743` status `passed`
  - `curl -fsS http://127.0.0.1:3000/api/health` 返回 `healthy`
  - `./scripts/review.sh`

Review status:
- passed: `./scripts/review.sh` 通过；按 `RUNBOOKS/Review.md` 人工 diff review 未发现 blocking 问题。

Risks / Notes / Handoff:
- 测试输出仍出现既有 `MaxListenersExceededWarning`，但相关测试全部通过，非本轮新增失败。
- 本轮没有需要同步到 `PLANS/ROADMAP.md` 的跨轮次事项。

## Handoff

Current milestone:
- Milestone 3 done

Current status:
- committed，backend build 已更新，安全重启已应用，服务健康

Changed files:
- `.agents/agent-roles/kol-intel-reporter.md`
- `.agents/workflows/kol.json`
- `PLANS/ACTIVE.md`
- `docs/COMMAND.md`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/local-tasks.ts`
- `src/messaging/providers/feishu/workflow-progress-card.ts`
- `tests/integration/messaging/feishu/e2e.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/messaging/feishu/workflow-progress-card.test.ts`

Last failure summary:
- 红线阶段进度卡/KOL 精简测试按预期失败；首次 `./scripts/review.sh` 因 `workflow-progress-card.ts` 需要 Prettier 格式化失败。格式化后所有验证与 review 通过。

Suspected cause:
- 已修复：进度卡头部结构过度依赖单个 markdown `<br>` 拼接；KOL 终态归一化缺少低价值文案过滤，role/workflow/local task 又强制填太多字段。

Next step:
- 无；后续观察真实 `/kol` 输出是否还出现具体信源不足导致的低信号主题。
