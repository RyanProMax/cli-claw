# 当前任务：为 /kol 长周期查询增加内存缓存

## Goal

- 为 `/kol` 这类长窗口 KOL X/Twitter 预检增加进程内缓存，避免短时间内重复抓取同一组白名单与同一长窗口，降低 `UserTweets` 队列被锁概率。
- 短周期查询保持实时抓取，不走缓存。
- 缓存只放在 Cli Claw 常驻进程内存中，不落库；必须有 TTL、容量上限和清理机制，避免内存泄露。

## Done when

- `stock.kol.prepare_context` 对长窗口查询复用内存缓存，短窗口不复用。
- 缓存 key 能区分窗口天数、白名单内容和 source root，避免不同配置串用。
- 过期缓存和超容量缓存会被清理。
- 相关单测、格式/review gate 通过；影响运行中的 Cli Claw 服务时走安全重启路径应用。

## Milestones

### Milestone 1：红灯测试锁定缓存边界

Objective:
- 为长窗口缓存命中、短窗口不缓存、TTL/容量清理建立失败优先测试。

Allowed scope:
- `PLANS/ACTIVE.md`
- `tests/unit/agent/workflow/local-tasks.test.ts`
- 只读检查 `src/agent/workflow/local-tasks.ts`

Validation:
- 新增定向测试在旧实现上失败，失败原因证明 `stock.kol.prepare_context` 尚未复用长窗口内存缓存。

Status:
- done

Validation status:
- passed：新增长窗口缓存红灯测试，旧实现第二次仍执行 Python 抓取脚本，计数从 1 变 2；短窗口测试确认 `days=7` 不应走缓存。

Review status:
- passed：测试聚焦 `stock.kol.prepare_context` 行为边界，不触碰生产实现以外模块。

Risks / Notes / Handoff:
- Python `stock-kol-intel` 脚本是每次 local task 都新起进程，缓存必须放在 Cli Claw Node 进程内；放 Python 全局变量不能跨 `/kol` 运行生效。

### Milestone 2：实现长窗口内存缓存与清理

Objective:
- 在 `stock.kol.prepare_context` local task 层实现长窗口内存缓存，带 TTL、最大条数和清理；短窗口不缓存。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/agent/workflow/local-tasks.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`

Validation:
- `npm test -- tests/unit/agent/workflow/local-tasks.test.ts`

Status:
- done

Validation status:
- passed：实现 `days >= 30` 内存缓存，默认 TTL 6 小时、最多 16 条；缓存 key 包含 source root、窗口天数、白名单 hash、`kol.py` hash 和 twscrape/proxy 环境；补充 TTL 过期测试；`npm test -- tests/unit/agent/workflow/local-tasks.test.ts` 通过 7/7。

Review status:
- passed：缓存只放在 Node 常驻进程内，不落库；短窗口返回 `cache.status=disabled`；每次访问都会清理过期项，并在超容量时淘汰最久未访问项。

Risks / Notes / Handoff:
- 默认将 `days >= 30` 视为长窗口；`/kol --days=7` 等短窗口仍实时抓取。
- 缓存 TTL 和容量上限应为保守默认，避免日报重复查询打爆 X 队列，同时不长期保留旧 artifact。

### Milestone 3：验证、review、提交与服务应用

Objective:
- 运行定向验证和 review gate，提交 Cli Claw 仓库变更，并按安全路径重启服务以应用常驻进程内存缓存。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`（仅跨轮次事项）
- 本轮已修改文件

Validation:
- `npm test -- tests/unit/agent/workflow/local-tasks.test.ts`
- `./scripts/review.sh`
- `git diff --check`

Status:
- done

Validation status:
- passed：`npm test -- tests/unit/agent/workflow/local-tasks.test.ts` 通过 7/7；`npm run typecheck:backend` 通过；`git diff --check` 通过；`./scripts/review.sh` 通过格式与 diff hygiene。

Review status:
- passed：已按 `RUNBOOKS/Review.md` 做语义审查，确认缓存 key 隔离窗口、白名单、source root、`kol.py` 和 twscrape/proxy 环境；缓存只在进程内，TTL 清理和超容量 LRU 淘汰均在每次访问时执行；短窗口不缓存。

Risks / Notes / Handoff:
- 这是运行时行为变更，提交后需要重启 Cli Claw 服务才能让常驻进程加载新缓存逻辑。

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
- `src/agent/workflow/local-tasks.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`

Last failure summary:
- 最近 `/kol` 连续两次 7 KOL / 30 天窗口抓取共重复返回约 350 条 X 帖子，第三次 2 KOL 查询时唯一账号 `UserTweets` 队列进入冷却。

Suspected cause:
- 长窗口查询没有任何缓存，且 workflow local task 每次都会新起 Python 进程重新抓取；单账号池承受重复 30 天全量请求。

Next step:
- 本轮实现完成；提交后按安全路径重启服务，让常驻进程加载长窗口内存缓存。
