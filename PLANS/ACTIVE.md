# 当前任务：修复 OpenAI `store:false` session 回放非持久化 item 导致 404

## Goal

- 查清截图中 OpenAI Responses 404 `Item with id 'rs_*' not found. Items are not persisted when store is set to false` 的根因。
- 修复 OpenAI runtime 在 `store:false` 下跨 turn 回放 `rs_*` / `msg_*` / tool call 等非持久化 provider item id 的问题。
- 用自动化 e2e 仿真测试覆盖连续对话、含 reasoning / assistant message / tool call 的 session 回放，扫描同类 OpenAI 请求入口，避免类似错误再次出现。

## Done when

- 根因有证据链：能说明哪个模块把非持久化 Responses output item 带入下一轮 `input`。
- 修复完成，且测试先红后绿覆盖截图对应的 `rs_*` item 404 场景。
- 扫描其他 OpenAI 请求入口，确认没有同类 `store:false` + 非持久化 item id 回放风险。
- 当前 milestone 验证通过，并经过 review gate。
- 若改动影响正在运行服务，提交后按安全路径应用变更。

## Milestones

### Milestone 1：根因调查与复现边界

Objective:
- 阅读 OpenAI runtime session、Codex provider、SDK session persistence 和现有 contract tests，定位 `rs_*` item 进入下一轮请求的具体边界。
- 不改生产代码，先写清单一根因假设和最小复现测试方案。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查 `container/agent-runner/src/`
- 只读检查 `tests/contracts/openai/`
- 只读检查 `docs/RUNTIME.md`
- 只读检查 `container/agent-runner/node_modules/@openai/agents*` SDK 源码

Validation:
- 记录关键调用链、涉及文件/函数和根因结论。

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 截图报错是 Responses API 在 `store:false` 下收到上一轮未持久化的 `rs_*` item id；错误文本明确要求 `store:true` 或移除该 item。
- 仓库 contract 明确 OpenAI/Codex runtime 必须发送 `store:false`，不能改为 `store:true` 绕过。
- 根因定位：截图里有 tool `steps`，对应 SDK 在同一个 `runner.run` 的工具循环里会调用 `prepareModelInputItems(originalInput, generatedItems, state._reasoningItemIdPolicy)`，把当前 turn 第一轮 Responses 的 `generatedItems` 拼回第二次 `/responses`。这条路径不经过 `FileOpenAiAgentSession.getItems()` / `addItems()` sanitizer。
- 当前 `Runner` 未设置 `reasoningItemIdPolicy`，SDK 默认保留 `reasoning` output item 的 `id`；在 `store:false` 时第二次 `/responses` 带入 `rs_*`，Codex/OpenAI 后端查不到非持久化 item，于是返回 404。
- 现有 contract 只覆盖跨 turn session 文件回放，不覆盖同 turn tool continuation；因此测试没有抓到截图场景。

### Milestone 2：红灯测试与最小修复

Objective:
- 写最小失败测试，复现连续 turn 中上一轮 Responses output item id 被回放到下一轮 `input`。
- 实现最小修复：在 OpenAI session 模型输入边界过滤所有 `store:false` 下不可回放的 provider item id，同时保留必要文本上下文和 tool call/result 配对。

Allowed scope:
- `PLANS/ACTIVE.md`
- `container/agent-runner/src/openai-agent-session.ts`
- `container/agent-runner/src/openai-agent-stream.ts`
- `container/agent-runner/src/codex-cli-provider.ts`（仅当根因证据需要）
- `tests/contracts/openai/runner-request.test.ts`
- `tests/contracts/openai/agent-runtime.test.ts`
- 必要时同步 `docs/RUNTIME.md`

Validation:
- 定向测试先红后绿：`npm test -- tests/contracts/openai/runner-request.test.ts -t "<新增测试名>"`
- 相关 contract tests：`npm test -- tests/contracts/openai/runner-request.test.ts tests/contracts/openai/agent-runtime.test.ts`

Status:
- done

Validation status:
- passed

Review status:
- passed

Risks / Notes / Handoff:
- 修复不能依赖 Feishu/Web 展示层过滤；必须在 runner/session 请求边界解决。
- 不能破坏连续对话记忆，第二轮仍应包含前一轮用户与 assistant 可见文本。
- 红灯测试应构造第一次 Responses 返回 `reasoning + function_call`，让 runner 执行 `send_message` 后发出第二次 `/responses`，断言第二次 request `input` 不含第一轮 `rs_*`。
- 截图还暴露了错误展示问题：如果同类 404 残余发生，runner 必须格式化为稳定中文/英文操作提示，不能把原始 JSON 进入 Feishu/Web 正文。
- 已新增红灯测试 `does not replay non-persisted Codex response item ids during tool continuation`。修复前第二次 `/responses` 的 `input` 包含 `rs_tool_loop_leak` 和 `fc_tool_loop_leak`，测试失败；修复后通过。
- 修复在 `runner.run` 配置 `reasoningItemIdPolicy: "omit"`，并通过 `callModelInputFilter` 对所有 top-level Responses output item 剥离 `id`，保留 `call_id`、工具输出和文本上下文。
- 已新增错误格式化红灯测试 `formats non-persisted Responses item errors without raw SDK JSON`。修复后同类 404 不再把原始 JSON、`rs_*`、`headers` 或 `requestID` 暴露到正文。
- 已同步 `docs/RUNTIME.md` 的 OpenAI `store:false` model input 边界契约。
- 验证通过：
  - `npm test -- tests/contracts/openai/runner-request.test.ts -t "does not replay non-persisted Codex response item ids during tool continuation"`（先红后绿）
  - `npm test -- tests/contracts/openai/agent-runtime.test.ts -t "formats non-persisted Responses item errors"`（先红后绿）
  - `npm test -- tests/contracts/openai/runner-request.test.ts tests/contracts/openai/agent-runtime.test.ts`

### Milestone 3：扫描、完整验证、review、提交与服务应用

Objective:
- 扫描其他 OpenAI 请求入口和错误格式化路径，确认没有同类 `store:false` item id 回放。
- 运行定向验证、typecheck、diff hygiene 和 review gate。
- 更新 `PLANS/ACTIVE.md` 结果与 handoff；若有跨轮次事项，回写 `PLANS/ROADMAP.md`。
- 默认提交并按安全路径重启服务。

Allowed scope:
- `PLANS/ACTIVE.md`
- `PLANS/ROADMAP.md`（仅跨轮次事项）
- `docs/RUNTIME.md`（仅协议变化）
- 本轮已修改文件

Validation:
- `npm test -- tests/contracts/openai/runner-request.test.ts tests/contracts/openai/agent-runtime.test.ts`
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
- 若真实服务需重启，按 `docs/COMMAND.md` 的安全重启路径，不直接 `kill` / `pkill`。
- 扫描结论：
  - 状态型 OpenAI runner 入口只有 `container/agent-runner/src/openai-agent-runtime.ts` 的 `runOpenAiAgentLoop`；已在该入口统一设置 model input filter。
  - `src/agent/runner/sdk-query.ts` 虽然也发送 `store:false`，但它只发送一次性当前用户 input，不保存 session、不执行工具 continuation，没有同类 `rs_*` / output id 回放风险。
  - `codex-cli-provider.ts` 的 terminal output fallback 仍可能把 completed output item 交给 SDK；新的 model input filter 覆盖该 fallback 后续进入模型的路径。
- 最终验证通过：
  - `npm test -- tests/contracts/openai/runner-request.test.ts tests/contracts/openai/agent-runtime.test.ts`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/review.sh`
- 已按 `RUNBOOKS/Review.md` 做语义 review：scope 聚焦 OpenAI runner/session/error formatting/tests/runtime docs；目标覆盖截图中的 tool step continuation `rs_*` 404；红绿测试覆盖工具循环与错误展示；未发现 debug/TODO、无未同步协议文档。
- 本轮不需要更新 `PLANS/ROADMAP.md`：修复已落地，无新的跨轮次待办。

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
- complete; validation, review, commit and safe restart all passed

Changed files:
- `PLANS/ACTIVE.md`
- `container/agent-runner/src/openai-agent-runtime.ts`
- `container/agent-runner/src/openai-agent-session.ts`
- `container/agent-runner/src/openai-agent-stream.ts`
- `docs/RUNTIME.md`
- `tests/contracts/openai/agent-runtime.test.ts`
- `tests/contracts/openai/runner-request.test.ts`

Last failure summary:
- 截图显示 OpenAI Responses 404：`Item with id 'rs_*' not found. Items are not persisted when store is set to false`。

Suspected cause:
- `Runner` 没有配置 `reasoningItemIdPolicy: "omit"`，SDK 在同 turn tool continuation 中把上一轮 `reasoning.id` 回放到下一次 `/responses`；session 文件 sanitizer 无法覆盖这条内存路径。

Next step:
- 无。若后续再次出现 OpenAI `store:false` non-persisted item 404，优先检查第二次 `/responses` 的 `input` 是否仍包含 top-level output `id`，以及 `filterOpenAiStoreFalseModelInput` 是否被绕过。

Result:
- 已提交实现：`Strip non-persisted OpenAI response item ids`。
- 已按安全路径重启服务：`bun src/cli.ts restart` 创建 restart intent `restart-2026-06-04T10-00-53-678Z-15057185`，状态 `passed`。
- 当前 backend PID `28931`，`GET /api/health` 返回 `{"status":"healthy","checks":{"database":true,"queue":true,"uptime":12}}`。
