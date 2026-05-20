# MODULE

> 本文负责：唯一维护的 repo tree / 模块清单。架构解释见 `docs/ARCHITECTURE.md`；运行时边界见 `docs/RUNTIME.md`；记忆机制见 `docs/MEMORY.md`。

## 模块索引

```text
.
├── src/
│   ├── index.ts                    # backend bootstrap；消息轮询、执行调度、流式输出汇总
│   ├── cli.ts                      # npm 二进制入口；分发 start / help / version
│   ├── reset-admin.ts              # 管理员密码重置入口
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
│   │   ├── scheduler/index.ts       # 定时任务调度、执行日志、任务工作区与 scheduled workflow
│   │   ├── scheduler/usage-guard.ts # scheduled agent / workflow 的 OpenAI 5h/7d usage 延后策略
│   │   ├── script-runner.ts         # script task 执行
│   │   └── task-utils.ts            # task owner / task workspace helper
│   ├── core/
│   │   ├── app-root.ts              # 安装位置 / 包根路径 / 启动目录解析
│   │   ├── auth.ts                  # Web 用户认证 helper
│   │   ├── billing.ts               # 套餐、额度与账单 helper
│   │   ├── cache.ts                 # `~/.cli-claw/cache` 通用缓存目录、TTL/容量清理与定时清理 loop
│   │   ├── config.ts                # 全局路径、端口、运行环境配置
│   │   ├── logger.ts                # pino logger
│   │   ├── permissions.ts           # 权限模板与权限判断
│   │   ├── schemas.ts               # API 输入 schema
│   │   ├── utils.ts                 # backend 通用工具
│   │   ├── runtime/                 # agent/runtime 选择、配置、用量与 Codex CLI 登录态
│   │   ├── self/                    # self-check、startup launch、自重启实现
│   │   └── workspace/               # workspace cwd、allowlist、文件管理安全边界
│   ├── storage/
│   │   ├── db.ts                    # SQLite 数据层 facade；后续再拆 repositories
│   │   └── sqlite-compat.ts         # Bun / Node.js SQLite 兼容加载
│   ├── domain/
│   │   └── types.ts                 # 后端共享 domain 类型
│   ├── messaging/
│   │   ├── channel.ts               # IM channel factory
│   │   ├── manager.ts               # per-user IM 连接池
│   │   ├── notifier.ts              # 新消息通知与中断等待
│   │   ├── lifecycle.ts             # IM 消息 lifecycle 记录
│   │   ├── slash-command.ts         # IM slash command 解析与改写
│   │   ├── command-utils.ts         # IM command 共享工具
│   │   ├── attachments.ts           # 图片 / 文件附件规范化
│   │   ├── downloader.ts            # IM 文件下载
│   │   ├── image-detector.ts        # 图片 MIME 探测
│   │   ├── new-workspace.ts         # IM 创建工作区 helper
│   │   └── providers/               # Feishu / Telegram / QQ / DingTalk / WeChat adapters
│   ├── presentation/
│   │   ├── assistant-meta-footer.ts # footer 格式化与 remaining usage 规则
│   │   ├── reply-visibility.ts      # final/tool/send_message 可见文本裁剪
│   │   ├── stream-event.types.ts    # backend stream event re-export
│   │   ├── streaming-runtime-meta.ts# streaming card runtime meta
│   │   ├── loop-status.ts           # 循环任务状态展示
│   │   └── tool-step-display.ts     # tool step 文本展示
│   ├── web/
│   │   ├── app.ts                   # Hono 应用、WebSocket、静态资源托管
│   │   ├── context.ts               # Web deps、会话、权限、工作区访问 helper
│   │   ├── middleware/auth.ts       # Web auth middleware
│   │   └── routes/                  # HTTP API routes
│   ├── skills/
│   │   ├── command-dispatch.ts      # skill command 发现、冲突检查与 executor 执行
│   │   └── utils.ts                 # skill 路径与元数据 helper
│   └── mcp/
│       └── utils.ts                 # 用户级 MCP Server 配置读取
├── tests/
│   ├── unit/                        # 单模块行为，少 mock 或局部 mock
│   ├── integration/                 # 跨模块链路，mock 外部网络/进程边界
│   ├── contracts/                   # CLI/package/runtime/OpenAI 请求协议等外部契约
│   └── scripts/                     # ops / stock 等脚本测试
├── web/
│   └── src/                         # React frontend
├── container/
│   └── agent-runner/                # Agent runner package（历史路径，实际为本地 Agent 进程）
├── shared/                          # 前后端与 runner 共用纯函数/类型
├── PLANS/                           # 当前计划、长期 roadmap 与计划模板
├── RUNBOOKS/                        # 实施、review、自迭代、handoff 操作规范
├── .agents/
│   ├── workflows/                   # 仓库级/内置 workflow/crew graph 配置；含 hkipo、stock strategy discovery/review
│   ├── agent-roles/                 # runtime role card；会注入 workflow runner；含 hkipo crew 与 stock strategy roles
│   ├── roles/                       # 仓库协作/subagent 角色，不注入 runtime
│   └── skills/                      # 仓库内联 skill command
├── scripts/                         # repo 级验证、review、release 脚本
├── ops/                             # 本机 launchd / 运维辅助
└── docs/                            # 架构、运行时、模块、命令文档
```

## 维护约定

- 顶层 `src/` 只放服务入口、CLI 入口和运行方式要求的特殊文件。
- 新后端代码必须落到拥有该职责的目录；不要新增长期存在的顶层实现文件。
- 大文件 `src/index.ts`、`src/storage/db.ts`、`src/web/app.ts`、`src/core/runtime/config.ts` 后续拆分时应按行为边界拆，不在无关功能 PR 中顺手重排。
- 测试文件路径应反映测试意图：`unit`、`integration`、`contracts`、`scripts`，而不是历史源文件名平铺。
