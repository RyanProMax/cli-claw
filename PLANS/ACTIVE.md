# 当前任务：优化 /kol 分隔符、来源提醒和飞书来源 footer

## Goal

- `/kol` 报告在结论和每个主题之间使用 `---` 分隔，提高飞书长消息可读性。
- `/kol` 默认不输出“账号与来源可信度”；只有来源存疑、不可访问或低置信时才输出提醒。
- 静态回复 footer 移除冗余入口名，例如不再显示 `| 飞书 |`。
- 查清飞书私聊为什么展示为“飞书群聊（主线）”，并修复私聊/群聊来源标签。

## Done when

- 根因定位清楚：报告格式来源、footer 入口标签来源、Feishu 私聊误判来源。
- 修复完成并有测试覆盖。
- 验证和 review gate 通过；提交后安全重启服务。

## Milestones

### Milestone 1：根因定位

Objective:
- 定位 `/kol` 报告结构由哪些模板/角色提示控制。
- 定位 footer 文案与“飞书群聊（主线）”的生成路径。
- 对照 DB/代码确认私聊误判是输入元数据、chat type 归类还是纯展示映射问题。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `src/`、`.agents/`、`docs/`、`tests/`
- 只读查询本地消息/路由数据库和日志

Validation:
- 记录涉及文件、函数和根因结论。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 用户明确希望只在来源存疑时输出置信提醒；不能把所有报告都附加“账号与来源可信度”。
- `/kol` 固定“账号与来源可信度”来自 `.agents/agent-roles/kol-intel-reporter.md` 和 `buildKolPrepareContextArtifact()` 的 `output_template`；workflow node prompt 也没有明确禁止固定置信段落。
- footer 的 `| 飞书 |` 来自 `formatRouteStatus()` 的 `channelLabel` 字段；前半段已经能表达入口/位置，channelLabel 在 IM footer 中重复。
- “飞书群聊（主线）”来自 IM source registered group 的 name；当前 DB 中 `feishu:oc_98f0bb60f284627bf20f9386704f8c82` 被注册为 `飞书群聊`。
- 最新 `/kol` 消息 lifecycle 显示 `source=backfill` 且 `chatType=group`；根因是 Feishu backfill message list 缺 `chat_type` 时旧代码默认填 `group`，导致私聊被注册/刷新成群聊。

### Milestone 2：实现与测试

Objective:
- 调整 `/kol` 模板、角色提示和必要的归一化逻辑，使主题之间有 `---` 分隔，来源可信度只在异常时输出。
- 调整 footer 文案，去掉重复入口名。
- 修复 Feishu 私聊/群聊标签误判。

Allowed scope:
- `.agents/agent-roles/`
- `.agents/workflows/`
- `src/agent/workflow/`
- `src/presentation/` / `src/index.ts` / 相关 IM 路由模块
- `tests/`
- 必要时更新 `docs/COMMAND.md`

Validation:
- 新增或更新定向测试覆盖 KOL 模板和 footer/私聊标签。
- 相关测试通过。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 不改变 Feishu 路由语义，只修显示文案与错误归类。
- `/kol` role card、workflow prompt 和 local task template 已改为 `---` 分隔；固定账号/来源置信段落已改为仅异常时的“来源提醒”。
- `kol` workflow delivery 增加轻量归一化：补齐缺失的 `---`，并移除无异常的旧“账号与来源可信度”段落。
- route footer 不再拼接 channelLabel。
- Feishu backfill 缺 `chat_type` 时会调用 `chat.get` 读取 `chat_mode/chat_type`，再决定 `飞书私聊` / `飞书群聊`。

### Milestone 3：验证、review、提交与服务应用

Objective:
- 运行定向验证、typecheck、review gate，提交并安全重启服务。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`（仅跨轮次事项）
- 本轮已修改文件

Validation:
- 定向测试
- `npm run typecheck:backend`
- `git diff --check`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 若 Feishu SDK 对私聊字段缺失，只能基于 chat_id/open_id/route 元数据做最稳妥展示兜底。
- 验证通过：
  - `npm test -- tests/unit/agent/workflow/local-tasks.test.ts tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/command.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/messaging/context-router.test.ts tests/integration/messaging/feishu/connection.test.ts tests/unit/messaging/channel.test.ts tests/unit/presentation/assistant-meta-footer.test.ts`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/review.sh`
- 已按 `RUNBOOKS/Review.md` 做语义 review：scope 与 milestone 一致，未发现 debug/TODO；KOL 来源提醒保留了异常来源，正常 confirmed 段会被移除；footer 仅去掉重复 channelLabel，不改变路由位置。
- 测试过程中 `tests/unit/agent/workflow/command.test.ts` 触发 Vitest/Node `MaxListenersExceededWarning`，但测试通过；该 warning 来自多次动态 import/load 的既有测试行为，本轮未扩大 runtime listener 逻辑。
- 已提交实现：`Refine KOL report and Feishu footers`。
- 已修正当前误标的本地会话记录：`feishu:oc_98f0bb60f284627bf20f9386704f8c82` 从 `飞书群聊` 改为 `飞书私聊`。
- 已按安全路径重启服务：restart intent `restart-2026-05-31T14-50-39-922Z-3c7f7b53.json`，状态 `passed`；新进程 PID `95459`。
- 重启后健康检查通过：`GET /api/health` 返回 `healthy`，database 与 queue 均为 `true`。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 验证失败和 review 失败都留在当前 milestone 修复，不能跳过。
- 只有 `Validation status: passed` 且 `Review status: passed` 后，milestone 才能标记为 `done`。

## Handoff

Current milestone:
- Milestone 3 done

Current status:
- complete; validation, review, commit, DB correction and safe restart all done

Changed files:
- `PLANS/ACTIVE.md`
- `.agents/agent-roles/kol-intel-reporter.md`
- `.agents/workflows/kol.json`
- `src/agent/workflow/local-tasks.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/engine.ts`
- `src/messaging/context-router.ts`
- `src/messaging/providers/feishu/index.ts`
- `tests/unit/agent/workflow/local-tasks.test.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/messaging/context-router.test.ts`
- `tests/integration/messaging/feishu/connection.test.ts`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`

Findings:
- 根因见 Milestone 1 notes。

Next step:
- 无。若后续再次出现私聊/群聊标签异常，优先检查 Feishu `message.list` 是否仍缺少 `chat_type` 以及 `chat.get` 返回的 `chat_mode/chat_type`。
