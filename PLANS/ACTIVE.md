# 当前任务：全量迁移旧品牌状态目录引用

## Goal

- 扫描 `/Users/ryan/projects` 下所有仓库/模块对旧品牌名、旧点目录和旧环境变量前缀的引用。
- 将仍作为默认读写位置、文档指令、测试期望或配置约定的旧目录统一迁移到 `agent-fabric` / `.agent-fabric`。
- 不保留旧状态目录作为默认或 fallback；历史负向测试改成 generic obsolete/legacy 示例。

## Done when

- 扫描结果列出所有命中 repo/module，并区分生产代码、测试、文档、历史日志/构建产物。
- 生产默认路径不再指向旧状态目录。
- 直接相关测试先红后绿；跨仓库改动各自跑对应最小验证。
- Agent Fabric 侧 typecheck/build/review gate 通过；必要时安全重启。
- 结果与 handoff 回写本文件；完成后提交相关仓库改动。

## Milestones

### Milestone 1：全量扫描并锁定迁移范围

Objective:
- 扫描 `/Users/ryan/projects`，找出所有旧品牌名、旧点目录和旧环境变量前缀引用，排除 `node_modules`、`.git`、venv、dist/cache 等生成物。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读扫描 `/Users/ryan/projects/**`

Validation:
- `rg` 扫描命中清单
- 对命中 repo 分别查看 `git status --short --branch`

Status:
- done

Validation status:
- passed
- 2026-06-14 12:04 EDT：`git grep` / per-repo `rg` 扫描完成。真实命中：
  - `stock-kol-intel`：KOL command、twscrape add/healthcheck 脚本和 provider 文档仍默认旧状态目录。
  - `agent-fabric`：KOL local task 与运行时文档仍保留旧状态目录 fallback/说明；测试和 `.gitignore` 仍有 legacy 字面量。
  - `stock-analysis-skill`：HKIPO、OTC、Research command 仍读取旧 skill dir 环境变量；测试仍注入旧变量。
  - `stock-analysis-api`：文档示例中有旧 cache 路径和旧 owner id。
  - `agent-skills/opc-idea-miner`：临时 venv 前缀仍为旧品牌前缀。
  - 其他已扫 git repo：`runclaw`、`happyclaw`、`hermes-agent`、`daily_stock_analysis`、`deer-flow`、`edict`、`pet-tracking-app`、`awesome-claude-skills`、`balance-master`、`vscode-settings`、`financial-services-plugins`、`TradingAgents`、`ryanpromax.github.io`、`uncle-tom-miniapp`、`learn-claude-code` 无命中。

Review status:
- passed

Risks / Notes / Handoff:
- 当前 `main` 本地领先 `origin/main` 4 个提交，push 仍受 GitHub HTTPS 凭据阻塞。

### Milestone 2：测试先行迁移代码与文档

Objective:
- 对 Milestone 1 发现的真实源码/测试/文档引用做最小迁移。

Allowed scope:
- `PLANS/ACTIVE.md`
- `/Users/ryan/projects/stock-kol-intel/commands/kol.py`
- `/Users/ryan/projects/stock-kol-intel/scripts/twscrape_add_cookie_account.py`
- `/Users/ryan/projects/stock-kol-intel/scripts/twscrape_healthcheck.py`
- `/Users/ryan/projects/stock-kol-intel/references/twscrape_provider.md`
- `/Users/ryan/projects/stock-kol-intel/tests/test_kol_command.py`
- `/Users/ryan/projects/agent-fabric/.gitignore`
- `/Users/ryan/projects/agent-fabric/src/agent/workflow/local-tasks.ts`
- `/Users/ryan/projects/agent-fabric/docs/RUNTIME.md`
- `/Users/ryan/projects/agent-fabric/tests/unit/agent/workflow/local-tasks.test.ts`
- `/Users/ryan/projects/agent-fabric/tests/contracts/runtime/codex-cli-auth.test.ts`
- `/Users/ryan/projects/agent-fabric/tests/contracts/runtime/service-restart-guard.test.ts`
- `/Users/ryan/projects/agent-fabric/tests/unit/agent/runner/output-parser.test.ts`
- `/Users/ryan/projects/agent-fabric/tests/unit/app/self-restart.test.ts`
- `/Users/ryan/projects/agent-fabric/tests/unit/core/cache.test.ts`
- `/Users/ryan/projects/agent-fabric/tests/unit/core/config/storage-root.test.ts`
- `/Users/ryan/projects/agent-fabric/tests/unit/skills/command-dispatch.test.ts`
- `/Users/ryan/projects/stock-analysis-skill/commands/hkipo.py`
- `/Users/ryan/projects/stock-analysis-skill/commands/otc.py`
- `/Users/ryan/projects/stock-analysis-skill/commands/research.py`
- `/Users/ryan/projects/stock-analysis-skill/tests/test_hkipo_command.py`
- `/Users/ryan/projects/stock-analysis-skill/tests/test_otc_command.py`
- `/Users/ryan/projects/stock-analysis-skill/tests/test_research_command.py`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/hkipo-official-docs-cli.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/agentic-strategy-loop.md`
- `/Users/ryan/projects/agent-skills/opc-idea-miner/commands/idea.py`
- `/Users/ryan/projects/agent-skills/opc-idea-miner/tests/test_idea_command.py`

Validation:
- 先补/调整红线测试并确认失败。
- 对每个改动仓库运行最小相关测试。

Status:
- done

Validation status:
- passed
- 红线确认：
  - `stock-kol-intel` 新增默认 twscrape DB 路径测试后，旧默认路径实现按预期失败。
  - `stock-analysis-skill` sibling API root 测试改为新 skill dir 环境变量后，旧实现按预期失败。
- 绿线验证：
  - `stock-kol-intel`: `python -m unittest tests/test_kol_command.py`，9 tests passed。
  - `stock-analysis-skill`: `python3 -m unittest tests.test_hkipo_command tests.test_research_command tests.test_otc_command`，55 tests passed。
  - `agent-fabric`: affected vitest，8 files / 71 tests passed。
  - `stock-analysis-api`: docs-only，`git diff --check` passed。
  - `agent-skills`: targeted `IdeaCommandTests.test_executor_uses_requirements_hash_cache_path` passed；完整 idea command suite 仍因既有外部 CLI/subprocess 依赖失败，未作为本轮 gate。

Review status:
- passed
- 按 `RUNBOOKS/Review.md` 做过语义 review：迁移范围与 Milestone 1 命中一致，未保留旧状态目录默认或 fallback；测试中的旧品牌负例已改成 generic obsolete/legacy 示例。

Risks / Notes / Handoff:
- 用户要求“全量改成新文件夹”，本轮不保留旧状态目录默认或 fallback；历史负向测试改成不含旧品牌字面量的 generic legacy/unsafe 示例。
- 本地旧状态文件已搬到 `.agent-fabric/` 对应位置，旧 sqlite 文件改名为 `agent-fabric.sqlite`；这些文件为本地 ignored state，不纳入提交。

### Milestone 3：全量复扫、验证、提交

Objective:
- 复扫确认旧默认引用清零，运行验证与 review gate，提交改动。

Allowed scope:
- 本轮实际改动文件
- `PLANS/ACTIVE.md`
- Git commit

Validation:
- 复扫旧品牌名、旧点目录和旧环境变量前缀，确认无命中。
- Agent Fabric: `git diff --check`、targeted tests、`npm run typecheck:backend`、`npm run build:backend`、`./scripts/review.sh`
- 其他仓库按自身测试入口验证

Status:
- done

Validation status:
- passed
- 旧品牌/旧点目录/旧环境变量前缀复扫清零：
  - `agent-fabric`
  - `stock-kol-intel`
  - `stock-analysis-skill`
  - `stock-analysis-api`
  - `agent-skills`
- `agent-fabric`: `./scripts/review.sh` passed。
- `agent-fabric`: `npm run typecheck:backend && npm run build:backend` passed。
- `agent-fabric`: `bun src/cli.ts restart` requested safe restart，`GET /api/health` returned healthy。
- 其他改动仓库均已跑 `git diff --check` 或目标测试。

Review status:
- passed
- Review gate passed：未发现 scope violation、残留旧默认路径、文档/代码冲突或明显回归风险。

Risks / Notes / Handoff:
- 当前 4 个已提交 git 仓库推送均受 GitHub HTTPS 凭据阻塞：`fatal: failed to get: -25308` / `could not read Username for 'https://github.com': terminal prompts disabled`。需要用户侧刷新 GitHub 凭据后重试 push。

### Milestone 4：残留文本复扫、E2E 与提交收尾

Objective:
- 复查 Milestone 3 后仍可优化的旧品牌/旧点目录文字残留，清理非必要测试标题、注释和本地忽略项；对需要保留的第三方署名、MIT 来源或领域字段做明确分类。
- 重新运行相关验证、subagent review 和 E2E gate，再提交本轮补充改动。

Allowed scope:
- `PLANS/ACTIVE.md`
- `/Users/ryan/projects/agent-fabric/.gitignore`
- `/Users/ryan/projects/agent-fabric/src/agent/queue/group-queue.ts`
- `/Users/ryan/projects/agent-fabric/src/messaging/providers/feishu/streaming-card.ts`
- `/Users/ryan/projects/agent-fabric/tests/unit/presentation/tool-step-display.test.ts`
- `/Users/ryan/projects/agent-fabric/tests/unit/messaging/feishu/streaming-card.test.ts`
- `/Users/ryan/projects/agent-fabric/tests/integration/agent/restart-recovery.test.ts`
- `/Users/ryan/projects/stock-analysis-skill/.gitignore`
- `/Users/ryan/projects/stock-analysis-api/.gitignore`
- 只读复核：`README.md`、`web/src/components/settings/AboutSection.tsx`、`src/messaging/providers/feishu/markdown-style.ts`、跨仓旧引用扫描结果。

Validation:
- 复扫旧默认路径、旧点目录和旧环境变量前缀，确认生产默认与测试期望无残留。
- 复扫旧品牌关键词，区分已清理项、第三方署名 / license 来源、领域字段和 roadmap 历史记录。
- `npm test -- tests/unit/presentation/tool-step-display.test.ts tests/unit/messaging/feishu/streaming-card.test.ts tests/integration/agent/restart-recovery.test.ts`
- `npm run typecheck:backend`
- `npm run build:backend`
- `./scripts/review.sh`
- E2E gate：优先运行仓库 in-process E2E；如能按 `docs/E2E.md` 发现可用私聊入口和 App 凭据，再运行 Feishu live smoke。

Status:
- done

Validation status:
- passed
- 复扫旧默认路径、旧点目录和旧环境变量前缀清零：`CLI_CLAW|\.cli-claw|cli-claw|CLAUDE_CODE|CLAUDE|claude-code|claude_code|\.claude` 在 5 个相关路径中无命中（排除生成物、lockfile 和 `PLANS/ACTIVE.md`）。
- 旧品牌关键词复扫只剩分类保留项：
  - `README.md`：`happyclaw` 为第三方灵感来源署名。
  - `web/src/components/settings/AboutSection.tsx`：`openclaw` 为第三方项目叙述。
  - `src/messaging/providers/feishu/markdown-style.ts`：`openclaw-lark` 为 MIT 改编来源说明。
- `git diff --check` passed：`agent-fabric`、`stock-analysis-skill`、`stock-analysis-api`。
- `npm test -- tests/unit/presentation/tool-step-display.test.ts tests/unit/messaging/feishu/streaming-card.test.ts tests/integration/agent/restart-recovery.test.ts`：3 files / 102 tests passed。
- `npm test -- tests/integration/messaging/feishu/e2e.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`：2 files / 17 tests passed。
- `npm run typecheck:backend` passed。
- `npm run build:backend` passed。
- `./scripts/review.sh` passed hygiene / format check。
- `FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=<private chat> npm test -- tests/live/feishu/message-smoke.test.ts`：1 file / 1 test passed，真实发送并读回 `[e2e]` 消息。

Review status:
- passed
- Subagent scope / residual review：无 blocking finding；三仓 diff 均在 Milestone 4 allowed scope 内；旧默认路径、旧点目录、旧 env 前缀无残留；旧品牌残留均为计划分类保留项。
- Subagent runtime / test review：无 blocking finding；本轮代码侧为纯文本清理，`restart-recovery` prompt 字符串成对替换，验证覆盖足够。
- 本地语义 review：scope、objective、pattern-fit、validation、hygiene、docs/comments、regression contract 均通过；`.claude/` ignore 删除后若未来本地工具再生成该目录，提交前需留意 git status，但不影响构建或测试。

Risks / Notes / Handoff:
- `happyclaw` / `openclaw` 在 README 和 Web About 中是第三方项目叙述，不是状态目录默认或 fallback；除非 review 认为产品文案也必须去除，否则先分类保留。
- `openclaw-lark` 是 MIT 改编来源说明，属于 license/source attribution，不作为旧默认引用清理。
- `clawback` 是港股 IPO “回拨”字段英文名，不属于旧品牌命中。

## Handoff

Current milestone:
- Milestone 4

Current status:
- complete

Changed files:
- `PLANS/ACTIVE.md`
- `agent-fabric`: runtime fallback、runtime doc、ignore rule、legacy negative tests；本轮继续清理非必要旧品牌文字残留
- `stock-kol-intel`: KOL command/scripts/provider doc/test
- `stock-analysis-skill`: command skill dir env/test；本轮继续清理旧点目录 ignore 规则
- `stock-analysis-api`: docs examples；本轮继续清理旧点目录 ignore 规则
- `agent-skills`: OPC idea miner temp venv prefix/test

Last failure summary:
- None. Milestone 4 validation, E2E and subagent review passed.

Suspected cause:
- 历史重命名后，部分 sibling skill、KOL twscrape 状态目录、文档示例和负向测试仍保留旧品牌字面量或旧默认目录。

Next step:
- 本轮实现已完成；提交当前三仓补充改动。远端 push 仍取决于 GitHub HTTPS 凭据恢复。
