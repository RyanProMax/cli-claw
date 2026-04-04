# Module Index

## 后端核心

| 模块                      | 作用                                                        |
| ------------------------- | ----------------------------------------------------------- |
| `src/index.ts`            | 进程入口；启动迁移、消息轮询、容器/宿主机执行、流式输出汇总 |
| `src/web.ts`              | Hono 应用、WebSocket、静态资源托管                          |
| `src/db.ts`               | SQLite 数据层、用户/工作区/消息/任务/会话持久化             |
| `src/group-queue.ts`      | 会话并发控制、任务优先级、重试与排队                        |
| `src/container-runner.ts` | Docker / host 执行、卷挂载、Agent 进程生命周期              |
| `src/runtime-config.ts`   | 系统配置、Provider 配置、加密存储、环境变量合成             |
| `src/file-manager.ts`     | 文件读写边界、系统路径保护、路径安全                        |
| `src/task-scheduler.ts`   | 定时任务调度、执行日志、工作区上下文解析                    |
| `src/project-memory.ts`   | 项目内部记忆文件名与旧 `CLAUDE.md` 迁移 helper              |

## 主要路由

| 路由文件                         | 作用                                                |
| -------------------------------- | --------------------------------------------------- |
| `src/routes/auth.ts`             | 登录、注册、会话、用户资料                          |
| `src/routes/groups.ts`           | 工作区 CRUD、消息、运行时设置、共享成员             |
| `src/routes/files.ts`            | 工作区文件管理                                      |
| `src/routes/memory.ts`           | `AGENTS.md` / 日期记忆 / 对话归档的枚举、读写、搜索 |
| `src/routes/tasks.ts`            | 定时任务与执行日志                                  |
| `src/routes/config.ts`           | Provider、IM、外观、系统设置                        |
| `src/routes/mcp-servers.ts`      | 用户级 MCP Server 配置                              |
| `src/routes/workspace-config.ts` | 工作区 `.claude/` 配置、技能、MCP 元数据            |
| `src/routes/admin.ts`            | 用户、邀请码、审计日志                              |

## IM / 运行时适配

| 模块                                                                  | 作用                      |
| --------------------------------------------------------------------- | ------------------------- |
| `src/im-manager.ts`                                                   | per-user IM 连接池        |
| `src/feishu.ts` / `src/telegram.ts` / `src/qq.ts` / `src/dingtalk.ts` | 各渠道接入与消息适配      |
| `src/message-attachments.ts`                                          | 图片/文件附件规范化       |
| `src/agent-output-parser.ts`                                          | runner 输出解析与结果收尾 |

## 前端

| 区域                                   | 作用                                            |
| -------------------------------------- | ----------------------------------------------- |
| `web/src/pages/ChatPage.tsx`           | 主聊天页，串联消息、工作区、面板和 runtime 设置 |
| `web/src/pages/MemoryPage.tsx`         | 记忆文件浏览、搜索、编辑                        |
| `web/src/pages/SettingsPage.tsx`       | 系统/用户设置入口                               |
| `web/src/components/chat/*`            | 聊天区、工作区菜单、创建/编辑对话框             |
| `web/src/stores/chat.ts` / `groups.ts` | 聊天与工作区状态                                |
| `web/src/lib/workspace-runtime.ts`     | `agent_type` / `execution_mode` 约束            |

## Agent Runner

| 模块                                              | 作用                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| `container/agent-runner/src/index.ts`             | query 循环、流式事件、上下文压缩、memory flush |
| `container/agent-runner/src/mcp-tools.ts`         | 内置 MCP 工具定义                              |
| `container/agent-runner/src/stream-processor.ts`  | StreamEvent 汇总与工具状态跟踪                 |
| `container/agent-runner/src/agent-definitions.ts` | 预定义子 Agent                                 |

## 文档入口

- 架构与边界：`docs/ARCHITECTURE_CONTEXT.md`
- 模块索引：`docs/MODULE_INDEX.md`
- 工程规范：`docs/ENGINEERING_RULES.md`
- 本地任务记录：`docs/.local/README.md` 与 `docs/.local/PLAN.template.md`
