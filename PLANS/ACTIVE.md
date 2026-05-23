# 当前任务：移除多余管理面并精简项目

> **给 agentic workers：** 本轮只删除用户已确认的 1/2/3/4/6：Web Agent 定义管理、全局用户 MCP 管理/host sync、Billing 商业化层、旧脚本型任务遗留、Bug Report 自动提交流程。明确保留 5/7/8：非 Feishu IM Provider、PWA、消息分享图片。一次只推进一个 milestone；validation 和 review 均通过后才可提交。

## 背景

用户希望在移除 Web 用户 Skill 管理后继续精简 Cli Claw。经评估，当前仍有几类和主线不一致或维护成本大于价值的能力：Web 管理宿主 `~/.agents/agents` 的 Agent 定义、全局用户 MCP 管理与 host sync、禁用状态的 Billing / 套餐 / 余额 / 兑换码层、旧脚本型股票/维护 heartbeat 任务遗留、Bug Report 自动生成和 GitHub Issue 提交流程。用户确认这些都可以删除；非 Feishu IM、PWA 和分享图片暂时保留。

## 目标

- 删除 Web Agent 定义管理入口、页面、store、API 与文档口径，不再管理宿主 `~/.agents/agents`。
- 删除全局用户 MCP 管理与 host sync，只保留 workspace 级 `.agents/mcp/settings.json` 管理；清理 deprecated `mcp_mode` / `selected_mcps` 代码路径。
- 删除 Billing 商业化层：Web 账单页、billing API/store/components/settings、后端额度/套餐/余额/兑换码/订阅检查与相关系统消息。
- 删除旧脚本型任务遗留：`maintenance-loop-heartbeat`、`stock-watch-feishu-20260427-0208`、已废弃 stock loop progress notifier 的脚本、测试、展示和本机 scheduled task 记录。
- 删除 Bug Report 自动生成/提交能力：Web dialog、API route、schemas、依赖调用与入口。
- 更新 owner docs、计划和 roadmap；完成验证、review、提交与安全重启。

## 非目标

- 不删除 Telegram / QQ / WeChat / DingTalk 等非 Feishu IM Provider。
- 不删除 PWA / service worker / manifest / icons。
- 不删除消息分享为图片能力和 `html-to-image`。
- 不删除 workspace 级 MCP 面板与 `.agents/mcp/settings.json` 管理。
- 不删除 workflow、scheduled workflow、自动化看板、OpenAI usage guard、Feishu 可靠性链路、自检/自重启。
- 不删除 `stock-handoff-agent-bridge.mjs`，该能力仍由 roadmap 跟踪。

## Milestones

### Milestone 1：引用盘点与边界确认

Objective:

- 全量搜索待删除能力的 Web/API/后端/测试/文档引用，确认保留边界。
- 记录本机旧 scheduled task 状态，删除前保留有价值进展摘要。

Allowed scope:

- 只读搜索源码、测试、文档、本机 SQLite 与配置
- `PLANS/ACTIVE.md`

Validation:

- 已列出删除范围和保留范围。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 已确认用户要求保留非 Feishu IM、PWA、分享图片。
- 删除前确认本机旧 scheduled task：`maintenance-loop-heartbeat` 最后运行 `2026-05-23T02:54:06.274Z`，`stock-watch-feishu-20260427-0208` 最后运行 `2026-05-20T15:23:59.626Z`；历史 run logs 保留用于审计。

### Milestone 2：删除 Web/API 管理面

Objective:

- 删除 Agent 定义管理、全局用户 MCP 管理、Billing、Bug Report 的 Web 页面、store、组件、API route 和挂载入口。
- 保留 Settings 中的账户、IM、会话、workspace MCP、用量/监控等仍有价值入口。

Allowed scope:

- `web/src/**`
- `src/web/**`
- `src/core/schemas.ts`
- `package.json` / `web/package.json` 如删除依赖需要
- 相关测试

Validation:

- 前后端 typecheck 能捕捉残留 import。
- 残留关键词搜索不再出现被删除入口。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- Billing 删除会影响 quotas / plan / subscription / redeem code 等所有商业化 API；这是本轮确认的破坏性删除。
- 已删除 Web/API 入口和主动引用；workspace 级 `.agents/mcp/settings.json` 管理仍保留。

### Milestone 3：删除后端业务逻辑和旧任务遗留

Objective:

- 删除 Billing 后端检查、DB facade 暴露、系统设置字段、quota 系统消息与定时过期检查。
- 删除 deprecated MCP group 字段代码路径。
- 删除旧脚本文件、测试、展示逻辑，并清理本机 scheduled task 记录。

Allowed scope:

- `src/core/**`
- `src/storage/**`
- `src/agent/**`
- `src/index.ts`
- `src/presentation/**`
- `scripts/**`
- `tests/**`
- 本机 `~/.cli-claw/db/messages.db` 中确认删除的旧 scheduled task 行

Validation:

- 相关单测/集成测试通过。
- 本机 scheduled task 不再包含旧 heartbeat / stock-watch 任务。

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- 只删除旧任务记录，不删除历史 `task_run_logs`，避免审计证据丢失。
- 已从本机 `scheduled_tasks` 删除 `maintenance-loop-heartbeat` 和 `stock-watch-feishu-20260427-0208`；`task_run_logs` 中分别保留 2244 / 3394 条历史记录。

### Milestone 4：文档同步、全量验证、提交与重启

Objective:

- 更新 `AGENTS.md` / `docs/*` / `PLANS/ROADMAP.md`，确保 owner 文档不再宣称已删除能力。
- 完成 validation / review gate，提交变更并安全重启。

Allowed scope:

- `AGENTS.md`
- `docs/**`
- `PLANS/ROADMAP.md`
- `PLANS/ACTIVE.md`
- 本轮已触及源码、测试和脚本

Validation:

- `git diff --check`
- `npm run typecheck`
- `npm --prefix web run build`
- `npm --prefix container/agent-runner run build:runner`
- `./scripts/review.sh`
- `./scripts/validate.sh`

Status:

- done

Validation status:

- passed

Review status:

- passed

Risks / Notes / Handoff:

- `./scripts/review.sh` 已通过；初次 review 曾因 `src/index.ts` Prettier 格式失败，已格式化后重跑通过。
- `./scripts/validate.sh` 已通过：全量测试 526 passed / 1 skipped，typecheck、backend build、web build、agent-runner build 均通过；Vite 仍有既有 chunk size warning。
- 人工 review 已按 `RUNBOOKS/Review.md` 完成：scope 与目标一致，未发现阻塞问题；`billing` / `bug-report` / `agent-definitions` / 用户级 `mcp-servers` / `loop-status` 主动引用已清空，仅保留 workspace MCP 配置入口和 SQLite legacy cleanup 字段。

## Handoff

Current milestone:

- Milestone 4

Current status:

- done

Changed files:

- 删除 Web Agent 定义管理、全局用户 MCP 管理、Billing、Bug Report、旧脚本型任务遗留的前后端、测试与文档引用；详见本轮 git diff。

Last failure summary:

- 初次 `./scripts/review.sh` 因 `src/index.ts` 格式检查失败。

Suspected cause:

- 大块删除后 import/空行格式未完全符合 Prettier。

Next step:

- 无；本轮完成后等待下一轮需求。
