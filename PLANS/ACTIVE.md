# 当前任务：Workflow/Crew Graph Engine

> **给 agentic workers：** 必须使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`，并保留 validation / review gate。计划统一写在 `PLANS/`；不要在 `docs/superpowers` 下新增计划。

## 目标

- 引入 LangGraph.js 作为工作流/crew 图编排引擎，不手写 Native Graph。
- 用户会话只负责触发 workflow run、展示进度并接收最终结果；workflow 拥有独立上下文、独立 runtime session 和内部生成的 `thread_id`。
- 支持仓库级 workflow 配置 `.agents/workflows/<id>.json` 与 runtime 角色卡 `.agents/agent-roles/<id>.md`。
- 把 workflow/role metadata 显式注入现有 OpenAI runner，并在 runner tool factory 层做 `allowedTools` 硬过滤。
- 增加 `/workflow` 应用内命令、后端 API、运行审计表和 owner docs。

## 完成标准

- `@langchain/langgraph` 和 SQLite checkpoint 依赖以固定版本接入，LangGraph 只承担 state/routing/parallel/checkpoint，不替代现有 OpenAI runner。
- workflow context 默认按 `(workspace folder, workflowId)` 生成内部 `workflowContextId/thread_id`，不绑定用户会话，也不接受用户提供 thread id。
- 触发 workflow 时，普通用户会话主 runtime session 不被 workflow 内部上下文污染。
- workflow/role 配置校验能拒绝缺失 role、未知 node、未知 tool、循环/不可达图等错误。
- runner input 包含 workflow/role metadata；OpenAI instructions 拼接 workflow/role instructions；`allowedTools` 实际过滤可用 tools。
- `/workflow <id> <任务>` 可从 IM/Web 命令注册表识别并触发，`/workflow` 可列出可用工作流。
- `docs/ARCHITECTURE.md`、`docs/RUNTIME.md`、`docs/MEMORY.md`、`docs/MODULE.md`、`docs/COMMAND.md` 与新增协议一致。
- 本轮 validation 和 review gate 均通过；若未完成全部范围，必须回写 handoff 和 roadmap。

## Milestones

### Milestone 1：计划、依赖与配置契约

Objective:
- 建立 active plan、依赖版本、workflow/role 配置解析器和基础测试。

Allowed scope:
- `PLANS/ACTIVE.md`
- `package.json`
- `package-lock.json`
- `src/agent/workflow/**`
- `tests/unit/agent/workflow/**`
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`

Validation:
- `npm test -- tests/unit/agent/workflow/config.test.ts`
- `npm run typecheck`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 依赖版本只使用本轮查到的 `@langchain/langgraph@1.3.0`、`@langchain/langgraph-checkpoint-sqlite@1.0.1`。如 checkpoint API 与项目 SQLite 绑定成本过高，v1 可以先封装 checkpointer factory 并用 LangGraph MemorySaver 跑单元路径，但必须保留 SQLite checkpoint 接口和依赖审查记录。
- 已运行并通过：`npm test -- tests/unit/agent/workflow/config.test.ts`（7 tests）、`npm run typecheck`、相关 Prettier check。
- 已按 `RUNBOOKS/Review.md` 复审通过。审查记录保留一个后续注意点：未知 `permissionMode` 当前默认 `standard`，Milestone 3 做权限硬边界时应改成显式拒绝或更保守降级。
- `npm audit --omit=dev --json` 报告现有生产依赖链仍有 10 个漏洞；本轮新增 LangGraph 包本身未在 audit 输出中作为直接漏洞源，但最终收尾需要记录依赖审查结果。

### Milestone 2：持久化与运行审计

Objective:
- 增加 workflow context/run/step 持久化 API，确保 workflow 上下文独立于用户会话。

Allowed scope:
- `src/domain/types.ts`
- `src/storage/db.ts`
- `src/agent/workflow/**`
- `tests/unit/agent/workflow/**`
- `tests/unit/storage/**`

Validation:
- `npm test -- tests/unit/agent/workflow/context.test.ts`
- `npm run typecheck`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 不能把 workflow context 塞入现有 `sessions(group_folder, agent_id)` 主会话 slot；workflow runtime session 必须使用独立 agent/session key。
- 已运行并通过：`npm test -- tests/unit/agent/workflow/context.test.ts`（4 tests）、`npm run typecheck`、相关 Prettier check。
- 已按 `RUNBOOKS/Review.md` 复审通过。审查记录保留一个后续注意点：低层 DB accessor 较宽，业务触发路径应统一走 `src/agent/workflow/context.ts`，避免绕过 context/run 一致性校验。

### Milestone 3：LangGraph engine 与 runner adapter

Objective:
- 用 LangGraph.js 编译 workflow 图，节点通过现有 `runAgentProcess` 执行 role task，并保存 run/step 状态。

Allowed scope:
- `src/agent/workflow/**`
- `src/agent/runner/container-runner.ts`
- `container/agent-runner/src/types.ts`
- `container/agent-runner/src/openai-agent-runtime.ts`
- `container/agent-runner/src/openai-agent-tools.ts`
- `tests/unit/agent/workflow/**`
- `tests/contracts/openai/**`

Validation:
- `npm test -- tests/unit/agent/workflow/engine.test.ts tests/contracts/openai/runner-request.test.ts tests/contracts/openai/agent-runtime.test.ts`
- `npm run typecheck`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- role frontmatter 里的 `allowedTools` 必须成为硬边界，不能只写进 prompt。
- 已运行并通过：`npm test -- tests/unit/agent/workflow/engine.test.ts tests/contracts/openai/runner-request.test.ts tests/contracts/openai/agent-runtime.test.ts`（17 tests）、`npm run typecheck`、相关 Prettier check。
- 已按 `RUNBOOKS/Review.md` 复审通过。审查记录保留两个后续注意点：LangGraph retry 下 step `attempt` 当前固定为 `1`，后续恢复/重试审计要补递增；error run 状态路径后续可补更直接的单测覆盖。

### Milestone 4：命令、API 与触发链路

Objective:
- 增加 `/workflow` 命令和后端 API，让用户会话触发 workflow run 并接收最终结果。

Allowed scope:
- `shared/runtime-command-registry.ts`
- `src/index.ts`
- `src/agent/workflow/**`
- `src/web/routes/**`
- `src/web/app.ts`
- `src/web/context.ts`
- `src/messaging/**`
- `tests/unit/agent/workflow/**`
- `tests/unit/core/runtime/**`
- `tests/unit/messaging/**`
- `tests/integration/web/**`

Validation:
- `npm test -- tests/unit/core/runtime/command-registry.test.ts tests/unit/messaging/slash-command.test.ts tests/integration/web/slash-command.test.ts`
- `npm run typecheck`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- v1 Web 可以先通过命令触发；专门的工作流控制台作为后续增强，不强塞进本轮首屏。
- 已运行并通过：`npm test -- tests/unit/core/runtime/command-registry.test.ts tests/unit/messaging/slash-command.test.ts tests/integration/web/slash-command.test.ts tests/unit/agent/workflow/command.test.ts`（23 tests）、`npm run typecheck`、相关 Prettier check。
- 复审第一轮指出 allowed scope 缺少新增 workflow command / Web deps 文件；已修正 `PLANS/ACTIVE.md` 后按 `RUNBOOKS/Review.md` 本地复查通过。复审记录保留一个后续注意点：`executeWorkflowCommand` 当前未传 `triggerMessageId`，后续工作流控制台回溯可补。

### Milestone 5：文档、全量验证与 review

Objective:
- 同步 owner docs，运行完整 validation/review gate，并按结果收尾或 handoff。

Allowed scope:
- `docs/ARCHITECTURE.md`
- `docs/RUNTIME.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `docs/COMMAND.md`
- `src/agent/workflow/engine.ts`
- `src/agent/workflow/command.ts`
- `tests/unit/agent/workflow/engine.test.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`

Validation:
- `npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/context.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/core/runtime/command-registry.test.ts`
- `npm run build`
- `npm --prefix web run build`
- `./scripts/validate.sh`
- `./scripts/review.sh`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 已运行并通过：`npm test -- tests/unit/agent/workflow/config.test.ts tests/unit/agent/workflow/context.test.ts tests/unit/agent/workflow/engine.test.ts tests/unit/core/runtime/command-registry.test.ts`（28 tests）、`npm run build`、`npm --prefix web run build`、`./scripts/validate.sh`（475 passed, 1 skipped）、`./scripts/review.sh`。
- Milestone 5 语义 review 期间发现真实 `/workflow` 路径仍会使用默认内存 checkpointer；已修正为复用独立 SQLite `~/.cli-claw/db/workflow-checkpoints.sqlite`，并同步 `docs/RUNTIME.md` / `docs/MEMORY.md` 与命令测试。
- 已按 `RUNBOOKS/Review.md` 完成 review gate；后续控制台、重试 attempt 递增、并发 run 策略和 `triggerMessageId` 回溯能力已同步到 `PLANS/ROADMAP.md`。

## Working Rules

- `PLANS/ACTIVE.md` 是本轮复杂任务执行的单一真相源。
- 一次只允许一个 milestone 处于 `in_progress`。
- 不隐式扩 scope；目标、方案、验证方式或涉及文件变化时，先更新 active plan。
- 每个 milestone 必须先写失败测试，再实现，再运行 validation，再走 review gate。
- Mark a milestone `done` only after both `Validation status` and `Review status` are `passed`.

## Handoff

Current milestone:
- Milestone 5

Current status:
- completed

Changed files:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`
- `package.json`
- `package-lock.json`
- `src/agent/workflow/config.ts`
- `tests/unit/agent/workflow/config.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/COMMAND.md`
- `docs/RUNTIME.md`
- `docs/MEMORY.md`
- `docs/MODULE.md`
- `src/domain/types.ts`
- `src/storage/db.ts`
- `src/agent/workflow/context.ts`
- `tests/unit/agent/workflow/context.test.ts`
- `src/agent/workflow/engine.ts`
- `src/agent/runner/container-runner.ts`
- `container/agent-runner/src/types.ts`
- `container/agent-runner/src/openai-agent-runtime.ts`
- `container/agent-runner/src/openai-agent-tools.ts`
- `tests/unit/agent/workflow/engine.test.ts`
- `tests/contracts/openai/runner-request.test.ts`
- `tests/contracts/openai/agent-runtime.test.ts`
- `src/agent/workflow/command.ts`
- `src/agent/workflow/tools.ts`
- `src/web/app.ts`
- `src/web/context.ts`
- `shared/runtime-command-registry.ts`
- `tests/unit/agent/workflow/command.test.ts`
- `tests/unit/core/runtime/command-registry.test.ts`
- `tests/integration/web/slash-command.test.ts`

Last failure summary:
- Milestone 1 review 曾发现 invalid workflow node / malformed edge 会被静默过滤；已补红测并修复，复审通过。
- Milestone 2 review 曾发现 `createWorkflowRun` 允许外部传入与 context 不一致的 `folder/workflowId`；已补红测并修复为 context 一致性校验，复审通过。
- Milestone 3 review 曾发现 run 状态未推进、runner 侧 `role.allowedTools` 不是优先硬边界；已补红测/合同测试并修复，复审通过。
- Milestone 4 review 曾发现计划 allowed scope 未覆盖新增 workflow command / Web deps 文件；已修正 scope 并本地复查通过。
- Milestone 5 semantic review 曾发现真实 `/workflow` 路径未使用持久化 SQLite checkpointer、且 final plan 状态尚未回写；已修正实现、补文档/测试，并完成最终状态回写。

Suspected cause:
- parser 之前用 `filter` 丢弃解析失败项，没有把 malformed config 提升为 workflow 级错误。
- run 创建层之前信任 caller 传入的 folder/workflowId，而不是以 workflow context 为唯一来源。
- engine 之前只记录 step 状态，未更新 workflow run；OpenAI runtime 之前只信任顶层 `allowedTools`，没有把 `role.allowedTools` 作为 workflow 场景硬边界。
- Milestone 4 scope 是计划描述遗漏，不是代码路径问题。

Next step:
- 本轮已完成；后续增强从 `PLANS/ROADMAP.md` 的 workflow console / retry audit 路线继续。
