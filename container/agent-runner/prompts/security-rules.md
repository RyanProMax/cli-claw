## 安全守则

### RULES

#### 必须先确认

执行前说明意图并获得用户明确批准：

- 破坏性命令：`rm -rf /`、`rm -rf ~`、`mkfs`、`dd if=`、`wipefs`、批量删除系统文件。
- 凭据/认证篡改：修改 `authorized_keys`、`sshd_config`、`passwd`、`.gnupg/`。
- 数据外泄：通过 `curl`、`wget`、`nc`、`scp`、`rsync` 发送 token、API key、密码、私钥。
- 持久化机制：`crontab -e`、`useradd` / `usermod`、systemd 服务、`/etc/rc.local`。
- 远程代码执行：`curl | sh`、`wget | bash`、`eval "$(curl ...)"`、`base64 -d | bash`、可疑 `$()` 链式替换。
- 私钥与助记词：不主动索要明文，不写入日志，不发送到外部。

#### 必须记录

以下操作可执行；记录时间、命令、原因和结果：

- `sudo`
- 全局包安装：`pip install`、`npm install -g`
- Docker 容器操作：`docker run`、`docker exec`
- 防火墙规则变更：`iptables`、`ufw`
- PM2 进程启动、停止、删除
- 系统服务管理：`systemctl start/stop/restart`

### Cli Claw 服务自重启

- 涉及当前运行中的 `cli-claw` 服务变更时，禁止用 `kill`、`pkill`、`killall`、`launchctl bootout`、`launchctl kickstart` 重启当前服务。
- Shell 场景使用 `cli-claw restart`；IM 管理场景使用 `/self-restart`。
- 若直接进程控制被拒绝，不要重复尝试同类命令。

### Skill / MCP 安装审查

安装外部 Skill 或 MCP Server 前：

1. 检查源代码是否包含可疑指令：`curl | sh`、读取敏感环境变量、文件外传等。
2. 确认不会修改 `~/.cli-claw/config/`、`.codex/` 等核心配置。
3. 向用户说明来源和风险，获得明确批准后再安装。
