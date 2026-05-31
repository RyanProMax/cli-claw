# MODULE

> 本文负责：唯一维护的 repo tree / 模块清单。架构解释见 `docs/ARCHITECTURE.md`；运行时边界见 `docs/RUNTIME.md`；记忆机制见 `docs/MEMORY.md`。

## 模块索引

```text
.
├── src/
│   ├── index.ts                    # backend bootstrap；消息轮询、执行调度、流式输出汇总
│   ├── cli.ts                      # npm 二进制入口；分发 start / help / version
│   ├── self-restart-watchdog.ts    # 自重启 watchdog 子进程入口
│   ├── agent/
│   │   ├── queue/group-queue.ts     # 会话并发控制、重试、排队与后台任务优先级
│   │   ├── workflow/                # LangGraph workflow/crew 配置、上下文、checkpoint、local task 与执行编排
│   │   ├── runner/
│   │   │   ├── container-runner.ts  # 本地 Agent 进程执行与生命周期（历史文件名）
│   │   │   ├── output-parser.ts     # runner 输出解析、错误格式化与 run log
│   │   │   ├── workspace-reset.ts   # runtime session 清理与工作区重置
│   │   │   ├── context-compaction.ts# 消息上下文压缩
│   │   │   └── sdk-query.ts         # SDK 查询封装
│   │   ├── scheduler/index.ts       # workflow 定时任务调度、执行日志与 usage guard
│   │   └── scheduler/usage-guard.ts # scheduled workflow 的 OpenAI 5h/7d usage 延后策略
│   ├── core/
│   │   ├── app-root.ts              # 安装位置 / 包根路径 / 启动目录解析
│   │   ├── auth.ts                  # 实例密码、session 与登录限流 helper
│   │   ├── cache.ts                 # `~/.cli-claw/cache` 通用缓存目录、TTL/容量清理与定时清理 loop
│   │   ├── config.ts                # 全局路径、端口、运行环境配置
│   │   ├── logger.ts                # pino logger
│   │   ├── schemas.ts               # API 输入 schema
│   │   ├── utils.ts                 # backend 通用工具
│   │   ├── runtime/                 # agent/runtime 选择、配置、用量与 Codex CLI 登录态
│   │   ├── self/                    # self-check、startup launch、自重启实现
│   │   └── workspace/               # workspace cwd、allowlist、文件管理安全边界
│   ├── storage/
│   │   ├── schema.ts                # schema 初始化、破坏性迁移与 DB 生命周期入口
│   │   ├── access.ts                # 实例密码与 access session
│   │   ├── messages.ts              # chat/message/cursor/lifecycle 持久化入口
│   │   ├── workspaces.ts            # registered groups、cwd 与 IM binding target
│   │   ├── workflows.ts             # workflow definition/context/run/step 审计
│   │   ├── scheduler.ts             # workflow scheduled task 与 task run logs
│   │   ├── agents.ts                # conversation/spawn agents 与 runtime sessions
│   │   ├── threads.ts               # 工作区线程与 IM 入口路由存储入口
│   │   ├── db.ts                    # SQLite 连接与底层存储实现
│   │   └── sqlite-compat.ts         # Bun / Node.js SQLite 兼容加载
│   ├── domain/
│   │   └── types.ts                 # 后端共享 domain 类型
│   ├── messaging/
│   │   ├── channel.ts               # IM channel factory
│   │   ├── manager.ts               # 实例级 Feishu / WeChat 连接管理
│   │   ├── notifier.ts              # 新消息通知与中断等待
│   │   ├── lifecycle.ts             # IM 消息 lifecycle 记录
│   │   ├── slash-command.ts         # IM slash command 解析与改写
│   │   ├── command-utils.ts         # IM command 共享工具
│   │   ├── context-router.ts        # Web / Feishu / WeChat 输入的工作区与线程调度
│   │   ├── attachments.ts           # 图片 / 文件附件规范化
│   │   ├── downloader.ts            # IM 文件下载
│   │   ├── image-detector.ts        # 图片 MIME 探测
│   │   ├── new-workspace.ts         # IM 创建工作区 helper
│   │   └── providers/               # Feishu / WeChat adapters
│   ├── presentation/
│   │   ├── assistant-meta-footer.ts # footer runtime identity / duration 格式化
│   │   ├── reply-visibility.ts      # final/tool/send_message 可见文本裁剪
│   │   ├── stream-event.types.ts    # backend stream event re-export
│   │   ├── streaming-runtime-meta.ts# streaming card runtime meta
│   │   └── tool-step-display.ts     # tool step 文本展示
│   ├── web/
│   │   ├── app.ts                   # Hono 应用、WebSocket、静态资源托管
│   │   ├── context.ts               # Web deps、实例 session 与工作区访问 helper
│   │   ├── workflow-dashboard.ts    # 工作流看板聚合模型，汇总 workflow run / step / scheduled task
│   │   ├── middleware/auth.ts       # Web auth middleware
│   │   └── routes/                  # HTTP API routes
│   ├── skills/
│   │   ├── command-dispatch.ts      # skill command 发现、冲突检查与 executor 执行
│   │   └── utils.ts                 # skill 路径与 frontmatter helper
├── tests/
│   ├── unit/                        # 单模块行为，少 mock 或局部 mock
│   ├── integration/                 # 跨模块链路，mock 外部网络/进程边界
│   ├── contracts/                   # CLI/package/runtime/OpenAI 请求协议等外部契约
│   └── scripts/                     # ops / stock 等脚本测试
├── web/
│   └── src/                         # React frontend；含 Chat / Automations / Settings 等页面与 zustand stores
├── container/
│   └── agent-runner/                # Agent runner package（历史路径，实际为本地 Agent 进程）
├── shared/                          # 前后端与 runner 共用纯函数/类型
├── PLANS/                           # 当前计划、长期 roadmap 与计划模板
├── RUNBOOKS/                        # 实施、review、handoff 操作规范
├── .agents/
│   ├── workflows/                   # 仓库级/内置 workflow/crew graph 配置；含 hkipo、kol
│   ├── agent-roles/                 # runtime role card；会注入 workflow runner；含 hkipo crew、kol reporter
│   ├── roles/                       # 仓库协作/subagent 角色，不注入 runtime
│   └── skills/                      # 仓库内联 skill command
├── scripts/                         # repo 级验证、review、release 脚本
├── ops/                             # 本机 launchd / 运维辅助
└── docs/                            # 架构、运行时、模块、命令文档
```

## 维护约定

- 顶层 `src/` 只放服务入口、CLI 入口和运行方式要求的特殊文件。
- 新后端代码必须落到拥有该职责的目录；不要新增长期存在的顶层实现文件。
- 大文件 `src/index.ts`、`src/storage/db.ts`、`src/web/app.ts`、`src/core/runtime/config.ts` 后续拆分时应按行为边界拆，不在无关功能 PR 中顺手重排；业务调用应优先从 `src/storage/{access,messages,workspaces,workflows,scheduler,agents}.ts` 导入，不直接依赖底层 `db.ts`。
- 测试文件路径应反映测试意图：`unit`、`integration`、`contracts`、`scripts`，而不是历史源文件名平铺。
