# 当前任务：单一路径执行残留清理

> **给 agentic workers：** 必须使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`，并保留 validation / review gate。计划统一写在 `PLANS/`；不要在 `docs/superpowers` 下新增计划。

## 目标

- 清理上一轮单一本地 Agent 进程改造后残留的 Web 设置入口、用户可见文案、测试命名和构建脚本噪音。
- 删除旧的工作区设置弹窗及整条前端调用链；模型、reasoning、speed 继续通过 `/openai` 配置。
- 确认 Makefile、package manifests、Web/API、tests、owner docs 都只描述本地 Agent 进程这一条链路。

## 完成标准

- Web 工作区菜单不再出现旧设置入口，也不再挂载对应弹窗。
- 新建工作区不再展示或提交单项 `agent_type` 设置；后端默认使用唯一的 Codex/OpenAI Agent 进程。
- 用户可见文案不再提到旧进程边界、独立 Agent 控制台、旧兼容标签或模式徽标。
- 旧的 workspace helper 与测试已删除，无兼容壳。
- 残留扫描结果只允许出现历史迁移、负向断言、物理路径说明或传递依赖，并在 handoff 中明确归类。

## Milestone 1：残留入口和文案清理

状态：
- done

允许范围：
- `web/src`
- `tests`
- `docs`
- `README.md`
- `src/README.md`
- `Makefile`
- `PLANS/ACTIVE.md`

已完成：
- 删除旧工作区设置弹窗、helper 和对应 unit test。
- 删除 `ChatPage` / `UnifiedSidebar` / `ChatGroupItem` 中的弹窗 state、props、菜单入口和渲染。
- 删除 `ChatView` 顶部 runtime badge，并把紧凑视图按钮从控制台图标改为列表图标。
- 清理新建工作区的单项 Agent 类型展示和显式 `agent_type` 提交。
- 清理 MCP 详情页旧进程边界文案，以及测试里的旧模式变量名。
- 将 README / owner docs / 测试描述中的旧设置口径收敛为模型配置。

已运行验证：
- 通过：残留扫描；命中仅剩旧列迁移、负向断言和隐藏目录安全 denylist。
- 通过：`make help`
- 通过：`npm --prefix web run build`
- 通过：`npm test -- tests/integration/web/slash-command.test.ts tests/integration/routes/groups.test.ts tests/integration/agent/queue/group-queue.test.ts tests/unit/core/workspace/files-workspace-cwd.test.ts tests/unit/core/workspace/workspace-config-workspace-cwd.test.ts tests/unit/core/runtime/group-runtime.test.ts`
- 通过：`./scripts/validate.sh`
- 通过：`./scripts/review.sh`，并按 `RUNBOOKS/Review.md` 完成语义 review gate，无阻塞发现。
- 通过：`npm run release:check`
- 通过：当前飞书私聊 live smoke。
- 通过：安全重启后 `curl -fsS http://127.0.0.1:3000/api/health` 返回 healthy。

## Handoff

当前状态：
- Milestone 1 已完成；validation、review、release gate、live smoke 和健康检查均已通过。

允许残留：
- `src/storage/db.ts` 中旧列名仅用于破坏性迁移和 schema assert。
- tests 中对旧 API 字段不存在的断言可保留。
- `container/agent-runner/` 是历史物理路径，实际承载本地 Agent 进程 runner。
- `web/package-lock.json` 中若存在来自第三方传递依赖的环境检测包，可保留并在总结中说明。
