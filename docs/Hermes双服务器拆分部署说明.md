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
