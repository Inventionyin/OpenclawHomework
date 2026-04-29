# AI 接手核云服务器运维手册

这份文档给“完全没有上下文的 AI 助手”使用。目标是让新的 AI 能快速接手核云 Debian 服务器、OpenClaw/Hermes 飞书机器人、GitHub Actions UI 自动化链路，并且知道哪些操作可以做、哪些操作不要做。

请不要把服务器密码、GitHub Token、飞书 App Secret、模型 API Key 写进仓库或聊天总结里。需要时让用户临时提供，或只读取服务器上的安全配置文件。

## 1. 给新 AI 的接手提示词

可以把下面这段直接发给新的 AI：

```text
你正在接手 OpenclawHomework 项目。

本地仓库路径：
D:\OtherProject\OpenclawHomework

GitHub 仓库：
https://github.com/Inventionyin/OpenclawHomework

云服务器：
OpenClaw 服务器：Debian 13，公网 IP 38.76.178.91，SSH 用户 root，端口 22。
Hermes 服务器：Debian 12，公网 IP 38.76.188.94，SSH 用户 root，端口 22。
不要要求用户把密码或 Token 写进仓库；如需登录，请让用户临时提供凭证。

两台服务器部署目录：
/opt/OpenclawHomework

核心服务：
OpenClaw：openclaw-feishu-bridge
Hermes：hermes-feishu-bridge

公网入口：
https://openclaw.evanshine.me/health
https://openclaw.evanshine.me/webhook/feishu/openclaw
https://hermes.evanshine.me/health
https://hermes.evanshine.me/webhook/feishu

当前系统作用：
飞书 OpenClaw/Hermes 机器人接收消息 -> Node 桥梁服务解析指令 -> GitHub API 触发 GitHub Actions -> Actions 拉取电商前端和 UItest -> 执行 UI 自动化 -> 飞书返回报告卡片。

开始接手时先执行：
1. 本地：git status --short --branch && npm test
2. OpenClaw 服务器：systemctl is-active openclaw-feishu-bridge
3. OpenClaw 服务器：curl -sS http://127.0.0.1:8788/health
4. Hermes 服务器：systemctl is-active hermes-feishu-bridge
5. Hermes 服务器：curl -sS http://127.0.0.1:8788/health
6. 两台服务器：cd /opt/OpenclawHomework && git log --oneline -5

注意安全：
- 不要执行 git reset --hard，除非用户明确同意。
- 不要开放任意 shell 给飞书机器人。
- 不要把 /etc/openclaw-feishu-bridge.env 或 /etc/hermes-feishu-bridge.env 的秘密值贴到最终回复。
- 做代码修改后必须运行 npm test。
```

## 2. 当前架构

```text
飞书 OpenClaw 机器人
  -> https://openclaw.evanshine.me/webhook/feishu/openclaw
  -> 38.76.178.91 Nginx
  -> Node 桥梁服务 127.0.0.1:8788
  -> OpenClaw 主服务
  -> GitHub Actions
  -> UI 自动化报告
  -> 飞书结果卡片

飞书 Hermes 机器人
  -> https://hermes.evanshine.me/webhook/feishu
  -> 38.76.188.94 Nginx
  -> Node 桥梁服务 127.0.0.1:8788
  -> Hermes 主服务
  -> GitHub Actions
  -> UI 自动化报告
  -> 飞书结果卡片
```

关键点：

- OpenClaw 和 Hermes 已经拆成两台核云服务器。
- 两个机器人使用不同飞书 App 凭证和不同 systemd 服务。
- 两个机器人有独立触发授权名单和独立环境文件。
- 飞书事件建议只保留 `接收消息 im.message.receive_v1`，不要订阅 `消息已读 im.message.message_read_v1`。
- 机器人收到自动化指令后，先回复“收到了，正在运行 UI 自动化测试。报告生成后我会发给你。”，最终只发一次报告卡片。

## 3. 服务器信息

OpenClaw 服务器：

```text
系统：Debian GNU/Linux 13
公网 IP：38.76.178.91
SSH 用户：root
SSH 端口：22
项目目录：/opt/OpenclawHomework
Node 服务端口：127.0.0.1:8788
systemd 服务：openclaw-feishu-bridge
域名：openclaw.evanshine.me
```

Hermes 服务器：

```text
系统：Debian GNU/Linux 12
公网 IP：38.76.188.94
SSH 用户：root
SSH 端口：22
项目目录：/opt/OpenclawHomework
Node 服务端口：127.0.0.1:8788
systemd 服务：hermes-feishu-bridge
域名：hermes.evanshine.me
```

不要在文档里记录 root 密码。新的 AI 需要登录时，让用户临时提供，或使用用户当前会话已有的安全连接能力。

## 4. 代码仓库

```text
GitHub：https://github.com/Inventionyin/OpenclawHomework
本地路径：D:\OtherProject\OpenclawHomework
服务器路径：两台服务器都是 /opt/OpenclawHomework
```

主要文件：

```text
scripts/feishu-bridge.js          飞书 Webhook 桥梁服务
scripts/trigger-ui-tests.js       GitHub Actions 触发脚本
tests/feishu-bridge.test.js       飞书桥梁服务测试
.github/workflows/ui-tests.yml    UI 自动化 GitHub Actions 工作流
docs/云服务器接手说明.md          更详细的服务器说明
docs/飞书桥梁服务使用说明.md      飞书桥梁功能说明
```

## 5. 环境变量和秘密配置

服务器环境文件：

```text
OpenClaw：/etc/openclaw-feishu-bridge.env
Hermes：/etc/hermes-feishu-bridge.env
```

这个文件包含 GitHub Token、飞书 App Secret、模型 API Key 等秘密信息。只允许在服务器上读取和修改，不要复制到 GitHub，不要贴到最终回复。

常见键名：

```text
PORT=8788
GITHUB_OWNER=Inventionyin
GITHUB_REPO=OpenclawHomework
GITHUB_WORKFLOW_ID=ui-tests.yml
GITHUB_TOKEN=...

FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_ALLOWED_USER_IDS=...

HERMES_FEISHU_APP_ID=...
HERMES_FEISHU_APP_SECRET=...
HERMES_FEISHU_ALLOWED_USER_IDS=...

OPENCLAW_PARSE_ENABLED=true
OPENCLAW_CHAT_ENABLED=true
OPENCLAW_MODEL=xfyun/astron-code-latest

HERMES_FALLBACK_ENABLED=true
HERMES_BIN=hermes
HERMES_PROVIDER=custom
HERMES_MODEL=astron-code-latest

FEISHU_RESULT_NOTIFY_ENABLED=true
FEISHU_CARD_ENABLED=true
FEISHU_WEBHOOK_ASYNC=true
FEISHU_REQUIRE_BINDING=true
FEISHU_ENV_FILE=/etc/openclaw-feishu-bridge.env
FEISHU_DEDUP_ENABLED=true
FEISHU_DEDUP_TTL_MS=300000
FEISHU_RUN_NOTIFICATION_DEDUP_TTL_MS=300000
```

修改后重启对应服务器上的服务：

```bash
systemctl restart openclaw-feishu-bridge
# 或
systemctl restart hermes-feishu-bridge
```

## 6. 首次接手检查清单

本地检查：

```powershell
cd D:\OtherProject\OpenclawHomework
git status --short --branch
npm test
git log --oneline -5
```

OpenClaw 服务器检查：

```bash
systemctl is-active openclaw-feishu-bridge
curl -sS http://127.0.0.1:8788/health
systemctl status openclaw-feishu-bridge --no-pager -l
journalctl -u openclaw-feishu-bridge -n 100 --no-pager
cd /opt/OpenclawHomework
git status --short --branch
git log --oneline -5
```

Hermes 服务器检查：

```bash
systemctl is-active hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
systemctl status hermes-feishu-bridge --no-pager -l
journalctl -u hermes-feishu-bridge -n 100 --no-pager
cd /opt/OpenclawHomework
git status --short --branch
git log --oneline -5
```

公网检查：

```bash
curl -sS https://openclaw.evanshine.me/health
curl -sS https://hermes.evanshine.me/health
```

飞书 challenge 检查：

```bash
curl -sS -X POST https://openclaw.evanshine.me/webhook/feishu/openclaw \
  -H 'Content-Type: application/json' \
  -d '{"challenge":"openclaw-check"}'

curl -sS -X POST https://hermes.evanshine.me/webhook/feishu \
  -H 'Content-Type: application/json' \
  -d '{"challenge":"hermes-check"}'
```

期望返回：

```json
{"challenge":"openclaw-check"}
```

或：

```json
{"challenge":"hermes-check"}
```

## 7. 常用运维命令

OpenClaw 服务状态：

```bash
systemctl status openclaw-feishu-bridge --no-pager -l
systemctl is-active openclaw-feishu-bridge
```

Hermes 服务状态：

```bash
systemctl status hermes-feishu-bridge --no-pager -l
systemctl is-active hermes-feishu-bridge
```

重启服务：

```bash
systemctl restart openclaw-feishu-bridge
systemctl restart hermes-feishu-bridge
```

查看日志：

```bash
journalctl -u openclaw-feishu-bridge -n 100 --no-pager
journalctl -u openclaw-feishu-bridge -f
journalctl -u hermes-feishu-bridge -n 100 --no-pager
journalctl -u hermes-feishu-bridge -f
```

检查 OpenClaw 旧服务器 watchdog：

```bash
systemctl list-timers openclaw-hermes-watchdog.timer --no-pager
journalctl -u openclaw-hermes-watchdog -n 100 --no-pager
openclaw-hermes-doctor check
openclaw-hermes-doctor smoke
```

检查 Nginx：

```bash
nginx -t
systemctl status nginx --no-pager -l
systemctl reload nginx
```

查看 Nginx 配置：

```bash
# OpenClaw 服务器
cat /etc/nginx/sites-available/openclaw-feishu-bridge

# Hermes 服务器
cat /etc/nginx/sites-available/hermes-feishu-bridge
```

## 8. 部署流程

推荐流程是先在本地修改、测试、提交，再部署到服务器。

本地：

```powershell
cd D:\OtherProject\OpenclawHomework
npm test
git diff --check
git status --short
git add <changed-files>
git commit -m "说明本次修改"
git push origin main
```

OpenClaw 服务器：

```bash
cd /opt/OpenclawHomework
git fetch origin main
git merge --ff-only origin/main
npm test
systemctl restart openclaw-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

Hermes 服务器：

```bash
cd /opt/OpenclawHomework
git fetch origin main
git merge --ff-only origin/main
npm test
systemctl restart hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

如果本地到 GitHub 网络不通，可以让服务器使用临时 GitHub Token 推送。注意不要把 Token 写入命令历史或日志；用完后建议用户撤销临时 Token。

## 9. 飞书机器人操作

OpenClaw 机器人：

```text
你好
绑定我
/run-ui-test main smoke
帮我跑一下 main 分支的 UI 自动化冒烟测试
```

Hermes 机器人：

```text
你好
绑定我
/run-ui-test main smoke
帮我跑一下 main 分支的 UI 自动化冒烟测试
```

说明：

- `绑定我` 会把当前飞书用户写入对应机器人的授权名单。
- OpenClaw 使用 `FEISHU_ALLOWED_USER_IDS`。
- Hermes 使用 `HERMES_FEISHU_ALLOWED_USER_IDS`。
- 同一个人在两个飞书应用里的 `open_id` 可能不同，所以两个机器人要分别绑定。

## 10. GitHub Actions UI 自动化

工作流文件：

```text
.github/workflows/ui-tests.yml
```

当前思路：

```text
OpenclawHomework workflow_dispatch
  -> 拉取 Inventionyin/UItest
  -> 拉取 dengzhekun/projectku-web
  -> 启动电商前端
  -> 执行 UI 自动化
  -> 上传 Playwright / Allure artifact
  -> 飞书返回 GitHub Actions 和报告链接
```

手动测试入口：

```text
https://github.com/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml
```

## 11. 常见问题和处理

### 11.1 飞书重复回两次

现有机制：

- `FEISHU_DEDUP_ENABLED=true` 会忽略短时间重复投递的同一飞书事件。
- `FEISHU_RUN_NOTIFICATION_DEDUP_TTL_MS=300000` 会避免同一聊天、同一分支、同一模式的报告 5 分钟内重复发送。
- 飞书后台只保留 `接收消息 im.message.receive_v1`；不要订阅 `消息已读 im.message.message_read_v1`。

如果仍重复，检查：

```bash
journalctl -u openclaw-feishu-bridge -n 200 --no-pager | grep -Ei 'duplicate|notification|workflow|Feishu'
journalctl -u hermes-feishu-bridge -n 200 --no-pager | grep -Ei 'duplicate|notification|workflow|Feishu'
```

### 11.2 Hermes 显示已绑定但仍说未授权

已修复过一次。检查：

```bash
grep -E '^(FEISHU_ALLOWED_USER_IDS|HERMES_FEISHU_ALLOWED_USER_IDS|FEISHU_REQUIRE_BINDING)=' /etc/hermes-feishu-bridge.env
systemctl restart hermes-feishu-bridge
```

不要把输出里的真实 ID 贴到公开文档。

### 11.3 OpenClaw/Hermes 身份串了

后端现在按飞书事件 `app_id` 优先判断机器人身份。检查两个飞书后台的事件订阅 URL：

```text
OpenClaw：https://openclaw.evanshine.me/webhook/feishu/openclaw
Hermes：https://hermes.evanshine.me/webhook/feishu
```

### 11.4 普通聊天报 Missing Feishu receive id

这通常发生在飞书推送了非消息事件，或者事件里没有 `chat_id` / `sender_id`。当前代码已经忽略 `im.message.message_read_v1`，飞书后台也建议删除“消息已读”事件。排查：

```bash
journalctl -u openclaw-feishu-bridge -n 200 --no-pager | grep 'Missing Feishu receive id'
journalctl -u hermes-feishu-bridge -n 200 --no-pager | grep 'Missing Feishu receive id'
```

如果仍出现，先确认飞书后台只订阅 `接收消息 im.message.receive_v1`。

### 11.5 OpenClaw session file locked

现象：

```text
session file locked
```

通常是 OpenClaw 同时处理多个模型请求导致锁冲突。短期处理：

```bash
systemctl restart openclaw-feishu-bridge
```

如果频繁出现，建议：

- 普通聊天优先走 Hermes。
- 给 OpenClaw 调用加队列或并发锁。
- 减少飞书重复投递造成的并发模型调用。

### 11.6 GitHub Actions 没触发

检查：

```bash
journalctl -u openclaw-feishu-bridge -n 100 --no-pager
grep -E 'GITHUB_OWNER|GITHUB_REPO|GITHUB_WORKFLOW_ID|GITHUB_REF_NAME' /etc/openclaw-feishu-bridge.env
```

在 GitHub 页面检查：

```text
https://github.com/Inventionyin/OpenclawHomework/actions
```

## 12. 安全边界

可以允许机器人做的服务器操作：

```text
/server status
/server health
/server logs
/server doctor
/server smoke
/server restart bridge
/server deploy
```

不要允许机器人做的操作：

```text
任意 shell 执行
任意 rm/mv/chmod/chown
读取并回显 /etc/openclaw-feishu-bridge.env
修改 SSH 配置
修改防火墙开放全部端口
把 root 密码或 Token 发到飞书
```

如果未来做“OpenClaw 和 Hermes 互修服务器”，推荐使用白名单脚本，而不是开放 root shell：

```text
OpenClaw 只能调用 /usr/local/sbin/openclaw-hermes-doctor check/smoke/restart-bridge
Hermes 只能调用同样的白名单维护脚本
```

## 13. 未来双服务器方案

当前已经是双服务器方案：

```text
服务器 A：38.76.178.91
openclaw.evanshine.me
OpenClaw 主服务

服务器 B：38.76.188.94
hermes.evanshine.me
Hermes 主服务
```

互修方式：

```text
OpenClaw 可以检查/重启 Hermes 服务器的桥梁服务
Hermes 可以检查/重启 OpenClaw 服务器的桥梁服务
```

安全要求：

- 两台服务器互相使用专用低权限 SSH key。
- SSH key 只允许执行固定维护脚本。
- 不允许任意命令。
- 两台服务器都从 GitHub 拉取同一个仓库部署。
- 两台服务器都配置 watchdog。

## 14. 交接给新 AI 时要让它先回答的问题

新 AI 接手后，不要立刻乱改服务器。先让它回答：

1. 当前服务是否 active？
2. `/health` 是否正常？
3. 本地和服务器分别是哪一个 Git commit？
4. 最近 100 行日志有没有 `failed`、`error`、`session file locked`？
5. OpenClaw 和 Hermes 的飞书回调 URL 是否分开？
6. 当前要解决的是“自动化触发问题”“飞书回复问题”“模型聊天问题”还是“服务器部署问题”？
7. 修改前准备加什么测试？

如果它答不上来，说明它还没真正接手，不要让它直接改服务器。
