# 当前任务：修复 /kol X/Twitter 抓取失败

## Goal

- 查明 `/kol` 报告中 `x_preflight.status = error` 且 twscrape 报错 `No account available for queue UserTweets` 的真实原因。
- 恢复或改进 `/kol` 对白名单 KOL 原文抓取的可用性；如果根因是账号池限流/锁定等运行态问题，必须输出可执行的诊断与恢复路径，而不是只给泛化错误。
- 保持 `/kol` 证据边界：没有可验证 X 原文时不把低置信内容合成股票热点结论。

## Done when

- 已明确失败发生在配置、账号池、队列限流、依赖行为或代码调用中的哪一层。
- `/kol` 预检失败时能给出更清晰的队列/账号池原因；可自动恢复的场景已由代码处理。
- 相关测试或健康检查覆盖本轮修复点。
- 直接相关验证、review gate 通过；若影响正在运行的 Cli Claw 服务，按安全重启路径应用变更。

## Milestones

### Milestone 1：定位 twscrape 抓取失败根因

Objective:
- 检查 `/kol` workflow 最近运行记录、`stock-kol-intel` twscrape provider、账号库 schema 与 `UserTweets` 队列状态，确定为什么两个白名单账号都无法抓取。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `~/.cli-claw/state/stock-kol-intel/twscrape/accounts.db`
- 只读检查 `/Users/ryan/projects/stock-kol-intel/**`
- 只读检查 `/Users/ryan/projects/cli-claw/src/agent/workflow/**`

Validation:
- 能用本地命令复现或解释 `No account available for queue UserTweets`，且不泄露 cookie/token/password。

Status:
- done

Validation status:
- passed：已确认账号库只有 1 个 active 账号 `ryan_probe`；失败窗口内 `UserTweets` 队列被锁到 `2026-05-31T08:42:31Z`，导致两个白名单 KOL 的时间线请求都无法拿到账号。当前锁已过期，健康检查显示 `UserByScreenName`、`UserTweets`、`SearchTimeline` 均可用。

Review status:
- passed：只读取非敏感字段 `username`、`active`、`locks`、`stats`、`last_used`、`error_msg`；没有输出 cookie/password/token。

Risks / Notes / Handoff:
- 账号池数据库可能包含敏感认证字段；诊断输出只允许展示账号名、active 状态、队列名、lock/reset 时间等非 secret 字段。

### Milestone 2：实现可用性修复与诊断增强

Objective:
- 根据 Milestone 1 结论，做最小修复：优先恢复抓取可用性；若需要人工刷新/新增 X 账号，则把失败原因、可用账号、队列冷却时间和恢复命令做成明确诊断。

Allowed scope:
- `PLANS/ACTIVE.md`
- `/Users/ryan/projects/stock-kol-intel/commands/kol.py`
- `/Users/ryan/projects/stock-kol-intel/scripts/twscrape_healthcheck.py`
- `/Users/ryan/projects/stock-kol-intel/tests/**`
- `/Users/ryan/projects/stock-kol-intel/references/twscrape_provider.md`
- 如需调整 Cli Claw artifact 展示，可扩展到 `src/agent/workflow/local-tasks.ts` 和对应测试，但必须先记录原因。

Validation:
- `python3 -m unittest tests/test_kol_command.py`
- 直接运行 twscrape 健康检查，确认能解释当前 `UserTweets` 可用性状态。
- 如修改 Cli Claw：运行相关 `npm test` 定向测试。

Status:
- done

Validation status:
- passed：新增队列快照和 `SearchTimeline` fallback 单测，`python3 -m unittest tests/test_kol_command.py` 通过 8/8；真实 `build_x_source_preflight(30)` 返回 `status=ok`，`dexteryy` 与 `aleabitoreddit` 均通过 `user_tweets` 抓取成功。

Review status:
- passed：修复保持在 `stock-kol-intel` 抓取/诊断边界内；不改变报告证据规则，不使用镜像或二手来源冒充主证据。

Risks / Notes / Handoff:
- 如果所有 X 账号都处于队列限流或账号失效，代码不能绕过 X/Twitter 访问限制；本轮只能提供清晰诊断和恢复操作，不能伪造主证据。

### Milestone 3：验证、review、提交与服务应用

Objective:
- 跑完直接相关验证和 review gate；提交 Cli Claw 仓库内变更；说明 sibling `stock-kol-intel` 若不是 git repo 的未提交状态；必要时安全重启服务。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`（仅跨轮次事项）
- 本轮已修改文件

Validation:
- Milestone 2 验证命令全部通过。
- `./scripts/review.sh` 或等价 review 通过。
- `git diff --check`

Status:
- done

Validation status:
- passed：`python3 -m unittest tests/test_kol_command.py` 通过 8/8；`python3 -m py_compile commands/kol.py scripts/twscrape_healthcheck.py` 通过；`scripts/twscrape_healthcheck.py` 显示 1 个 active 账号且 `UserByScreenName` / `UserTweets` / `SearchTimeline` 均可用；真实 `build_x_source_preflight(30)` 返回两位白名单 KOL 均抓取成功；`git diff --check` 通过。

Review status:
- passed：`./scripts/review.sh` 通过格式与 diff hygiene；已按 `RUNBOOKS/Review.md` 做语义审查，确认修复只增强 twscrape 队列诊断和 `SearchTimeline` fallback，不削弱 `/kol` 证据边界。

Risks / Notes / Handoff:
- `/Users/ryan/projects/stock-kol-intel` 不是 git repo，若修改该目录需在最终说明中明确无法通过当前仓库 commit 记录。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 验证失败和 review 失败都留在当前 milestone 修复，不能跳过。
- 只有 `Validation status: passed` 且 `Review status: passed` 后，milestone 才能标记为 `done`。

## Handoff

Current milestone:
- Milestone 3

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`
- `/Users/ryan/projects/stock-kol-intel/commands/kol.py`
- `/Users/ryan/projects/stock-kol-intel/scripts/twscrape_healthcheck.py`
- `/Users/ryan/projects/stock-kol-intel/tests/test_kol_command.py`
- `/Users/ryan/projects/stock-kol-intel/references/twscrape_provider.md`

Last failure summary:
- 用户截图中的 `/kol` 报告显示两位白名单 KOL 的 X/Twitter 预检均失败，错误为 `No account available for queue UserTweets`。

Suspected cause:
- 已确认：账号池只有一个 active cookie 账号，`UserTweets` 队列在失败时间段被 twscrape 锁定；旧健康检查只显示 active 账号数，未暴露队列锁，所以表面看像“抓取失败”而不是“队列冷却中”。

Next step:
- 本轮修复完成；Cli Claw 仓库内只改了 `PLANS/ACTIVE.md`，`stock-kol-intel` 不是 git repo，最终说明需明确该目录为直接文件变更。
