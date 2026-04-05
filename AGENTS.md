# Cli Claw

Cli Claw 是一个多用户、自托管的 CLI Agent 平台：

- `src/` 负责消息接入、权限、调度、存储与 Web API。
- `web/` 是 React 前端与 PWA。
- `container/agent-runner/` 负责实际 Agent 执行、工具调用与流式事件。

当前运行时：

- `claude`：Claude Agent SDK + Claude Code CLI
- `codex`：Codex CLI + `codex-acp`

项目内部运行时记忆统一使用工作区或用户目录下的 `AGENTS.md`；外部运行时生态的 `.claude/CLAUDE.md`、`~/.codex/config.toml` 等契约仍按各自原协议保留。

## 文档入口

- 项目架构：`docs/ARCHITECTURE.md`
- 运行时矩阵：`docs/RUNTIME.md`
- 持久化上下文：`docs/CONTEXT.md`
- 模块索引：`docs/MODULE.md`
- 工程规范：`docs/ENGINEERING.md`
- 指令说明：`docs/COMMAND.md`
- 本地任务记录：`docs/.local/PLAN.md`（本地文件，不入库）

## 工作流

1. 开始任务前先更新本地 `docs/.local/PLAN.md`，写清目标、范围、计划。
2. 实施过程中若范围、方案或验证方式变化，及时回写 `PLAN.md`。
3. 任务结束后再次更新 `PLAN.md`，补上结果、验证、遗留事项。
4. 每完成一个任务立即提交一个英文 commit，格式建议：`type: summary`。

## 编码与修改约束

- 先读上下文再改代码；优先沿用现有模块边界与命名风格。
- 搜索优先用 `rg` / `rg --files`。
- 手工修改代码或文档时优先用 `apply_patch`；避免用脚本粗暴重写整个文件。
- 不回滚用户已有改动；遇到冲突先理解再兼容。
- 禁止使用破坏性 git 命令（如 `reset --hard`、`checkout --`），除非用户明确要求。
- 项目内部运行时记忆统一使用 `AGENTS.md`；`.claude/`、`~/.claude/CLAUDE.md`、`~/.codex/config.toml` 视为外部运行时契约。

## 文档同步要求

出现以下改动时，必须同步更新 `AGENTS.md` 或 `docs/`：

- 架构分层、执行模式、消息流、权限边界变更
- 工作区 / Memory / MCP / Skills / 运行时目录约定变更
- 新增或重命名关键模块、页面、路由、核心 store
- 影响协作入口、提交流程、验证方式的工程规则变更

## 验证

- 至少运行与改动直接相关的测试。
- 涉及构建、类型或跨子项目改动时，补跑对应 `build` / `typecheck`。
- 未验证的部分必须在收尾说明里明确指出。

## 提交约定

- commit message 使用英文。
- 一次 commit 聚焦一个任务，避免把无关清理混进去。
- 若任务涉及文档入口、架构边界或运行时记忆，commit 前确认 `AGENTS.md` / `docs/` 已同步。

## 模块索引

```text
.
├── src/
│   ├── index.ts                    # 进程入口；消息轮询、执行调度、流式输出汇总
│   ├── web.ts                      # Hono 应用、WebSocket、静态资源托管
│   ├── db.ts                       # SQLite 数据层、用户/工作区/消息/任务持久化
│   ├── group-queue.ts              # 会话并发控制、重试与排队
│   ├── container-runner.ts         # Docker / host 执行、卷挂载、Agent 生命周期
│   ├── runtime-config.ts           # Provider / IM / 系统配置、密文存储、环境变量合成
│   ├── runtime-build.ts            # 运行进程与已加载 dist 的 build 指纹
│   ├── runtime-identity.ts         # 实际运行时 agent / model / effort 元数据
│   ├── file-manager.ts             # 文件读写边界、系统路径保护、路径安全
│   ├── task-scheduler.ts           # 定时任务调度、执行日志、工作区上下文解析
│   ├── project-memory.ts           # 项目内部记忆文件名与路径 helper
│   ├── im-manager.ts               # per-user IM 连接池
│   ├── feishu.ts                   # 飞书接入与消息适配
│   ├── telegram.ts                 # Telegram 接入与消息适配
│   ├── qq.ts                       # QQ 接入与消息适配
│   ├── dingtalk.ts                 # 钉钉接入与消息适配
│   ├── wechat.ts                   # 企业微信接入与消息适配
│   ├── message-attachments.ts      # 图片 / 文件附件规范化
│   ├── agent-output-parser.ts      # runner 输出解析与结果收尾
│   ├── assistant-meta-footer.ts    # 响应时长 / 模型 / cost 等 footer 聚合
│   └── routes/
│       ├── auth.ts                 # 登录、注册、会话、用户资料
│       ├── groups.ts               # 工作区 CRUD、消息、运行时设置、共享成员
│       ├── files.ts                # 工作区文件管理
│       ├── memory.ts               # AGENTS / 日期记忆 / 对话归档的读写与搜索
│       ├── tasks.ts                # 定时任务与执行日志
│       ├── config.ts               # Provider、IM、外观、系统设置
│       ├── mcp-servers.ts          # 用户级 MCP Server 配置
│       ├── workspace-config.ts     # 工作区 .claude/ 配置、技能、MCP 元数据
│       ├── skills.ts               # 技能浏览、安装、管理
│       ├── agents.ts               # Agent 定义与管理接口
│       ├── agent-definitions.ts    # 预定义 Agent 路由
│       ├── usage.ts                # 用量与计费相关接口
│       ├── billing.ts              # 账单与套餐接口
│       ├── browse.ts               # 浏览器 / 网页能力相关接口
│       ├── monitor.ts              # 监控与运行状态接口
│       ├── bug-report.ts           # 问题反馈入口
│       └── admin.ts                # 用户、邀请码、审计日志
├── web/
│   └── src/
│       ├── pages/
│       │   ├── ChatPage.tsx        # 主聊天页，串联消息、工作区、面板和 runtime 设置
│       │   ├── MemoryPage.tsx      # 记忆文件浏览、搜索、编辑
│       │   ├── SettingsPage.tsx    # 系统 / 用户设置入口
│       │   ├── TasksPage.tsx       # 定时任务管理
│       │   ├── SkillsPage.tsx      # 技能管理
│       │   ├── McpServersPage.tsx  # MCP Server 配置
│       │   ├── UsagePage.tsx       # 用量与成本查看
│       │   ├── BillingPage.tsx     # 套餐与计费查看
│       │   ├── MonitorPage.tsx     # 系统监控页
│       │   └── UsersPage.tsx       # 管理员用户页
│       ├── components/
│       │   ├── chat/               # 聊天区、工作区菜单、消息与输入框
│       │   ├── layout/             # 侧边栏、壳层、页面布局
│       │   ├── common/             # 通用品牌、加载态、状态组件
│       │   ├── groups/             # 工作区管理
│       │   ├── settings/           # 设置面板
│       │   ├── tasks/              # 任务相关 UI
│       │   ├── skills/             # 技能相关 UI
│       │   ├── monitor/            # 监控 UI
│       │   ├── billing/            # 计费 UI
│       │   ├── mcp-servers/        # MCP Server UI
│       │   ├── users/              # 管理员用户 UI
│       │   └── ui/                 # 基础设计系统组件
│       ├── stores/
│       │   ├── chat.ts             # 聊天状态、消息同步、流式更新
│       │   └── groups.ts           # 工作区状态
│       ├── lib/
│       │   ├── workspace-runtime.ts    # agent_type / execution_mode 约束
│       │   ├── assistantMetaFooter.ts  # Web 端 footer 文本拼装
│       │   └── messageHistoryCursor.ts # 历史消息稳定游标
│       └── styles/
│           └── globals.css         # 全局主题、字体、滚动条与基础样式
├── container/
│   └── agent-runner/
│       └── src/
│           ├── index.ts            # query 循环、流式事件、上下文压缩、memory flush
│           ├── mcp-tools.ts        # 内置 MCP 工具定义
│           ├── stream-processor.ts # StreamEvent 汇总与工具状态跟踪
│           ├── agent-definitions.ts# 预定义子 Agent
│           ├── codex-config.ts     # Codex model / effort 配置解析
│           └── types.ts            # runner 侧共享类型
├── shared/
│   ├── stream-event.ts             # 前后端与 runner 共用的 StreamEvent 定义
│   └── assistant-meta-footer.ts    # 多端共享 footer 格式化
└── docs/
    ├── ARCHITECTURE.md             # 项目结构与核心数据流
    ├── RUNTIME.md                  # Claude / Codex 运行时矩阵与约束
    ├── CONTEXT.md                  # 持久化架构约束与边界
    ├── MODULE.md                   # 模块索引
    ├── ENGINEERING.md              # 开发规范、验证与提交流程
    ├── COMMAND.md                  # 当前支持的命令与入口差异
    └── .local/PLAN.md              # 本地任务记录（不入库）
```
