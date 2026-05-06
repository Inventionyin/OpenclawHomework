# 微信 Web Bridge 接入说明

## 目标

微信 Web Bridge 是给 OpenClaw/Hermes 预留的第二聊天入口。它不替换飞书，也不改现有飞书 webhook 主链路；它作为独立 HTTP 服务运行，负责网页微信登录、收发文字、收发文件，并把文件路径登记到文件通道。

当前版本是安全脚手架：

- 已有可测试 HTTP 接口。
- 已有 session/qrcode 文件位置。
- 已接入 `scripts/file-channel.js` 做文件登记。
- 真实网页微信登录和 Playwright 轮询尚未启用，避免在服务器上误碰微信会话。

## 推荐架构

```text
微信网页端
  -> wechat-web-bridge 独立进程
  -> 文字：后续转发到 OpenClaw/Hermes webhook
  -> 文件：保存到 FILE_CHANNEL_ROOT，只把安全路径通知 Agent

飞书
  -> feishu-bridge
  -> 继续作为当前主入口
```

文字和文件分开处理：

- 文字可以复用现有 OpenClaw/Hermes 自然语言路由。
- 文件不直接塞进模型上下文，只登记路径、名称、来源和安全元数据。

## 本地启动

```bash
npm run bridge:wechat
```

默认监听：

```text
http://127.0.0.1:8789
```

接口：

```text
GET  /health
GET  /qrcode
POST /send
POST /send_file
```

示例：

```bash
curl http://127.0.0.1:8789/health
curl http://127.0.0.1:8789/qrcode
curl -X POST http://127.0.0.1:8789/send \
  -H 'content-type: application/json' \
  -d '{"to":"wxid_demo","text":"你好"}'
curl -X POST http://127.0.0.1:8789/send_file \
  -H 'content-type: application/json' \
  -d '{"to":"wxid_demo","path":"reports/allure.zip","metadata":{"note":"allure artifact"}}'
```

当前 `/send` 和 `/send_file` 是 dry-run。`/send_file` 会真实登记文件通道索引，但不会真的发送微信文件。

## 环境变量

```text
WECHAT_BRIDGE_PORT=8789
WECHAT_BRIDGE_SESSION_FILE=/opt/OpenclawHomework/data/wechat-bridge/session.json
WECHAT_BRIDGE_QRCODE_FILE=/opt/OpenclawHomework/data/wechat-bridge/qrcode.txt
WECHAT_BRIDGE_OPENCLAW_WEBHOOK_URL=http://127.0.0.1:8788/webhook/feishu
FILE_CHANNEL_ROOT=/opt/OpenclawHomework/data/file-channel
```

## 和当前项目的关系

你现在可以先在飞书里这样问：

```text
文员，文件通道怎么玩
文员，最近文件通道收到哪些文件
微信 Bridge 计划怎么接
```

后续要真正启用微信，需要再补：

1. Playwright 登录网页微信。
2. 保存 cookies/localStorage 到 `session.json`。
3. 定时轮询新消息。
4. 文本消息转发到 OpenClaw/Hermes webhook。
5. 文件消息保存到 `FILE_CHANNEL_ROOT`。
6. systemd service/timer 或常驻服务。

## 安全边界

- 不把 API key、token、密码写入文件元数据。
- 文件路径必须在 `FILE_CHANNEL_ROOT` 内，拒绝路径穿越。
- 微信 Bridge 和飞书 Bridge 分进程运行，一个出问题不影响另一个。
- 没有明确授权前，不把微信入口开放到公网。
