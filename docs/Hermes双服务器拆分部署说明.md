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

## 2. 当前阻塞点

新服务器现在能 `ping` 通，但 `22` 端口从外部测是关的：

```text
38.76.188.94:22 TCP 连接失败
```

这意味着在核云控制台里大概率有下面几种情况之一：

1. SSH 服务还没起来
2. 防火墙没放行 22
3. 安全组没放行 22
4. 服务器刚创建好，还没完全启动完

先在核云控制台检查：

```text
安全组 / 防火墙：放行 TCP 22
系统状态：确认实例运行中
控制台远程终端：确认能登录
```

然后在服务器控制台里执行：

```bash
systemctl status ssh
ss -tulpn | grep ':22'
```

如果没起来：

```bash
apt-get update
apt-get install -y openssh-server
systemctl enable ssh
systemctl restart ssh
```

## 3. 推荐部署方式

仓库里已经准备了安装脚本：

```text
scripts/install-hermes-host.sh
```

等 SSH 打通后，在新服务器上执行：

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

## 4. 安装后必须手动补的内容

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

- 这里填的是 Hermes 那个飞书应用的 `App ID / App Secret`
- 不要把这些值提交到 GitHub
- `GITHUB_TOKEN` 要能触发 `OpenclawHomework` 仓库的 Actions

改完后：

```bash
systemctl restart hermes-feishu-bridge
```

## 5. DNS 操作

你要把 Hermes 的域名解析到新服务器：

```text
hermes.evanshine.me -> 38.76.188.94
```

OpenClaw 的域名不要动：

```text
openclaw.evanshine.me -> 38.76.178.91
```

等 DNS 生效后，新服务器上执行：

```bash
certbot --nginx -d hermes.evanshine.me
```

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

## 8. 拆分后旧服务器怎么处理

旧服务器建议保留 OpenClaw 主服务，不要再继续让 Hermes 跑在上面。

可以保留代码仓库，但把 Hermes 相关入口下线：

- 停掉 Hermes 独立域名 Nginx 配置
- 删除 Hermes 的飞书凭证
- 保留 OpenClaw 链路

如果你想稳一点，可以先这样过渡：

1. 新服务器 Hermes 部署成功
2. `hermes.evanshine.me` 切到新 IP
3. 飞书 Hermes 机器人后台改 URL
4. 测试 Hermes 正常
5. 再从旧服务器移除 Hermes 入口

## 9. 结论

是的，分开会更好。

更推荐的长期结构是：

```text
38.76.178.91 -> OpenClaw
38.76.188.94 -> Hermes
```

你现在真正缺的不是方案，而是新服务器的 `22` 端口先打通。只要 SSH 能连上，我就可以继续往下把 Hermes 真正部署起来。
