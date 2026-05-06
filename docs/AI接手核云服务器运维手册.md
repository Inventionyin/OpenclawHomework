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

如果域名解析异常，先用服务器本机 health 判断服务是否存活，再检查 DNS。不要把“域名解析不到”和“桥梁服务挂了”混为一谈。

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
- 两台服务器现在配置了受限互修通道：OpenClaw 可以通过白名单 SSH forced command 操作 Hermes，Hermes 可以通过同样方式操作 OpenClaw。这个通道不是共享数据库，也不是任意 shell。
- 飞书事件建议只保留 `接收消息 im.message.receive_v1`，不要订阅 `消息已读 im.message.message_read_v1`。
- 机器人收到自动化指令后，先回复“收到了，正在运行 UI 自动化测试。报告生成后我会发给你。”，最终只发一次报告卡片。
- 飞书消息先经过轻量 Agent Router，再决定是聊天、触发 UI 测试、查看运维状态、回答文档问题，还是读取/写入安全记忆。
- 生态插件和 skill 现在通过 `scripts/ecosystem-manager.js` 管理。可信项自动安装，候选项只登记和提示，不把第三方脚本直接接管生产服务。

生态技能检查：

```bash
cd /opt/OpenclawHomework
npm run ecosystem:status
npm run ecosystem:maintenance
systemctl list-timers '*ecosystem-maintenance*' --no-pager
```

当前生态策略见：

```text
docs/Hermes生态技能与高级玩家路线.md
```

## 2.1 2026-05-02 官方组件版本记录

最后核验时间：2026-05-02。

作业桥梁服务：

```text
OpenClaw 服务器 /opt/OpenclawHomework：757276b，工作区干净，openclaw-feishu-bridge active，/health 正常。
Hermes 服务器 /opt/OpenclawHomework：757276b，工作区干净，hermes-feishu-bridge active，/health 正常。
```

官方 CLI/Agent：

```text
OpenClaw 服务器：Node v22.22.2，OpenClaw 2026.4.29 (a448042)
OpenClaw 服务器：Hermes Agent v0.12.0 (2026.4.30)，/usr/local/lib/hermes-agent commit f98b5d00a
Hermes 服务器：Hermes Agent v0.12.0 (2026.4.30)，/usr/local/lib/hermes-agent commit f98b5d00a
```

OpenClaw 更新经验：`2026.4.29` 依赖较大，本地短超时安装会误判为失败；Yarn v1 会因为依赖链中的 `workspace:^` 报错，不建议用 Yarn 安装。先用 npm 在临时目录长超时验证安装，再全局安装。OpenClaw 新依赖 `undici@8.1.0` 要求 Node `>=22.19.0`，OpenClaw 服务器已先升级到 Node `v22.22.2` 后再升级 OpenClaw。

Hermes 官方更新已完成。`hermes update` 后如果 `/usr/local/lib/hermes-agent/ui-tui/package-lock.json` 出现纯 lockfile 脏改，可以先备份该文件，再恢复到 git 版本，避免影响下次官方更新。

## 2.2 2026-05-04 ClawEmail 接入状态

最后核验时间：2026-05-04。

ClawEmail 是新增的邮件通道，不替代当前生产中的飞书桥梁链路。当前生产链路仍然是：

```text
飞书机器人 -> Node 桥梁服务 -> GitHub Actions -> 飞书结果卡片 / QQ 邮件通知
```

当前 ClawEmail 状态：

```text
OpenClaw 服务器：
- 已安装 @clawemail/mail-cli，版本 0.2.4
- 已安装 @clawemail/claw-setup，版本 0.3.2
- mail-cli 已完成认证
- 当前 mail-cli default profile 为 watchee@claw.163.com
- 2026-05-04 曾误在 OpenClaw 服务器执行给 Hermes 准备的 `claw-setup --auth-url ...`，导致 OpenClaw 临时切到 `shine1@claw.163.com`。已从 `/root/.openclaw/openclaw.json.bak` 恢复回 `watchee@claw.163.com`，并用 watchee 的 API key 重新设置 `mail-cli auth apikey`。

Hermes 服务器：
- 已安装 @clawemail/mail-cli，版本 0.2.4
- 已安装 @clawemail/claw-setup，版本 0.3.2
- 2026-05-04 已通过 hermes-email-setup.sh 重新配置 Hermes 原生邮件网关
- hermes-gateway.service 已启用并运行
- Hermes 邮件网关使用 shine1@claw.163.com
- Hermes 邮件网关 home email 为 1693457391@qq.com
- 2026-05-04 已在 Hermes 侧执行 `mail-cli auth apikey set <key>`，mail-cli 管理 API 已认证
- Hermes 侧 `mail-cli clawemail list` 当前返回 shine1@claw.163.com；master user 为 1693457391@qq.com
```

重要区分：

- `mail-cli` 是 ClawEmail 的命令行工具，OpenClaw 服务器已认证。
- `hermes-gateway.service` 是 Hermes 官方原生消息网关，Hermes 服务器当前用它接入 ClawEmail。
- OpenClaw 和 Hermes 使用不同的 ClawEmail 地址：OpenClaw 为 `watchee@claw.163.com`，Hermes 为 `shine1@claw.163.com`。
- Hermes 的 `mail-cli` 管理 API 已认证，可以执行 `mail-cli clawemail list/create` 一类管理命令；当前管理 API 和 `hermes-gateway.service` 邮件网关都对应 `shine1@claw.163.com`。
- 不要尝试直接把 OpenClaw 的 `/root/.config/mail-cli` 复制到 Hermes。`secrets.enc` 与本机 keychain 绑定，跨机器复制会报 `KEYCHAIN_ERROR`。
- 不要为了配置 Hermes 而在 OpenClaw 服务器上执行新的 `claw-setup --auth-url ...`；那会切换 OpenClaw 的邮箱账号。Hermes 邮件网关只在 Hermes 服务器执行 `hermes-email-setup.sh`。

OpenClaw 服务器检查命令：

```bash
mail-cli auth test
mail-cli clawemail list
systemctl is-active openclaw-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

Hermes 服务器检查命令：

```bash
systemctl --user is-active hermes-gateway
systemctl --user status hermes-gateway --no-pager -l
tail -n 100 /root/.hermes/logs/gateway.log
systemctl is-active hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

Hermes 邮件网关的关键配置在：

```text
/root/.hermes/config.yaml
/root/.hermes/.env
/root/.config/systemd/user/hermes-gateway.service
```

排障经验：

- 这里说的是 `hermes-gateway.service` 这条 Hermes 原生邮件网关链路，不是 `hermes-feishu-bridge` 飞书桥服务。
- `hermes-gateway.service` 的官方适配器仍按 STARTTLS 语境排查；如果它循环重启，先看 `/root/.hermes/logs/gateway.log`。
- `hermes-feishu-bridge` 的日报/报告发信已经在 2026-05-06 切到 ClawEmail SMTP：`claw.163.com:465` + `SMTP_SECURE=true`，发件人 `shine1@claw.163.com`。
- 如果 `hermes-gateway.service` 循环重启，先看 `/root/.hermes/logs/gateway.log` 里的 IMAP/SMTP 错误，不要先怀疑模型。
- 如果网关因为邮件连接失败反复重启，生产飞书桥梁服务通常不受影响；优先确认 `hermes-feishu-bridge` 和 `/health`。

## 2.3 2026-05-03 evanshine.me 自建邮箱系统

Hermes 服务器已经部署轻量自建邮箱核心，使用 `docker-mailserver`，不影响 OpenClaw 服务器。

当前状态：

```text
服务器：Hermes 服务器 38.76.188.94
部署目录：/opt/mailserver
容器名：mailserver
镜像：ghcr.io/docker-mailserver/docker-mailserver:latest
邮件主机名：mail.evanshine.me
域名：evanshine.me
已启用端口：25, 465, 587, 993
证书：Let's Encrypt，路径 /etc/letsencrypt/live/mail.evanshine.me/
证书到期：2026-08-01
账号密码：/root/mailserver-credentials.txt，权限 600，不要复制到仓库
DNS 清单：/root/evanshine-mail-dns-records.txt，权限 600
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

当前在本项目里的职责建议：

```text
ClawEmail mailbox action -> 任务入口、验证码、业务动作邮箱、归档收件
Hermes ClawEmail SMTP    -> Hermes 飞书桥服务默认发信身份，shine1@claw.163.com
OpenClaw QQ SMTP         -> OpenClaw 飞书桥服务当前保底发信身份
evanshine.me SMTP        -> 品牌域名发件身份储备，暂不强制生产启用
```

如果桥梁服务环境里配置了 `REPORT_SMTP_*` 和 `MAIL_ACTION_PROVIDER_OVERRIDES=report=evanshine,daily=evanshine`，那么 `report` / `daily` 会先尝试走 `mail.evanshine.me`，失败时自动回退默认 SMTP；飞书结果通知主链路不受影响。

服务器检查命令：

```bash
cd /opt/mailserver
docker-compose ps
docker ps --filter name=mailserver
docker exec mailserver supervisorctl status
docker exec mailserver setup email list
for a in admin hermes openclaw ops test report; do docker exec mailserver doveadm user "$a@evanshine.me"; done
```

端口检查：

```bash
for p in 25 465 587 993; do timeout 5 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/$p" && echo "$p OK" || echo "$p FAIL"; done
```

Cloudflare DNS 必须添加：

```text
A     mail              38.76.188.94       DNS only / 灰云
MX    @                 mail.evanshine.me  priority 10
TXT   @                 v=spf1 mx -all
TXT   mail._domainkey   见 /root/evanshine-mail-dns-records.txt
TXT   _dmarc            v=DMARC1; p=none; rua=mailto:admin@evanshine.me; adkim=s; aspf=s
```

还需要在核云或服务器商后台设置 PTR 反向解析：

```text
38.76.188.94 -> mail.evanshine.me
```

注意：

- Cloudflare 上邮件相关记录全部用灰云，不要橙云。
- 当前只部署邮件核心，没有部署 Webmail。
- `mail.evanshine.me` 的 A/MX/SPF/DKIM/DMARC 已配置并验证过。
- QQ 邮箱发到 `admin@evanshine.me` 已成功收信。
- `admin@evanshine.me` 发到 QQ 已成功过一次，后续一次测试遇到 QQ MX 25 连接超时，队列已清空。这属于对端或网络临时投递问题，不是本机队列残留。
- DKIM 签名已改由 Rspamd 处理，已在本地域内投递邮件头中确认 `DKIM-Signature` 存在。
- 邮件队列应保持空：`docker exec mailserver postqueue -p`。
- 当前唯一未完成的邮件信誉项是 PTR 反向解析：`38.76.188.94 -> mail.evanshine.me`。
- 邮件系统出问题时，先确认 `hermes-feishu-bridge` 和 `hermes-gateway` 是否仍正常，避免把邮件容器问题误判为 Hermes 主链路问题。

## 2.4 2026-05-06 邮件链路现状与推荐矩阵

当前两台桥梁服务都已经升级到支持 `REPORT_SMTP_*` 和 `MAIL_ACTION_PROVIDER_OVERRIDES` 的版本：

```text
OpenClaw 服务器 38.76.178.91 -> 801ef6e 或更新
Hermes   服务器 38.76.188.94 -> 801ef6e 或更新
```

实际联调结论：

- OpenClaw：默认 QQ SMTP 真实发 `report` 成功，SMTP 返回 `250 OK: queued as.`
- OpenClaw：`daily` 调用链路无报错，桥梁服务健康正常
- Hermes：2026-05-06 已把 `hermes-feishu-bridge` 默认 SMTP 切到 `shine1@claw.163.com`，`claw.163.com:465`，`SMTP_SECURE=true`
- Hermes：已通过桥服务 `sendDailySummaryNotification` 真实发送到 `1693457391@qq.com`，同时归档到 `agent4.daily@claw.163.com`
- Hermes：`report@evanshine.me` 可成功通过 `mail.evanshine.me:587` 认证登录
- Hermes：当 `daily/report` 强制走 `evanshine.me` 第二 SMTP，并继续投递到 `claw.163.com` 收件域时，邮件会卡在自建邮局外发队列，错误表现为连接对端 MX `25` 端口超时
- 因此当前生产推荐是：OpenClaw 继续 QQ SMTP 兜底，Hermes 使用 ClawEmail 465 作为机器人自己的发件身份；`evanshine.me` 先保留为第二 SMTP 能力储备，不强制覆盖

推荐矩阵：

| 用途 | 推荐通道 | 当前是否可用 | 风险 / 备注 |
| --- | --- | --- | --- |
| OpenClaw `report` / `daily` | QQ SMTP | 可用 | 当前保持稳定兜底 |
| Hermes `report` / `daily` | ClawEmail SMTP 465 | 可用 | 发件人 `shine1@claw.163.com`，已真实发到 QQ |
| `report` 品牌域名发件身份 | `evanshine.me` 第二 SMTP | 部分可用 | 应用到自建邮局这一步是通的；继续向 `claw.163.com` 外发会受目标 MX `25` 连接影响 |
| `daily` 品牌域名发件身份 | `evanshine.me` 第二 SMTP | 暂不建议生产启用 | 同上，当前测试到 `agent4.daily@claw.163.com` 会在自建邮局外发阶段超时 |
| `verify` 注册 / 验证码 | ClawEmail mailbox action | 可用 | 用 `evasan.verify@claw.163.com`；这是收件 / 动作入口，不依赖 `evanshine.me` |
| `files` 附件 / artifact | ClawEmail mailbox action | 可用 | `agent3.files@claw.163.com`，只做收件与归档提示 |
| `archive` 归档 / 训练样本 | ClawEmail mailbox action | 可用 | `agent3.archive@claw.163.com`，不建议改到外部 SMTP |
| `account` / `shop` / `support` 业务动作 | ClawEmail mailbox action | 可用 | 继续按动作邮箱收件，不建议为了品牌域名去强制改发件通道 |
| QQ 外部收件测试 | QQ SMTP / Hermes ClawEmail SMTP | 可用 | Hermes ClawEmail 465 已真实发到 QQ；OpenClaw QQ SMTP 继续兜底 |
| `evanshine.me` 域内收件 | 自建邮箱系统 | 可用 | 自建域内投递正常，适合内部品牌邮箱、测试和身份储备 |

操作建议：

```text
短期生产：OpenClaw 保持 QQ SMTP；Hermes 使用 shine1@claw.163.com 的 ClawEmail SMTP 465
中期优化：为 evanshine.me 增加专业 SMTP 中继 / smarthost，再考虑把 report/daily 改回品牌域名发件
长期观察：补齐 PTR，持续观察自建邮局直投外部域的稳定性，但不要把 PTR 当成短期必然修复手段
```

阿里云 2H2G 服务器建议只做轻量辅助，不建议跑第二套完整邮件服务器。适合的用途：

```text
1. 每 5 分钟探测 mail.evanshine.me:25/587/993 和 https://hermes.evanshine.me/health
2. 失败时发 QQ 邮件或飞书告警
3. 每天拉取 /opt/mailserver/docker-data/dms/config 和非敏感运维状态备份
4. 作为临时跳板机测试不同网络到邮件服务器的连通性
```

如果要启用阿里云辅助，需要用户提供阿里云服务器 SSH 信息，或在阿里云上创建只允许跑监控/备份脚本的低权限用户。

## Agent Router 和记忆

当前桥梁服务采用轻量 Agent Router：

```text
飞书消息
  -> Router
  -> chat/ui-test/ops/doc/memory agent
  -> 白名单工具或安全回复
```

它不是把 OpenClaw/Hermes CLI 开成多个并发进程，而是在同一个 Node 桥梁服务内做逻辑分流。这样可以减少 session file locked、重复回复和误触发 GitHub Actions 的风险。

记忆文件在：

```text
data/memory/
```

技能说明在：

```text
docs/skills/
```

新 AI 接手时可以先读：

```text
data/memory/user-profile.json
data/memory/project-state.json
data/memory/incident-log.md
data/memory/runbook-notes.md
docs/skills/ui-automation.md
docs/skills/server-ops.md
docs/skills/feishu-debug.md
docs/skills/handoff.md
docs/Agent玩法与二改优化路线.md
```

安全规则：

- 记忆文件只能保存非敏感事实。
- 不要把服务器密码、Token、App Secret、模型 API Key 写入记忆。
- 普通聊天默认不携带完整记忆。
- 支持 `/memory search 关键词` 检索非敏感记忆，适合先查历史故障再动手。
- `帮助`、`你会做什么`、`怎么玩` 会返回当前能力玩法菜单。
- `ui-test-agent`、`ops-agent`、`doc-agent`、`memory-agent` 都需要授权用户。
- `ops-agent` 支持 `/peer-status`、`/peer-health`、`/peer-logs`、`/peer-restart`、`/peer-repair`。这些命令只会走受限 peer-control 白名单，不能执行任意 shell。
- 群聊里没有 @ 机器人时，普通聊天、文档和记忆问题默认忽略，避免把项目状态发到群里。
- 群聊未 @ 时，只允许明确的 UI 测试触发、显式运维命令和 `绑定我` 这类必要指令通过。
- 否定句或教程句里的 `/run-ui-test` 不会触发 GitHub Actions。

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
GITHUB_TOKEN 在服务器环境文件中配置，检查时不要回显真实值

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
HERMES_MODEL=LongCat-Flash-Chat

PEER_NAME=对端名称
PEER_SSH_HOST=对端服务器 IP
PEER_SSH_USER=root
PEER_SSH_PORT=22
PEER_SSH_KEY=/root/.ssh/对应的 peer 私钥

FEISHU_RESULT_NOTIFY_ENABLED=true
FEISHU_CARD_ENABLED=true
FEISHU_WEBHOOK_ASYNC=true
FEISHU_REQUIRE_BINDING=true
FEISHU_ENV_FILE=/etc/openclaw-feishu-bridge.env
FEISHU_DEDUP_ENABLED=true
FEISHU_DEDUP_TTL_MS=300000
FEISHU_RUN_NOTIFICATION_DEDUP_TTL_MS=300000

FEISHU_CHAT_STREAMING_ENABLED=true
STREAMING_MODEL_BASE_URL=https://api.longcat.chat/openai/v1
STREAMING_MODEL_API_KEY=...
STREAMING_MODEL_API_KEYS=主 key,备用 key
STREAMING_MODEL_ID=LongCat-Flash-Chat
STREAMING_MODEL_SIMPLE_ID=LongCat-Flash-Lite
STREAMING_MODEL_THINKING_ID=LongCat-Flash-Thinking-2601
STREAMING_MODEL_ENDPOINT_MODE=chat_completions
FEISHU_STREAM_UPDATE_INTERVAL_MS=800
FEISHU_USAGE_LEDGER_ENABLED=true
FEISHU_USAGE_LEDGER_PATH=/var/log/openclaw-homework/usage-ledger.jsonl

TOKEN_FACTORY_TASK_DIR=/opt/OpenclawHomework/data/tasks/token-factory
TOKEN_FACTORY_STALE_MS=1800000

EMAIL_NOTIFY_ENABLED=true
SMTP_HOST=claw.163.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=shine1@claw.163.com
SMTP_PASS=ClawEmail 邮箱密码或授权码
EMAIL_FROM=shine1@claw.163.com
EMAIL_TO=收件邮箱，多个用逗号分隔

REPORT_SMTP_HOST=mail.evanshine.me
REPORT_SMTP_PORT=587
REPORT_SMTP_SECURE=false
REPORT_SMTP_USER=report@evanshine.me
REPORT_SMTP_PASS=自建邮箱密码
REPORT_EMAIL_FROM=report@evanshine.me
MAIL_ACTION_PROVIDER_OVERRIDES=report=evanshine,daily=evanshine
```

互修通道说明：

- 对端 `authorized_keys` 使用 `command="..."` 强制运行 `node /opt/OpenclawHomework/scripts/peer-control.js`。
- 允许动作只有 `status`、`health`、`logs`、`restart`、`repair`。
- `repair` 会在对端执行：`git pull --ff-only`、`npm test`、重启对端桥梁服务、检查 `/health`。
- 不要把这个通道改成普通无限制 root SSH，除非用户明确要求并理解风险。
- 邮件通知在 GitHub Actions 完成后由桥梁服务发送。Hermes 当前默认 SMTP 是 ClawEmail 465；OpenClaw 当前默认 SMTP 是 QQ。若配置了 `evanshine.me` 第二 SMTP，则 `report` / `daily` 会先尝试第二 SMTP，再回退默认 SMTP；只有两边都失败时才记最终邮件失败日志，不应阻断飞书报告。
- SMTP 密码或授权码只放服务器环境文件，不要写入仓库。

流式回复说明：

- 只用于普通聊天，不用于 UI 自动化、服务器修复、`/status` 等确定性命令。
- token/耗时账本在 `/var/log/openclaw-homework/usage-ledger.jsonl`。每行是一次普通聊天的 JSON，包含 assistant、agent、model、tier、endpoint、耗时和 token，不包含密钥。
- Hermes 当前主文本链路已经切到 LongCat，推荐固定使用 `STREAMING_MODEL_ENDPOINT_MODE=chat_completions`。
- OpenClaw 仍使用讯飞 CodingPlan；如果以后给 OpenClaw 单独开流式，再保留讯飞自己的 streaming 配置。
- 飞书更新依赖 `PATCH /im/v1/messages/{message_id}`，如果权限不足，会自动退回一次性回复。

当前推荐模型分工：

```text
OpenClaw 主链路：讯飞 CodingPlan
Hermes 正常聊天：LongCat-Flash-Chat
Hermes 简单任务：LongCat-Flash-Lite
Hermes 复杂分析：LongCat-Flash-Thinking-2601
```

自然语言模型/Key 切换：

```text
切换聊天模型通道 url: https://api.longcat.chat/openai/v1 key: ak_... model: LongCat-Flash-Chat
```

桥梁服务会先按置信度判断：只有明确说“切换/更新/配置聊天模型通道”并同时给出 URL 和 Key，才会写入 `STREAMING_MODEL_*` 环境变量并重启当前服务；只发 `url/key` 会要求确认。回复里只显示遮蔽后的 Key。

token-factory 后台任务：

- `文员，把 token 跑起来` 会创建 `data/tasks/token-factory/tf-*.json` 后台任务。
- `文员，查看 token-factory 状态` 会查看最近任务。
- `scripts/token-factory-worker.js --once` 会扫描 `queued`、`interrupted`、以及超时的 `running` 任务并恢复执行。
- 推荐两台服务器都安装 systemd timer，避免服务重启后 token-factory 卡住。

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

如果公网 health 失败，先分两步判断：

```bash
# 在服务器上检查桥梁服务本身
curl -sS http://127.0.0.1:8788/health

# 在本地绕过 DNS 直连对应 IP，验证 Nginx 和证书入口
curl -k --resolve openclaw.evanshine.me:443:38.76.178.91 https://openclaw.evanshine.me/health
curl -k --resolve hermes.evanshine.me:443:38.76.188.94 https://hermes.evanshine.me/health
```

如果本机 health 和 `--resolve` 都正常，但普通域名访问失败，优先检查 DNS A 记录是否还存在：

```text
openclaw.evanshine.me -> 38.76.178.91
hermes.evanshine.me -> 38.76.188.94
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

检查桥梁服务 watchdog：

```bash
systemctl list-timers '*homework-watchdog*' --no-pager
systemctl status openclaw-homework-watchdog.timer --no-pager -l
systemctl status hermes-homework-watchdog.timer --no-pager -l
journalctl -u openclaw-homework-watchdog -n 100 --no-pager
journalctl -u hermes-homework-watchdog -n 100 --no-pager
```

watchdog 的作用：

- 每 5 分钟检查本机 `http://127.0.0.1:8788/health`。
- 如果健康检查失败，自动重启对应的 `openclaw-feishu-bridge` 或 `hermes-feishu-bridge`。
- 扫描最近 10 分钟 Nginx 飞书 webhook POST，如果发现大量请求或非 `200` 回调，记录告警原因。
- 如果环境变量 `WATCHDOG_FEISHU_NOTIFY_ENABLED=true`，会给指定飞书用户/群发守护告警，并按冷却时间避免告警刷屏。

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

安装或更新 watchdog 定时器：

OpenClaw 服务器：

```bash
cd /opt/OpenclawHomework
bash scripts/install-watchdog.sh \
  --unit-name openclaw-homework-watchdog \
  --bridge-service openclaw-feishu-bridge \
  --env-file /etc/openclaw-feishu-bridge.env \
  --state-file /var/lib/openclaw-homework-watchdog/state.json
```

Hermes 服务器：

```bash
cd /opt/OpenclawHomework
bash scripts/install-watchdog.sh \
  --unit-name hermes-homework-watchdog \
  --bridge-service hermes-feishu-bridge \
  --env-file /etc/hermes-feishu-bridge.env \
  --state-file /var/lib/hermes-homework-watchdog/state.json
```

验证：

```bash
systemctl list-timers '*homework-watchdog*' --no-pager
systemctl start openclaw-homework-watchdog.service
systemctl start hermes-homework-watchdog.service
```

注意：上面两个 `systemctl start` 要分别在对应服务器执行，不要在 OpenClaw 服务器启动 Hermes 的 watchdog。

安装或更新 token-factory 恢复 worker：

OpenClaw 服务器：

```bash
cd /opt/OpenclawHomework
bash scripts/install-token-factory-worker.sh \
  --unit-name openclaw-token-factory-worker \
  --env-file /etc/openclaw-feishu-bridge.env
```

Hermes 服务器：

```bash
cd /opt/OpenclawHomework
bash scripts/install-token-factory-worker.sh \
  --unit-name hermes-token-factory-worker \
  --env-file /etc/hermes-feishu-bridge.env
```

验证：

```bash
systemctl list-timers '*token-factory-worker*' --no-pager
systemctl start openclaw-token-factory-worker.service
systemctl start hermes-token-factory-worker.service
```

注意：上面两个 `systemctl start` 要分别在对应服务器执行。

## 8.1 官方 OpenClaw/Hermes 更新流程

更新官方组件前，先记录当前版本和服务状态：

```bash
openclaw --version || true
hermes --version || true
cd /opt/OpenclawHomework && git rev-parse --short HEAD && git status --short
systemctl is-active openclaw-feishu-bridge || systemctl is-active hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

Hermes 更新：

```bash
mkdir -p /root/openclaw-homework-backups
hermes update
hermes --version
cd /usr/local/lib/hermes-agent
git status --short
```

如果 Hermes 更新后只剩 `ui-tui/package-lock.json` 这类官方 lockfile 脏改，先备份再恢复：

```bash
cp ui-tui/package-lock.json /root/openclaw-homework-backups/hermes-ui-tui-package-lock-after-update-$(date +%Y%m%d-%H%M%S).json
git checkout -- ui-tui/package-lock.json
```

OpenClaw 更新必须先在临时目录验证 npm 包能装：

```bash
tmp=$(mktemp -d)
npm install --prefix "$tmp" openclaw@latest --no-audit --no-fund
"$tmp/node_modules/.bin/openclaw" --version
rm -rf "$tmp"
```

只有临时安装成功后，才执行全局升级：

```bash
npm install -g openclaw@latest --no-audit --no-fund
openclaw --version
```

如果临时安装失败，保持服务器现有 OpenClaw 版本，不要卸载旧版本。

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

### 硬盘盘点与清理

OpenClaw/Hermes 支持自然语言两步清理：

1. 先说“看看哪些东西占硬盘”或“khoj 可以清理吗”，服务会扫描白名单路径并把候选写入 `data/memory/disk-cleanup-state.json`。
2. 再说“确认清理第 1 个”或“清理 khoj”，服务只会执行上一轮候选里的白名单清理项。

当前白名单：Khoj 目录、npm 缓存、旧 systemd 日志、1 天前临时文件。不要把自然语言清理扩展成任意 shell 删除。

### 2026-05-04 OpenClaw 磁盘清理记录

OpenClaw 服务器曾经只剩约 6.9G 可用空间，已做一轮安全清理：

- 清理 npm 缓存、apt 缓存、Docker 停止容器、旧网络、无用镜像和构建缓存。
- 清理可重建的 root 缓存：Camoufox、Playwright、uv archive/build/wheels、pip、pnpm。
- 没有删除正在运行的 Docker 容器和 Docker volume。
- 没有删除 `/usr/local/lib/ollama`，该目录约 4.9G，但属于运行库，需确认不用 Ollama 后再动。
- 清理后 OpenClaw 根分区约为：40G 总量，22G 已用，17G 可用，使用率约 57%。

同日又做了一轮轻量运维清理：

- `journalctl --vacuum-time=3d`，日志占用从约 153M 降到约 24M。
- 清理 Docker builder cache、未使用 volume、apt 缓存、`/tmp` 和 `/var/tmp` 旧临时文件。
- 清理 `/root/.cache/uv`、`/root/.cache/node`、`/root/.npm/_cacache` 等可重建缓存。
- 执行 `swapoff -a && swapon -a` 清空旧 swap 页面；清理后 swap 使用为 0B。
- 曾短暂将 `vm.swappiness` 调到 10，后按用户偏好恢复为默认 `60`，并移除 `/etc/sysctl.d/99-openclaw-memory.conf`。
- 清理后确认 `openclaw-feishu-bridge`、watchdog、`/health`、运行中的 Docker 容器均正常。
- 飞书后台只保留 `接收消息 im.message.receive_v1`；不要订阅 `消息已读 im.message.message_read_v1`。
- 飞书事件回调必须返回 HTTP `200`，不要返回 `202`。飞书可能把非 `200` 当成投递失败并持续重试，造成夜间消息轰炸。
- `server-watchdog.js` 会扫描 Nginx access log；如果最近 10 分钟出现飞书 webhook 非 `200` 或请求风暴，会在日志里留下原因，配置通知后也会按冷却时间告警。

如果仍重复，检查：

```bash
journalctl -u openclaw-feishu-bridge -n 200 --no-pager | grep -Ei 'duplicate|notification|workflow|Feishu'
journalctl -u hermes-feishu-bridge -n 200 --no-pager | grep -Ei 'duplicate|notification|workflow|Feishu'
tail -n 200 /var/log/nginx/access.log | grep 'POST /webhook/feishu'
journalctl -u openclaw-homework-watchdog -n 100 --no-pager
journalctl -u hermes-homework-watchdog -n 100 --no-pager
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
