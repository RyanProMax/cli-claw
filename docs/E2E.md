# E2E

> 本文负责：端到端测试入口、live smoke 凭据发现方式、真实外部消息测试的安全边界。通用验证命令见 `docs/ENGINEERING.md`；飞书消息流架构见 `docs/ARCHITECTURE.md`。

## 分类

- in-process E2E：仓库内模拟外部 provider / runner 的完整链路，例如 `tests/integration/messaging/feishu/e2e.test.ts`。这类测试不需要真实飞书凭据。
- live smoke：真实调用外部平台 API，例如 `tests/live/feishu/message-smoke.test.ts`。这类测试会真的发送消息，消息必须统一带 `[e2e]` 前缀。

## 飞书 Live Smoke

飞书 live smoke 会执行两步：

1. 使用飞书 App 凭据发送一条文本消息。
2. 使用同一 App 凭据读取刚发送的消息，确认真实 API 链路可用。

因此它需要两个信息：

- 目标会话：`FEISHU_LIVE_CHAT_ID`，通常是 `oc_...` 形式的 chat id。
- App 凭据：`appId/appSecret`，来源可以是 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`、runtime 级飞书配置，或 `FEISHU_LIVE_USER_ID` 指向的用户级 IM 配置。

会话 ID 不能替代 App 凭据。会话 ID 只说明发到哪里；发送和读取消息必须由飞书 App 授权。

## 本地凭据发现

不要因为当前 shell 没有 `FEISHU_*` 环境变量就直接判定“没有凭据”。先做只读发现，不打印 secret：

```bash
sqlite3 ~/.cli-claw/db/messages.db \
  "SELECT jid, name, folder, created_by, added_at FROM registered_groups WHERE jid LIKE 'feishu:%' ORDER BY added_at DESC LIMIT 20;"
```

如果查到 `feishu:oc_...`：

- `FEISHU_LIVE_CHAT_ID` 使用去掉 `feishu:` 前缀后的 `oc_...`。
- `FEISHU_LIVE_USER_ID` 优先使用同一行的 `created_by`。
- 用户级飞书配置路径是 `~/.cli-claw/config/user-im/<userId>/feishu.json`。
- runtime 级飞书配置路径是 `~/.cli-claw/config/feishu-provider.json`。

只允许检查是否存在、是否 enabled、是否有 encrypted secret、以及 appId 的短前缀。不要在日志、总结或测试输出里打印 `appSecret` 或解密后的 secret。

可用当前私聊会话时，命令示例：

```bash
FEISHU_LIVE_E2E=1 \
FEISHU_LIVE_USER_ID=<created_by> \
FEISHU_LIVE_CHAT_ID=<oc_chat_id> \
npm test -- tests/live/feishu/message-smoke.test.ts
```

如果目标不是 `oc_...`，再显式设置 `FEISHU_LIVE_RECEIVE_ID_TYPE`，可选值见测试实现。

## 安全边界

- live smoke 会真实发送 `[e2e] ...` 消息。用户已授权默认直接执行真实飞书 E2E；优先使用当前可发现的飞书私聊或测试会话，不再为发送 smoke 消息单独确认。
- 用户明确说“当前会话测试”“没有群”时，可使用当前私聊会话，不要反复要求新凭据或测试群。
- 若只有生产群聊会话，先确认是否允许发 smoke 消息；默认不要往生产群发测试消息。
- 若找不到 chat id 或找不到可用 App 凭据，再向用户说明缺少哪一项。
