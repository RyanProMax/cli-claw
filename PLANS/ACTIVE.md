# 当前任务：支持 Cli Claw 添加 KOL 白名单

## Goal

- 查清最近消息里“Cli Claw 不能加 KOL 白名单”的具体失败原因。
- 明确 KOL 白名单当前由哪个配置/数据源控制，以及为什么现有 OpenAI runtime/skill 路径无法直接修改。
- 在 Cli Claw 中补上可控、可测试的白名单管理入口，让操作者能通过显式 IM/Web skill 命令添加 KOL 白名单。
- 覆盖 `/kol` 相关真实入口和相邻错误路径，完成验证、review、提交、push；如影响运行服务，安全重启并确认健康。

## Done when

- 已基于真实消息/日志和代码路径给出根因，不只停留在“没有权限”这类表象。
- 新增或修复的命令能把指定 KOL 标识写入实际 `/kol` workflow 使用的白名单来源。
- 参数缺失、重复添加、正常添加都有自动化测试覆盖；当前 skill command payload 不含用户身份，本轮不虚构用户级授权模型。
- `/kol` 原有 E2E 不回退；新增管理入口 E2E 先红后绿。
- 相关测试、typecheck、review gate 通过；服务已按安全路径应用变更。
- 提交并 push。

## Milestones

### Milestone 1：消息与根因定位

Objective:
- 从本地消息/日志查出用户遇到的“不能加 KOL 白名单”上下文。
- 沿 `/kol` skill command、workflow 配置、白名单加载/校验路径追到实际数据源。
- 形成最小修复假设和测试切入点。

Allowed scope:
- `PLANS/ACTIVE.md`
- 只读检查消息数据库、运行日志
- 只读检查 `.agents/skills/stock-kol-intel/`
- 只读检查 `src/agent/skills/`、`src/messaging/`、`src/index.ts`
- 只读检查相关测试

Validation:
- 能指出失败发生在哪一层，列出将要写的红测名称和目标行为。

Status:
- done

Validation status:
- passed: 已从消息 DB 抽取 2026-06-04/2026-06-05 相关消息，并定位到实际白名单文件与失败层级

Review status:
- passed: 只读排查符合当前 milestone scope

Risks / Notes / Handoff:
- 消息证据：2026-06-04 用户要求把 `@aleabitoreddit`、`@qinbafrank`、`@xiaomustock`、`@maojietrading`、`@morganhousel`、`@charliebilello` 加到 KOL Workflow 关注列表；随后 Cli Claw 错误创建了一次 `kol` workflow 任务。
- 失败证据：workflow 终态明确写出“当前节点是只读模式，我不能直接写入 KOL Workflow 关注列表”，只生成待写入 JSON；2026-06-05 `/kol` 报告仍显示覆盖 KOL 只有 2 个。
- 根因：`/kol` skill command 只校验 `--days` 并触发只读报告 workflow；实际白名单在 sibling 目录 `/Users/ryan/projects/stock-kol-intel/references/kol_whitelist.json`，Cli Claw 没有任何管理命令能写它。
- 契约限制：skill executor payload 当前只有 `command`、`argsText`、`args`、`chatJid`、`workspace`，没有 sender/user identity；本轮只能做显式 `/kol-add` 管理命令，不能做用户级授权判断。
- 数据源现状：外部 `stock-kol-intel` 目录不是 git repo；运行时 local task 通过 `STOCK_KOL_INTEL_ROOT` 或 sibling/home 路径读取它。

### Milestone 2：红测与实现

Objective:
- 先写失败测试覆盖 KOL 白名单添加入口。
- 用最小改动实现白名单添加能力，保持仓库 skill / workflow 边界清晰。

Allowed scope:
- `PLANS/ACTIVE.md`
- `.agents/skills/stock-kol-intel/`
- `src/agent/skills/`
- `src/messaging/`
- `src/index.ts`
- 相关测试
- 必要时同步 `docs/COMMAND.md`

Validation:
- 新增测试先红后绿。
- `/kol` 真实入口测试仍通过。

Status:
- done

Validation status:
- passed:
  - 红测：`npx vitest run tests/contracts/skills/stock-kol-command.test.ts -t "/kol-add"` 先失败，证明当前实现把 `/kol-add` 当作 `/kol` 参数解析
  - 绿测：`npx vitest run tests/contracts/skills/stock-kol-command.test.ts -t "/kol-add"`
  - `npx vitest run tests/contracts/skills/stock-kol-command.test.ts`
  - `python3 -m py_compile .agents/skills/stock-kol-intel/commands/dispatch.py`
  - `python3 -m json.tool /Users/ryan/projects/stock-kol-intel/references/kol_whitelist.json`
  - `npx vitest run tests/contracts/skills/stock-kol-command.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`
  - `npx tsx -e ... discoverSkillCommands ...` 确认 `/help` 可发现 `/kol-add`

Review status:
- passed: 实现只触及 repository skill、命令文档、合约测试和实际外部白名单数据源；未改 TypeScript 分发协议

Risks / Notes / Handoff:
- 已新增 `/kol-add <@handle或X链接...> [--name 名称] [--focus 标签] [--note 说明]`，支持直接 handle、X/Twitter URL 和粘贴 Markdown 列表。
- `/kol-add` 写入 sibling `stock-kol-intel/references/kol_whitelist.json`，按 X handle 去重；`/kol` 仍只负责触发报告 workflow。
- 已用真实 2026-06-04 清单执行 `/kol-add`：新增 5 个，`@aleabitoreddit` 已存在跳过；实际白名单从 2 个变为 7 个，而不是 8 个，因为 6 个待加账号里有 1 个已经存在。
- 外部白名单目录 `/Users/ryan/projects/stock-kol-intel` 不是 git repo；其 `references/kol_whitelist.json` 已被实际更新并通过 JSON 校验。

### Milestone 3：完整验证、服务应用与提交

Objective:
- 跑相关测试、typecheck、review gate。
- 提交、push；若影响正在运行服务，安全重启并确认健康。

Allowed scope:
- `PLANS/ACTIVE.md`
- 本轮已修改文件
- `PLANS/ROADMAP.md`（仅跨轮次事项）

Validation:
- 与 KOL skill / workflow / Feishu command 相关的测试
- `npm run typecheck:backend`
- `git diff --check`
- `./scripts/review.sh`
- 如重启，`curl -fsS http://127.0.0.1:3000/api/health`

Status:
- done

Validation status:
- passed:
  - `npx vitest run tests/contracts/skills/stock-kol-command.test.ts`
  - `python3 -m py_compile .agents/skills/stock-kol-intel/commands/dispatch.py`
  - `python3 -m json.tool /Users/ryan/projects/stock-kol-intel/references/kol_whitelist.json`
  - `npx vitest run tests/contracts/skills/stock-kol-command.test.ts tests/unit/agent/workflow/local-tasks.test.ts tests/integration/messaging/feishu/kol-command-e2e.test.ts`
  - `npx tsx -e ... discoverSkillCommands ...`
  - `npm run typecheck:backend`
  - `git diff --check`
  - `./scripts/review.sh`
  - `./scripts/validate.sh`
  - `curl -fsS http://127.0.0.1:3000/api/health`

Review status:
- passed: `./scripts/review.sh` 通过；人工语义 diff review 未发现 blocking/important 问题

Risks / Notes / Handoff:
- `./scripts/validate.sh` 通过；输出中仍有既有 `MaxListenersExceededWarning` 与 Vite chunk size warning，非本轮新增失败。
- 这次未改 TypeScript backend 分发逻辑；skill command discovery 和 executor 运行时从磁盘读取当前 `.agents/skills` 文件，不需要安全重启即可生效。
- 当前服务 `/api/health` 返回 `healthy`。

## Handoff

Current milestone:
- Milestone 3 done

Current status:
- `/kol-add` 已实现并验证；真实白名单已写入当前清单，完整验证、review gate 和健康检查均通过，等待提交并 push。

Changed files:
- `PLANS/ACTIVE.md`
- `.agents/skills/stock-kol-intel/SKILL.md`
- `.agents/skills/stock-kol-intel/commands.json`
- `.agents/skills/stock-kol-intel/commands/dispatch.py`
- `docs/COMMAND.md`
- `tests/contracts/skills/stock-kol-command.test.ts`
- `/Users/ryan/projects/stock-kol-intel/references/kol_whitelist.json`（外部运行时数据源，非 cli-claw git repo）

Findings:
- `/kol` 不是写操作；它触发的 workflow/role 是只读报告链路。
- 之前失败不是权限审批问题，而是命令语义缺失：没有白名单 upsert 入口，导致“添加列表”被误调度成报告 workflow。

Next step:
- 提交并 push。
