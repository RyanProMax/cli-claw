# 当前任务：清理股票策略与 HKIPO 冗余工作区

## Goal

- 清理真实 DB 中已不再需要的股票策略工作区与 HKIPO 临时/测试工作区，避免 Web 工作区列表继续显示已退役或冗余入口。
- 保留主工作区、IM 入口和仍有实际用途的通用 `/workflow` / `/hkipo` 能力；只删除冗余 workspace 记录及其直接工作区状态。

## Done when

- `registered_groups` 中不存在 `web:stock-strategy`、`web:hkipo`、`web:hkipo-ack`、`web:hkipo-ack-*` 这些冗余 workspace。
- 这些 workspace 的 `chats`、`messages`、`threads`、`sessions`、`scheduled_tasks`、`task_run_logs`、`im_entry_routes` 直接状态已清理或确认不存在。
- 历史 `workflow_contexts` / `workflow_runs` / `workflow_run_steps` 若存在外键审计链，保留为历史审计，不作为可见 workspace 入口。
- 主工作区 `web:main`、飞书/微信入口和当前 `/hkipo` skill/workflow 代码入口不受影响。
- 真实 DB 查询、`./scripts/review.sh` 和必要验证通过；若代码或文档有改动，提交本轮改动。

## Milestones

### Milestone 1：盘点并清理真实 DB 冗余工作区

Objective:
- 基于真实 `~/.cli-claw/db/messages.db` 识别股票策略和 HKIPO 冗余 workspace，沿直接引用链清理 workspace 状态。

Allowed scope:
- `~/.cli-claw/db/messages.db`
- `PLANS/ACTIVE.md`

Validation:
- 查询 `registered_groups` 确认目标 JID 不存在。
- 查询 `threads` / `im_entry_routes` / `sessions` / `scheduled_tasks` / `task_run_logs` / `messages` / `chats` 确认目标 workspace 直接状态清空或不存在。
- 查询 `registered_groups` 确认 `web:main` 与 IM 入口仍存在。
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed：真实 DB 目标 workspace 的 `registered_groups` 为 0，直接状态计数为 0；服务安全重启后 `/api/health` 返回 healthy。

Review status:
- passed：`./scripts/review.sh` 通过；语义复核确认只清理冗余 workspace 直接状态，保留历史 workflow audit 链。

Risks / Notes / Handoff:
- 本轮清理 workspace 直接状态；历史 `workflow_contexts` / `workflow_runs` / `workflow_run_steps` 作为审计保留，除非确认它们只属于测试污染且不再需要。
- HKIPO 能力本身仍保留在 `.agents/workflows/hkipo.json` 和 stock-analysis skill 中；只清理冗余 Web workspace。
- 清理前已备份真实 DB：`~/.cli-claw/db/messages.db.backup-workspace-cleanup-20260527T150020Z`。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮执行单一真相源。
- 一次只推进一个 milestone。
- 目标、scope、验证方式或涉及文件变化时先更新本文件。
- 删除真实 DB 状态前先做只读盘点，确保不误删主工作区或 IM 入口。

## Handoff

Current milestone:
- complete

Current status:
- done

Changed files:
- `PLANS/ACTIVE.md`

Last failure summary:
- 初次尝试删除 `workflow_contexts` 时被 `workflow_runs.context_id` 外键挡住；后续保留 workflow audit 链，只清理 workspace 直接状态。

Suspected cause:
- 历史 workflow run 审计依赖 workflow context，不能在保留审计的同时删除 context。

Next step:
- 提交本轮清理记录。
