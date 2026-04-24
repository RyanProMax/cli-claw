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
  - `shared/stream-presentation.ts`
  - `src/feishu-streaming-card.ts`
  - `src/index.ts`
  - `tests/stream-presentation.test.ts`
  - `tests/chat-streaming-store.test.ts`
  - `tests/feishu-streaming-card.test.ts`
  - 2026-04-24 card-layering fix: Feishu streaming body uses cumulative stream text, terminal cards sync commentary into a dedicated panel, and Codex process-prefix leakage before Markdown report headings is stripped from final body
- Next action:
  - 继续补足 interrupted/static-reply/发送失败路径的 contract coverage，确保内部进度内容不会通过其他出口再泄露到 Feishu，且 Feishu API 失败不会被当作已送达回复提交游标

### RM-2026-04-24-06 Minimal Necessary Reply Policy

- Status: `proposed`
- Source: 2026-04-24 user item `6`
- Summary: 回复默认遵循“最小必要原则”，只输出影响决策的关键信息，不外泄过程性执行细节
- Evidence:
  - user feedback on verbose / process-heavy replies
- Next action:
  - 把最小必要回复规则固化到对外消息契约与测试

### RM-2026-04-24-07 Safe Restart Reply Recovery

- Status: `monitoring`
- Source: 2026-04-24 user request
- Summary: 共享 runner 异常退出或安全重启后，IM 消息不能只留下 interrupted partial，必须从真实来源 chat 继续补发后续回复
- Evidence:
  - `src/group-queue.ts`
  - `src/index.ts`
  - `tests/group-queue.test.ts`
  - `tests/restart-recovery.test.ts`
  - `npm test -- tests/group-queue.test.ts tests/restart-recovery.test.ts`
  - `npm run typecheck`
  - `src/feishu.ts`
  - `tests/feishu-connection.test.ts`
  - startup connect now backfills known Feishu chats once after WS readiness
  - 2026-04-24 afternoon RCA: `web:main` autopilot relaunched before a Feishu source whose `last_agent_timestamp` had advanced but `last_committed_cursor` had not; added DB-pending IM sibling priority before web/autopilot work
- Next action:
  - 继续观察真实 IM 流量；若仍有“飞书消息不回”，下一步优先区分 queue/cursor starvation 与 Feishu outbound delivery failure

### RM-2026-04-24-08 Codex Model Picker Real CLI Discovery

- Status: `verified`
- Source: 2026-04-24 user request (`/model` 未显示 GPT-5.5)
- Summary: `/model` 需要尽量对齐当前 Codex CLI 的真实模型列表，而不是仅依赖本地 cache/preset 回退
- Evidence:
  - `src/runtime-model-options.ts` 当前优先读取 `~/.codex/models_cache.json`，缓存缺失时回退 preset
  - real-world report: `/model` missing GPT-5.5
  - 2026-04-24 Feishu recovery runner inherited `~/.codex/config.toml` `model = "gpt-5.5"` while `~/.codex/models_cache.json` no longer listed it, causing `codex-acp` to fail with `The model gpt-5.5 does not exist or you do not have access to it`
  - 2026-04-24 live catalog fix: backend `/model` now queries `codex debug models` before cache/preset fallback, and picker options include the current effective Codex model when it differs from the live catalog
  - safe restart `restart-2026-04-24T14-01-56-608Z-14ce081a`
- Next action:
  - 评估是否在 workspace 未显式配置模型时校验 inherited Codex model 是否仍在可用列表内；若不可用，提示/降级到安全默认模型，并补契约测试

### RM-2026-04-24-09 Workspace Autopilot Background Contract

- Status: `verified`
- Source: 2026-04-24 user request
- Summary: 主动模式不能每 5 分钟把固定 prompt 当普通消息塞进主对话；应改为低优先级后台 run，真实用户/飞书消息优先，no-op 不污染对话历史
- Evidence:
  - current implementation: `src/task-scheduler.ts` group-context task stores the autopilot prompt as a regular source workspace message
  - current live task: `autopilot:workspace:main` interval `300000`
  - implemented: autopilot uses low-priority background queue task, does not call `storePromptMessage`, skips busy/pending IM work, and suppresses no-op visible replies
  - tests: `tests/group-queue.test.ts`, `tests/task-scheduler-host-cwd.test.ts`, `tests/workspace-autopilot.test.ts`
  - validation: `npm test -- --run tests/workspace-autopilot.test.ts tests/group-queue.test.ts tests/task-scheduler-host-cwd.test.ts`, `npm run typecheck`, `git diff --check`, `./scripts/review.sh`
  - safe restart `restart-2026-04-24T14-41-19-260Z-c027f9a3`
  - post-restart monitoring: task run log `143` started at `2026-04-24T14:45:21.375Z`; `messages` had no rows after backend restart `2026-04-24T14:41:20.738Z`, and all persisted `[WORKSPACE_AUTOPILOT]` prompt rows predated the restart
- Next action:
  - 无；若后续真实使用仍出现 no-op 高频消耗 Codex，再加连续 no-op 指数退避
