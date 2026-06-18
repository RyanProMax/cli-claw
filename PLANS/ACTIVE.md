# 当前任务：修复 git email 历史与 `/hkipo` 报错

## Goal

- 将当前设备与相关本地仓库的 git author/committer email 修正为 GitHub 账号可关联的邮箱，清理本地未推送历史中误用 `627311610@qq.com` 的提交。
- 复现并修复 `/hkipo` 报错，按根因补测试与验证，确保命令 / workflow 入口恢复可用。

## Done when

- 当前 shell、全局 git config、相关仓库 local git config 均不再使用 `627311610@qq.com`。
- `/Users/ryan/projects` 下相关 git repo 的本地提交作者和提交者邮箱均不是 `627311610@qq.com`；若需要修复已发布个人 repo 历史，先创建 bundle 备份，再用 `--force-with-lease` 推送。
- `/hkipo` 报错有明确复现证据、根因说明和回归测试；修复后相关单测 / workflow 或 live smoke 验证通过。
- Agent Fabric 侧相关验证、review gate 通过；若影响运行中的服务，按 `docs/COMMAND.md` 安全重启。
- 本文件回写结果与 handoff；完成后提交必要代码/文档改动。

## Milestones

### Milestone 1：git email 配置与本地历史审计

Objective:
- 审计当前设备、相关仓库和本地 git 历史中的 git email，确认是否仍有 `627311610@qq.com`，并修正配置 / 历史提交。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读扫描 `/Users/ryan/projects/**/.git`
- git config 修改：global 或相关仓库 local config
- 对确认命中 `627311610@qq.com` 的个人 repo，允许先创建本地 bundle 备份，再重写 author/committer email，并使用 `--force-with-lease` 更新对应远端分支

Validation:
- `git config --list --show-origin --show-scope | rg 'user.email|627311610@qq.com'`
- 对相关 repo 执行 `git log --all --format='%h %ae %ce %s'`，确认本地分支 / 远端跟踪历史无错误邮箱。
- 对重写过的 repo 执行 `git ls-remote origin` 或推送后 ref 检查，确认远端分支已更新到重写后的提交。
- 全量扫描 `/Users/ryan/projects` 下 git repo，确认当前分支 local config 与历史提交无错误邮箱。

Status:
- blocked_remote_push

Validation status:
- partial
- 当前环境配置：
  - `git config --global --get user.email` => `ryan.pro.1024@gmail.com`
  - `git config --get user.email` in relevant repos => `ryan.pro.1024@gmail.com`
  - `git var GIT_AUTHOR_IDENT` / `GIT_COMMITTER_IDENT` => `Ryan <ryan.pro.1024@gmail.com>`
- `/Users/ryan/projects` 下 21 个 git repo 扫描完成：所有 local config 与本地未推送 ahead commits 均未使用 `627311610@qq.com`。
- 全历史扫描命中已发布历史中的错误邮箱：
  - `agent-skills`: 3 commits
  - `balance-master`: 16 commits
  - `ryanpromax.github.io`: 122 commits
  - `stock-analysis-api`: 48 commits
  - `vscode-settings`: 11 commits
- 已创建 bundle 备份：`/tmp/agent-fabric-email-rewrite-20260618100606/*.bundle`，并保存 rewrite 前 refs：`*.refs.before`。
- 已本地 rewrite 以上 5 个 repo，只替换 author/committer email 等于 `627311610@qq.com` 的字段为 `ryan.pro.1024@gmail.com`；重写后本地 `git log --all --format='%ae %ce'` 对 5 个 repo 的 bad count 均为 0。
- 远端推送尝试失败：HTTPS `git push --force-with-lease` 报 `fatal: failed to get: -25308` / `could not read Username for 'https://github.com': Device not configured`；SSH `ssh -T -o BatchMode=yes git@github.com` 无响应并被终止。

Review status:
- pending

Risks / Notes / Handoff:
- 初步检查显示所有 repo local/global config 与未推送 ahead commits 当前均为 `ryan.pro.1024@gmail.com`。
- 全历史扫描发现 `agent-skills`、`balance-master`、`ryanpromax.github.io`、`stock-analysis-api`、`vscode-settings` 的已发布历史中仍有 `627311610@qq.com`；若要让 GitHub 重新关联这些历史 commit，必须重写并 force-push 对应个人 repo 分支。
- 历史重写会改变 commit SHA；执行前必须保存 bundle 备份并记录旧远端 SHA，推送使用 `--force-with-lease`。
- 本地 rewrite 已完成；远端更新仍被 GitHub 凭据 / SSH 连接阻塞。后续凭据恢复后需要推送：
  - `agent-skills main`
  - `balance-master main`
  - `balance-master develop`
  - `ryanpromax.github.io main`
  - `stock-analysis-api main`
  - `vscode-settings master`

### Milestone 2：复现并定位 `/hkipo` 报错

Objective:
- 找到 `/hkipo` 当前报错的真实失败点，完成 systematic debugging 的根因调查。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读日志 / DB / workflow run 审计
- 只读执行 `/hkipo` 相关 preflight、skill command、local task 或测试命令
- 相关文件读取：`docs/COMMAND.md`、`docs/RUNTIME.md`、`docs/E2E.md`、`.agents/workflows/**`、`src/agent/workflow/**`、`stock-analysis-skill` 与 `stock-analysis-api` 的 `/hkipo` 相关代码

Validation:
- 记录一个可重复触发的失败命令、日志或 workflow run id。
- 写出根因假设与证据链，说明失败发生在哪个边界：skill command、workflow dispatch、local task、stock-analysis-api CLI、Futu/OpenD、外部网页/PDF 或 final role output。

Status:
- done

Validation status:
- passed
- 真实失败 run：`wfrun_4cfde923-f062-4455-b39a-e29b4468310c`，`ipo_pool_discovery` 节点 error。
- 审计错误：`Command failed: /Users/ryan/.local/bin/uv run python scripts/futu_market_data.py ipo-list --market HK --json`，stderr 为空，耗时约 120s。
- 本地复现：
  - `ipo-list --market HK --json` 在 45s 内无 stdout/stderr，Python wrapper timeout exit 124。
  - `global-state --json` 在 15s 内无 stdout/stderr，Python wrapper timeout exit 124。
- 根因定位：失败边界是 `stock-analysis-api` 的 Futu/OpenD CLI / `FutuOpenDGateway` 调用；OpenD/Futu API 不响应时 CLI 没有内部超时，Agent Fabric 外层只拿到空 stderr 的 generic command failure。

Review status:
- passed

Risks / Notes / Handoff:
- 不先猜修；必须先复现和定位根因。

### Milestone 3：按 TDD 修复 `/hkipo`

Objective:
- 基于 Milestone 2 根因补最小回归测试，先确认红线失败，再做最小修复并验证绿线。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `/Users/ryan/projects/stock-analysis-api/src/services/futu_market_data_cli.py`
- `/Users/ryan/projects/stock-analysis-api/tests/test_futu_market_data_cli.py`
- `/Users/ryan/projects/stock-analysis-api/pyproject.toml`
- `/Users/ryan/projects/stock-analysis-api/README.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/futu-internal-cli-contract.md`
- `/Users/ryan/projects/stock-analysis-api/docs/plan.md`
- `/Users/ryan/projects/agent-fabric/src/agent/workflow/local-tasks.ts`
- `/Users/ryan/projects/agent-fabric/tests/unit/agent/workflow/local-tasks.test.ts`

Validation:
- 红线：新增 / 调整测试在修复前因目标 bug 失败。
- 绿线：相关测试通过。
- 根据影响范围补跑 `npm run typecheck:backend`、`npm run build:backend`、`./scripts/review.sh`、必要的 `/hkipo` workflow smoke 或 Feishu live smoke。

Status:
- done

Validation status:
- passed
- 红线：
  - `stock-analysis-api` 新增 hanging Futu gateway 测试后，修复前 `test_ipo_list_cli_times_out_hanging_opend_call` 按预期失败。
  - `stock-analysis-api` 新增 cleanup hanging gateway 测试后，修复前 `test_ipo_list_cli_bounds_cleanup_after_hanging_opend_call` 耗时约 1.06s，未能在内部 deadline 后快速返回，按预期失败。
  - `agent-fabric` 新增 `fetch_pool preserves failed stock api JSON errors` 后，修复前只得到 generic `Command failed`，按预期失败。
- 绿线：
  - `/Users/ryan/projects/stock-analysis-api`: `/Users/ryan/.local/bin/uv run python -m pytest tests/test_futu_market_data_cli.py -q`，15 passed。
  - 真实 CLI smoke：`FUTU_OPEND_CALL_TIMEOUT_SECONDS=2 /Users/ryan/.local/bin/uv run python scripts/futu_market_data.py global-state --json` 与 `ipo-list --market HK --json`，均约 2.3s 内输出 `{"status":"failed","source":"futu_opend","error":"Futu OpenD call timed out after 2s"}` 并以 code 1 退出，无残留 `futu_market_data.py` 进程。
  - `/Users/ryan/projects/stock-analysis-api`: `git diff --check` passed。
  - `/Users/ryan/projects/agent-fabric`: `npm test -- --run tests/unit/agent/workflow/local-tasks.test.ts`，9 passed。
  - `/Users/ryan/projects/agent-fabric`: `npm run typecheck:backend` passed；`npm run build:backend` passed。
  - `/Users/ryan/projects/agent-fabric`: workflow / Feishu in-process E2E 相关测试，5 files / 46 tests passed。
  - `/Users/ryan/projects/agent-fabric`: `FEISHU_LIVE_E2E=1 FEISHU_LIVE_CHAT_ID=<private oc_...> npm test -- --run tests/live/feishu/message-smoke.test.ts`，1 passed，真实发送并读回 `[e2e]` 消息。
  - `/Users/ryan/projects/agent-fabric`: `./scripts/review.sh` passed。
  - `/Users/ryan/projects/agent-fabric`: `./scripts/validate.sh --run tests/unit/agent/workflow/local-tasks.test.ts tests/integration/messaging/feishu/e2e.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts` passed，覆盖 targeted tests、`make typecheck` 和完整 `npm run build`。
- email cleanup 验证：
  - `/Users/ryan/projects/stock-analysis-api`: `git grep -n "627311610@qq.com" -- .` 无命中；`pyproject.toml` author email 已改为 `ryan.pro.1024@gmail.com`。
- stock repo 协议同步：
  - `/Users/ryan/projects/stock-analysis-api/docs/plan.md` 已按 `AGENTS.md` 更新当前目标、最近完成项、当前状态、下一步和风险，记录 Futu/OpenD timeout contract 与 package author email cleanup。

Review status:
- passed
- sub-agent scope / protocol review：发现 ACTIVE 状态滞后与 stock repo `docs/plan.md` 未同步两个 P1；已修复，`PLANS/ACTIVE.md` 回写验证与 handoff，`stock-analysis-api/docs/plan.md` 按仓库协议同步当前状态。
- sub-agent implementation review：发现 Futu/OpenD timeout 未覆盖 SDK cleanup 阶段 P1；已修复为周期性 deadline，新增 cleanup-hang 回归测试；复查未发现 blocking issue，reviewer 也重跑 `uv run python -m pytest tests/test_futu_market_data_cli.py -q`，15 passed。

Risks / Notes / Handoff:
- 若报错来自外部数据源或凭据不可用，修复应降级为稳定、可解释的用户可见错误，不编造 IPO 数据。
- Milestone 2 证据：`wfrun_4cfde923-f062-4455-b39a-e29b4468310c` 失败在 `ipo_pool_discovery`，命令 `/Users/ryan/.local/bin/uv run python scripts/futu_market_data.py ipo-list --market HK --json` 约 120s 后失败且 stderr 为空；本地复现 `ipo-list` 45s 无输出超时，`global-state` 15s 无输出超时。
- 根因假设：`stock-analysis-api` Futu/OpenD CLI 对 `FutuOpenDGateway` 调用没有内部超时，OpenD/Futu API 不响应时进程静默卡住；Agent Fabric 外层 `execFile` 超时后只能记录空 stderr 的 generic command failure。
- review 期间发现 `stock-analysis-api/pyproject.toml` 的 package author metadata 仍残留旧邮箱，纳入本轮 email cleanup。
- git email 远端 force-push 阻塞已同步到 `PLANS/ROADMAP.md` 的 `RM-2026-06-18-01`。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮单一真相源；变更 scope、目标或验证方式前先更新本文件。
- 一次只允许一个 milestone 处于 `in_progress`。
- `/hkipo` bugfix 必须按 TDD：先有能证明问题的失败测试，再改实现。
- 标记 milestone done 前必须同时满足 validation passed 与 review passed。

## Handoff

Current milestone:
- Milestone 3

Current status:
- done_with_remote_push_blocked

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `/Users/ryan/projects/agent-fabric/src/agent/workflow/local-tasks.ts`
- `/Users/ryan/projects/agent-fabric/tests/unit/agent/workflow/local-tasks.test.ts`
- `/Users/ryan/projects/stock-analysis-api/src/services/futu_market_data_cli.py`
- `/Users/ryan/projects/stock-analysis-api/tests/test_futu_market_data_cli.py`
- `/Users/ryan/projects/stock-analysis-api/README.md`
- `/Users/ryan/projects/stock-analysis-api/docs/specs/futu-internal-cli-contract.md`
- `/Users/ryan/projects/stock-analysis-api/docs/plan.md`
- `/Users/ryan/projects/stock-analysis-api/pyproject.toml`
- local git history rewritten in `agent-skills`、`balance-master`、`ryanpromax.github.io`、`stock-analysis-api`、`vscode-settings` (not a file diff)

Last failure summary:
- GitHub push blocked by local credential / SSH auth state: `failed to get: -25308` and SSH probe timeout.

Suspected cause:
- `/hkipo` 报错来自 Futu/OpenD 调用无内部 deadline，OpenD/Futu API 不响应时 CLI 静默挂起；git email 远端修复仍需要 GitHub 凭据恢复后 force-with-lease push。

Next step:
- 提交本轮代码/文档改动。GitHub 远端历史更新仍受本机 GitHub 凭据 / SSH 连接状态阻塞；凭据恢复后按 `PLANS/ROADMAP.md` 的 `RM-2026-06-18-01` force-with-lease 推送。
