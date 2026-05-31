# 当前任务：排查并修复 /kol 角色节点 UND_ERR_SOCKET 失败

## Goal

- 查清本次 `/kol` 已启动后失败的具体节点与原因。
- 避免 OpenAI/Codex 临时 socket 断开把 `UND_ERR_SOCKET` 原始对象直接发给用户。
- 若本地 KOL context 已成功生成，角色节点临时失败时应有可读降级结果或有界重试，而不是整条 workflow 只返回底层网络错误。

## Done when

- 有 `workflow_runs`、`workflow_run_steps` 和日志证据说明失败发生在哪个节点。
- 本仓库可控修复完成，并覆盖测试。
- 验证和 review gate 通过；提交后安全重启服务。

## Milestones

### Milestone 1：根因定位

Objective:
- 定位最新 `/kol` 失败 run 的节点、输入 artifact 状态、错误来源和用户可见 raw error 的格式化路径。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读查询 `~/.cli-claw/db/messages.db` 和服务日志
- 只读检查 `src/agent/workflow/`、`src/presentation/`、相关测试

Validation:
- 给出 run id、失败节点、上游 local task 是否成功、错误来源和现有失败消息路径。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 已确认失败 run 为 `wfrun_ac94cf1b-29c0-42b8-8aeb-5d98102142ce`。
- `kol_context_preflight` 成功，`kol_context` artifact 的 `status=ok`、`x_preflight.status=ok`，窗口为最近 30 天，覆盖 KOL 为 Dexter Yang（@dexteryy）与 Serenity（@aleabitoreddit）。
- `kol_report_editor` role node 在 runner 中因 `UND_ERR_SOCKET` 失败；日志显示远端为本机代理 `127.0.0.1:7897`，错误为 `TypeError: terminated` / `SocketError: other side closed`，属于 OpenAI/Codex role runtime 网络瞬断，不是 X 抓取失败。
- 失败消息路径为 `runWorkflowGraph` 抛出原始 error 后由 `formatWorkflowFailure()` 拼接成飞书终态消息，因此底层 undici 对象被直接展示给用户。

### Milestone 2：修复 transient role failure 的用户体验

Objective:
- 为 `/kol` 或通用 workflow role transient socket 失败增加有界重试/可读降级，至少保证 raw `UND_ERR_SOCKET` 不进入用户正文。

Allowed scope:
- `PLANS/ACTIVE.md`
- `src/agent/workflow/`
- `src/presentation/`（仅错误摘要必要时）
- `tests/`
- 必要时更新 `docs/COMMAND.md`

Validation:
- 新增/更新定向测试覆盖 `/kol` role 节点 transient failure。
- 相关测试通过。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 不应掩盖真实业务数据缺失；只有 runner/socket transient 才降级或重试，KOL context 本身失败仍应如实报错。
- 已收紧 runtime timeout 判定，避免 `timeout: undefined` 误判为真实超时而跳过 socket 重试。
- 已为 `kol_report_editor` 增加 transient socket 降级报告；当 `kol_context` 已存在但最终报告角色失败时，输出白名单、来源状态和保守核验方向，不再裸露 undici 对象。
- `formatWorkflowFailure()` 对 socket/服务繁忙类 runtime 错误做摘要化；真实 `Agent Process timed out after ...` 保留原文。

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
- 若最终证明失败完全来自外部 OpenAI 临时网络，仍需修掉 raw error 泄露，避免用户看到底层对象。
- 验证通过：
  - `npm test -- tests/unit/agent/workflow/engine.test.ts tests/unit/agent/workflow/command.test.ts`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/review.sh`
- 已按 `RUNBOOKS/Review.md` 做语义 review：scope 与 milestone 一致，无 debug/TODO，无额外协议重复；`docs/COMMAND.md` 已同步 `/kol` transient socket 重试与降级行为。
- 已提交 `cf6f7b2 Handle KOL workflow socket failures`。
- 已通过 `bun src/cli.ts restart` 走安全 watchdog 重启；restart intent `restart-2026-05-31T14-16-43-056Z-49ad3189.json` 状态为 `passed`。
- 新 backend PID 为 `88726`，`http://127.0.0.1:3000/api/health` 返回 `healthy`。

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
- complete

Changed files:
- `PLANS/ACTIVE.md`
- `src/agent/workflow/engine.ts`
- `src/agent/workflow/command.ts`
- `tests/unit/agent/workflow/engine.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `docs/COMMAND.md`

Last failure summary:
- 用户发送 `/kol` 后先收到启动回执，随后收到 `Agent process exited with code 1` 和 undici `UND_ERR_SOCKET` 原始错误片段。

Suspected cause:
- 已确认：`kol_report_editor` 的 OpenAI role runtime 经本机代理连接中断；上游 KOL context 已成功生成。

Next step:
- 无。修复已提交并应用到正在运行的服务。
