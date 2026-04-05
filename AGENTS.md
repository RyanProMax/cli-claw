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
- 计划模板：`PLANS/_TEMPLATE.md`
- 当前任务计划：`PLANS/ACTIVE.md`（本地文件，不入库，是复杂任务执行的单一真相源）
- 实施手册：`RUNBOOKS/Implement.md`
- Review Gate：`RUNBOOKS/Review.md`
- 交接手册：`RUNBOOKS/Handoff.md`

## 工作流

### Codex 进入仓库后的读取顺序

1. 先读本文件，再读 `docs/ENGINEERING.md`。
2. 按任务类型补读相关上下文：架构看 `docs/ARCHITECTURE.md`，运行时看 `docs/RUNTIME.md`，记忆与目录约束看 `docs/CONTEXT.md`，模块定位看 `docs/MODULE.md`。
3. 复杂任务开始编码前，必须读取并更新本地 `PLANS/ACTIVE.md`；若文件不存在，先基于 `PLANS/_TEMPLATE.md` 创建。
4. 涉及执行、review、交接时，分别对照 `RUNBOOKS/Implement.md`、`RUNBOOKS/Review.md`、`RUNBOOKS/Handoff.md`。

### 复杂任务执行协议

1. 复杂任务必须先写 `PLANS/ACTIVE.md`，再开始编码；没有 active plan 不进入实现。
2. `PLANS/ACTIVE.md` 是任务执行的单一真相源；目标、milestone、scope、验证、阻塞与 handoff 都以它为准。
3. 一次只允许一个 milestone 处于 `in_progress`；未完成当前 milestone 前，不得并行推进下一个 milestone。
4. 不允许隐式扩 scope；若目标、方案、验证方式或涉及文件发生变化，先更新 `PLANS/ACTIVE.md`，再继续实现。
5. 每轮实现后都必须运行验证；验证失败时停留在当前 milestone 内修复，不得带着失败继续向后推进。
6. 验证通过后还必须经过 review gate；只有 validation 和 review 都通过，当前 milestone 才能标记为 `done`。
7. 连续修复仍失败、线程阻塞、需要换线程继续或要交给下一次 Codex 会话时，必须写 handoff，并回写到 `PLANS/ACTIVE.md`。
8. 任务完成后必须更新 `PLANS/ACTIVE.md` 的结果与 handoff，再做最终提交；commit message 使用英文，建议格式 `type: summary`。

### Subagent 约束

- 只有在任务可以被拆成窄职责、低耦合、可并行的子问题时，才允许显式派生 subagents。
- 不要把当前主路径上立即阻塞的工作直接丢给 subagent；主 agent 负责汇总、决策、最终改动与推进 milestone。
- 不要为了“更忙”而派生 subagents；目录不清、scope 未锁定、验证标准未写清时，一律先留在主 agent。
- 本阶段不引入 `.codex/skills/`；若未来补充仓库级 Codex skills，必须保持窄职责、可验证，并与 `RUNBOOKS/*` 协议保持一致。
- 默认角色建议：
  - `reader`：只读探索、定位上下文、输出摘要
  - `implementer`：在明确写入边界内实施最小改动
  - `tester`：复现、执行验证、汇总失败现象
  - `reviewer`：按 review gate 审查 diff、风险与遗漏
- subagent 输出必须结构化，至少包含：`summary`、`files`、`risks`、`next_action`。

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

- 长任务默认按 `PLANS/ACTIVE.md` 中当前 milestone 的 `Validation` 执行；若仓库已提供统一入口，优先使用 `./scripts/validate.sh` 与 `./scripts/review.sh`。
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
├── PLANS/
│   └── _TEMPLATE.md                # 复杂任务计划模板；本地执行时复制为 ACTIVE.md
├── RUNBOOKS/
│   ├── Implement.md                # 主 agent 实施循环、验证与 repair loop 约定
│   ├── Review.md                   # Review gate 清单
│   └── Handoff.md                  # 阻塞 / 换线程 / 跨会话交接模板
├── scripts/
│   ├── validate.sh                 # 统一验证入口；串联测试、类型检查与构建
│   └── review.sh                   # 机械化 review 辅助；语义审查仍按 RUNBOOKS/Review.md
├── .codex/
│   └── agents/
│       ├── reader.md               # 只读探索子角色
│       ├── implementer.md          # 窄写入实施子角色
│       ├── tester.md               # 验证 / 复现子角色
│       └── reviewer.md             # 差异审查子角色
└── docs/
    ├── ARCHITECTURE.md             # 项目结构与核心数据流
    ├── RUNTIME.md                  # Claude / Codex 运行时矩阵与约束
    ├── CONTEXT.md                  # 持久化架构约束与边界
    ├── MODULE.md                   # 模块索引
    ├── ENGINEERING.md              # 开发规范、验证与提交流程
    └── COMMAND.md                  # 当前支持的命令与入口差异
```
