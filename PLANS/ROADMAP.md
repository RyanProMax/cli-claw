# Iteration Roadmap

> 记录用户下发、需要跨轮次跟进的迭代任务。`PLANS/ACTIVE.md` 只负责当前轮正在执行的临时计划。

## Status

- `proposed`: 已记录，尚未进入某一轮 `ACTIVE.md`
- `in_progress`: 当前正在推进
- `verified`: 已实现并有验证证据
- `monitoring`: 已上线，继续观察真实使用

## Items

### RM-2026-04-24-01 Feishu Streaming Card Terminal State

- Status: `monitoring`
- Source: 2026-04-24 user request
- Summary: 任务完成但无最终可见文本时，飞书卡片也必须冻结到终态，不能停在 `Working on it`
- Evidence:
  - commit `bcfc5c9 Freeze Feishu cards on silent completion`
  - safe restart `restart-2026-04-24T05-27-34-063Z-3bdb642e.json`
- Next action:
  - 继续观察真实飞书使用

### RM-2026-04-24-02 Workspace Autopilot Quota Pause Thresholds

- Status: `verified`
- Source: 2026-04-24 user item `4`
- Summary: `5h < 20%` 暂停，`week < 10%` 也暂停
- Evidence:
  - `src/runtime-usage.ts`
  - `tests/workspace-autopilot.test.ts`
- Next action:
  - 无

### RM-2026-04-24-03 Footer Remaining Threshold Alignment

- Status: `verified`
- Source: 2026-04-24 user item `5`
- Summary: 飞书/通用 footer 仅在 `5h < 20%` 或 `week < 10%` 时展示 remaining
- Evidence:
  - `src/runtime-usage.ts`
  - `tests/assistant-meta-footer.test.ts`
- Next action:
  - 无

### RM-2026-04-24-04 Task Reply Milestone Progress Suffix

- Status: `verified`
- Source: 2026-04-24 user item `7`
- Summary: 任务类回复末尾追加 `ACTIVE.md` milestone 进度，完成项打 `✓`
- Evidence:
  - `src/active-plan-progress.ts`
  - `tests/active-plan-progress.test.ts`
- Next action:
  - 无

### RM-2026-04-24-05 Feishu Outbound Message Contract

- Status: `in_progress`
- Source: 2026-04-24 user item `1`
- Summary: 飞书对外消息必须严格区分用户可见回复与内部 commentary / tool steps，补足端到端契约测试
- Evidence:
  - real-world issue observed on 2026-04-24
  - `src/feishu-streaming-card.ts`
  - `tests/feishu-streaming-card.test.ts`
- Next action:
- 继续补足 interrupted/static-reply 路径的 contract coverage，确保内部进度内容不会通过其他出口再泄露到 Feishu

### RM-2026-04-24-06 Minimal Necessary Reply Policy

- Status: `proposed`
- Source: 2026-04-24 user item `6`
- Summary: 回复默认遵循“最小必要原则”，只输出影响决策的关键信息，不外泄过程性执行细节
- Evidence:
  - user feedback on verbose / process-heavy replies
- Next action:
  - 把最小必要回复规则固化到对外消息契约与测试
