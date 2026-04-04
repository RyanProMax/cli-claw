# COMMAND

## 概览

当前项目支持一组工作区与会话管理命令，但**不支持**通过聊天命令直接切换模型或 Agent。  
`/model` 目前**未实现**；模型、Agent、执行模式的切换应通过工作区运行时设置完成。

## 入口区别

### IM Slash Command

以下命令按 IM 会话语义实现，适用于绑定到工作区的飞书 / Telegram / QQ / 微信 / 钉钉等入口：

| 命令 | 别名 | 作用 |
| --- | --- | --- |
| `/clear` | - | 清除当前工作区或当前绑定 Agent 的会话上下文 |
| `/list` | `/ls` | 查看当前用户可访问的工作区与对话列表 |
| `/status` | - | 查看当前工作区、运行状态与绑定信息摘要 |
| `/recall` | `/rc` | 汇总当前工作区最近消息并生成回顾摘要 |
| `/where` | - | 查看当前 IM 会话绑定到了哪个工作区 / Agent |
| `/bind <workspace>` | - | 将当前 IM 会话绑定到指定工作区 |
| `/bind <workspace>/<agent短ID>` | - | 将当前 IM 会话绑定到指定工作区下的 conversation agent |
| `/unbind` | - | 解除绑定，回到默认工作区 |
| `/new <名称>` | - | 创建新工作区并把当前 IM 会话绑定过去 |
| `/require_mention true` | - | 群聊里只有被 @ 时才响应 |
| `/require_mention false` | - | 群聊里不需要 @ 也会响应 |
| `/sw <任务描述>` | `/spawn <任务描述>` | 在当前工作区创建并行任务 |

### Web 直接识别

Web 输入框目前只对以下命令做了前端 / WebSocket 层的直接识别：

| 命令 | 作用 |
| --- | --- |
| `/clear` | 直接重置当前工作区或当前 Agent 会话 |
| `/sw <任务描述>` | 直接创建并行任务 |
| `/spawn <任务描述>` | `/sw` 的别名 |

其余命令不要依赖 Web 输入框的“本地命令模式”；如果需要工作区绑定、位置查询、回顾摘要等能力，当前以 IM slash command 语义为准。

## 不支持的命令

### `/model`

当前**不支持** `/model`。  
如果要修改实际执行模型 / Agent：

1. 在工作区设置里切换 `Agent`
2. 如有需要，再切换执行模式 `host` / `container`
3. 保存后让新运行时接管后续对话

## 说明

- `/sw` 与 `/spawn` 是同义命令。
- `/bind` 目标里的 `agent短ID` 指 conversation agent 的短标识，不是工作区 folder。
- `/require_mention` 主要影响 IM 群聊入口，对 Web 单聊无意义。
