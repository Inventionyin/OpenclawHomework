# Hermes 双服务器拆分部署说明

这份文档用于把 Hermes 从旧服务器 `38.76.178.91` 拆出来，单独部署到新服务器 `38.76.188.94`。目标是：

```text
旧服务器：
OpenClaw 主服务

新服务器：
Hermes 主服务
```

这样做比两者都塞在一台机器上更稳，原因很直接：

- OpenClaw 的模型会话锁不会再影响 Hermes
- 两个飞书机器人日志分开，排错容易很多
- 以后一个挂了，另一个还活着
- 域名、Nginx、systemd、授权名单都能完全分离

## 1. 推荐拓扑

```text
openclaw.evanshine.me -> 38.76.178.91
hermes.evanshine.me   -> 38.76.188.94
```

旧服务器保留：

```text
OpenClaw UI 自动化助手
Node 桥梁服务
GitHub Actions 调度
```

新服务器部署：

```text
Hermes UI 自动化助手
Node 桥梁服务
GitHub Actions 调度
```

两边都使用同一个 GitHub 仓库代码：

```text
https://github.com/Inventionyin/OpenclawHomework
```

## 2. 当前状态

双服务器已经拆分完成，当前真实状态如下：

- 新服务器 `38.76.188.94` 的 SSH 已打通
- `hermes.evanshine.me` 已解析到新服务器
- 新服务器已部署 `hermes-feishu-bridge`
- 新服务器本机健康检查与 HTTPS 健康检查都通过
- 旧服务器已清理 Hermes 的独立 Nginx 入口
- 旧服务器已清空 Hermes 的飞书凭证占位，恢复为 `OpenClaw-only`

当前推荐直接把这份文档当成“接手说明”使用，不再按最早那套阻塞排查流程走。

## 3. 新服务器部署方式

仓库里已经准备了安装脚本：

```text
scripts/install-hermes-host.sh
```

在新服务器上执行：

```bash
apt-get update
apt-get install -y git
git clone https://github.com/Inventionyin/OpenclawHomework.git /opt/OpenclawHomework
bash /opt/OpenclawHomework/scripts/install-hermes-host.sh
```

这个脚本会做这些事：

- 安装 `git`、`nginx`、`nodejs`、`certbot`
- 拉取 `OpenclawHomework` 仓库
- 安装 Node 依赖
- 创建 Hermes 专用环境文件
- 创建 Hermes 专用 systemd 服务
- 创建 Hermes 专用 Nginx 站点

## 4. 安装后必须补的内容

脚本会生成：

```text
/etc/hermes-feishu-bridge.env
```

里面有几个占位值必须改：

```text
GITHUB_TOKEN=__FILL_ME__
FEISHU_APP_ID=__FILL_HERMES_APP_ID__
FEISHU_APP_SECRET=__FILL_HERMES_APP_SECRET__
HERMES_FEISHU_APP_ID=__FILL_HERMES_APP_ID__
HERMES_FEISHU_APP_SECRET=__FILL_HERMES_APP_SECRET__
```

说明：

- 这里填的是 Hermes 单独那个飞书应用的 `App ID / App Secret`
- 不要把这些值提交到 GitHub
- `GITHUB_TOKEN` 要能触发 `OpenclawHomework` 仓库的 Actions

改完后：

```bash
systemctl restart hermes-feishu-bridge
```

## 5. DNS 与证书

你要把 Hermes 的域名解析到新服务器：

```text
hermes.evanshine.me -> 38.76.188.94
```

OpenClaw 的域名不要动：

```text
openclaw.evanshine.me -> 38.76.178.91
```

DNS 生效后，新服务器上执行：

```bash
certbot --nginx -d hermes.evanshine.me
```

当前线上已经完成到这一步，`https://hermes.evanshine.me/health` 已通过。

## 6. 飞书后台要改什么

Hermes 飞书应用后台的事件订阅 URL 改成：

```text
https://hermes.evanshine.me/webhook/feishu
```

OpenClaw 飞书应用保持旧地址：

```text
https://openclaw.evanshine.me/webhook/feishu/openclaw
```

这样两个机器人就彻底分开了。

## 7. 新服务器验证命令

本机健康检查：

```bash
curl -sS http://127.0.0.1:8788/health
```

公网健康检查：

```bash
curl -sS https://hermes.evanshine.me/health
```

服务状态：

```bash
systemctl status hermes-feishu-bridge --no-pager -l
journalctl -u hermes-feishu-bridge -n 100 --no-pager
```

飞书 challenge：

```bash
curl -sS -X POST https://hermes.evanshine.me/webhook/feishu \
  -H 'Content-Type: application/json' \
  -d '{"challenge":"hermes-check"}'
```

期望返回：

```json
{"challenge":"hermes-check"}
```

watchdog 定时器：

```bash
cd /opt/OpenclawHomework
bash scripts/install-watchdog.sh \
  --unit-name hermes-homework-watchdog \
  --bridge-service hermes-feishu-bridge \
  --env-file /etc/hermes-feishu-bridge.env \
  --state-file /var/lib/hermes-homework-watchdog/state.json

systemctl list-timers '*homework-watchdog*' --no-pager
journalctl -u hermes-homework-watchdog -n 100 --no-pager
```

它会每 5 分钟检查 Hermes 桥梁服务健康状态；健康检查失败时重启服务，并扫描 Nginx access log 里的飞书回调风暴。

## 7.1 Hermes ClawEmail 邮件网关

Hermes 服务器已经额外接入 ClawEmail 邮件通道。注意：这不是当前飞书机器人的生产入口，生产入口仍然是 `hermes-feishu-bridge`。

当前状态：

```text
Hermes 原生邮件网关服务：hermes-gateway.service
ClawEmail 地址：shine1@claw.163.com
Home email：1693457391@qq.com
收信 IMAP：claw.163.com:993
发信 SMTP：claw.163.com:25 + STARTTLS
```

2026-05-04 已使用官方推荐的 `hermes-email-setup.sh --auth-url ... --home-email 1693457391@qq.com` 重新配置，`hermes-gateway.service` 为 user 级服务，当前运行正常。

注意：Hermes 服务器当前有两套 ClawEmail 能力。`hermes-gateway.service` 使用 `shine1@claw.163.com` 作为邮件网关账号，用于收发邮件；`mail-cli` 管理 API 已在 2026-05-04 单独认证，用于管理 ClawEmail 邮箱。不要从 OpenClaw 服务器直接复制 `/root/.config/mail-cli`，该目录里的 `secrets.enc` 与本机 keychain 绑定，跨机器复制会失效。

2026-05-04 已创建的 Hermes ClawEmail 邮箱：

```text
shine1@claw.163.com           primary  shine1
shine1.report@claw.163.com    sub      Hermes Reports
shine1.ui1@claw.163.com       sub      Hermes UI Tests
shine1.github@claw.163.com    sub      Hermes GitHub
shine1.ops@claw.163.com       sub      Hermes Ops
```

OpenClaw 服务器对应的 ClawEmail 邮箱：

```text
watchee@claw.163.com           primary  watchee
watchee.report@claw.163.com    sub      OpenClaw Reports
watchee.ui1@claw.163.com       sub      OpenClaw UI Tests
watchee.github@claw.163.com    sub      OpenClaw GitHub
watchee.ops@claw.163.com       sub      OpenClaw Ops
```

当前 ClawEmail 额度表现为每个主邮箱最多 1 个 primary + 4 个 sub。如果继续创建会返回 `OPEN_API_1004`，除非删除不用的子邮箱或申请提额。

Hermes 额外主邮箱 `hagent@claw.163.com` 已作为监控/审计邮箱组创建：

```text
hagent@claw.163.com            primary  hagent
hagent.monitor@claw.163.com    sub      HAgent Monitor
hagent.logs@claw.163.com       sub      HAgent Logs
hagent.security@claw.163.com   sub      HAgent Security
hagent.backup@claw.163.com     sub      HAgent Backup
```

当前 `mail-cli auth apikey set` 会切换全局 ClawEmail 管理 API key。创建 `hagent` 子邮箱后，已把 Hermes 默认管理 key 切回 `shine1`。以后管理多个主邮箱时，按“临时切 key -> 执行管理动作 -> 切回默认 key”的流程，不要让生产服务依赖临时 key 状态。

检查 Hermes 邮件网关：

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS=unix:path=${XDG_RUNTIME_DIR}/bus
systemctl --user is-active hermes-gateway
systemctl --user status hermes-gateway --no-pager -l
tail -n 100 /root/.hermes/logs/gateway.log
```

如果要重启：

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS=unix:path=${XDG_RUNTIME_DIR}/bus
systemctl --user restart hermes-gateway
```

关键排障点：

- Hermes 邮件适配器使用 STARTTLS，不使用隐式 SSL。
- 当前服务器上 `claw.163.com:25` 可完成 STARTTLS 握手，`claw.163.com:587` 会在 SMTP 握手阶段超时。
- 因此不要随手把 `EMAIL_SMTP_PORT` 改成 `587` 或 `465`。
- `465` 需要 `SMTP_SSL`，而当前 Hermes 官方适配器代码走的是 `SMTP` 后 `starttls()`。
- 如果日志出现 `SMTP connection failed`，先做协议探测，再改端口。

协议探测命令：

```bash
python3 - <<'PY'
import smtplib, ssl
for port in (25, 587):
    print(f"claw.163.com:{port} STARTTLS")
    try:
        smtp = smtplib.SMTP("claw.163.com", port, timeout=12)
        print("EHLO", smtp.ehlo()[0])
        print("STARTTLS", smtp.starttls(context=ssl.create_default_context())[0])
        smtp.quit()
    except Exception as exc:
        print(type(exc).__name__, exc)
PY
```

## 7.2 evanshine.me 自建邮箱核心

Hermes 服务器还部署了 `evanshine.me` 的自建邮箱核心，使用 `docker-mailserver`。这个服务用于后续给 Hermes/OpenClaw/测试报告提供正式域名邮箱身份。

部署信息：

```text
目录：/opt/mailserver
容器：mailserver
主机名：mail.evanshine.me
开放端口：25, 465, 587, 993
证书：Let's Encrypt，/etc/letsencrypt/live/mail.evanshine.me/
账号密码：/root/mailserver-credentials.txt
DNS 清单：/root/evanshine-mail-dns-records.txt
```

已创建邮箱：

```text
admin@evanshine.me
hermes@evanshine.me
openclaw@evanshine.me
ops@evanshine.me
test@evanshine.me
report@evanshine.me
```

常用命令：

```bash
cd /opt/mailserver
docker-compose ps
docker exec mailserver supervisorctl status
docker exec mailserver setup email list
docker logs --tail 120 mailserver
```

添加邮箱：

```bash
cd /opt/mailserver
docker exec mailserver setup email add user@evanshine.me '强密码'
```

删除邮箱前要先备份 `/opt/mailserver/docker-data/dms/mail-data/`，不要随手删。

Cloudflare 必须添加的 DNS 记录见 `/root/evanshine-mail-dns-records.txt`。邮件相关记录全部保持 DNS only / 灰云。

当前验证结果：

```text
QQ -> admin@evanshine.me 收信成功
admin@evanshine.me -> QQ 发信成功过一次
SMTP 587 正式 TLS 证书校验通过
本地域内邮件确认存在 DKIM-Signature
邮件队列已清空
Hermes 飞书桥梁和 Hermes 邮件网关均 active
```

仍需补齐：

```text
PTR 反向解析：38.76.188.94 -> mail.evanshine.me
```

阿里云 2H2G 可以后续作为轻量监控/备份机，不建议部署第二套完整邮件服务器。

## 8. 旧服务器清理动作

旧服务器现在应该只保留 OpenClaw 主链路。

这次实际已经做过的清理包括：

- 下线旧服务器上的 `hermes-feishu-bridge` Nginx 独立站点入口
- 清空旧服务器环境文件里的：
  - `HERMES_FEISHU_APP_ID`
  - `HERMES_FEISHU_APP_SECRET`
  - `HERMES_FEISHU_ALLOWED_USER_IDS`
- 强制关闭旧服务器上的：
  - `HERMES_FALLBACK_ENABLED`
  - `OPENCLAW_CHAT_ENABLED`
  - `FEISHU_GROUP_PASSIVE_REPLY_ENABLED`
  - `FEISHU_AUTOMATION_RECEIPT_ENABLED`
- 保留 `FEISHU_RESULT_NOTIFY_ENABLED=true`
- 重启 `openclaw-feishu-bridge`

如果以后还要复查旧服务器，可以执行：

```bash
systemctl status openclaw-feishu-bridge --no-pager -l
curl -sS https://openclaw.evanshine.me/health
```

备份目录会保留在旧服务器 `root` 目录下，名字类似：

```text
/root/openclaw-split-backup-YYYYMMDD-HHMMSS
```

## 9. 拆分完成后的结果

当前推荐长期结构就是：

```text
38.76.178.91 -> OpenClaw
38.76.188.94 -> Hermes
```

两边现在都能独立运行，后续如果出现问题，也可以分开排查，不会再像之前那样互相串扰。

建议长期保持：

- OpenClaw 服务器只跑 `openclaw-feishu-bridge` 和 `openclaw-homework-watchdog`。
- Hermes 服务器只跑 `hermes-feishu-bridge` 和 `hermes-homework-watchdog`。
- 飞书后台只订阅 `接收消息 im.message.receive_v1`。
- 不要把两个机器人的事件订阅 URL 指向同一台服务器。
