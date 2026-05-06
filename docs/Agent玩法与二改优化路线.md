# Agent 玩法与二改优化路线

这份文档记录 OpenClaw 和 Hermes 后续可以怎么玩、怎么二改，以及哪些开源项目的思路值得借鉴。当前项目不建议直接塞入重型框架，优先把好思路做成轻量、可测试、可回滚的功能。

## 当前已安排进项目的优化

### 1. 帮助菜单变成“玩法菜单”

飞书里可以直接发：

```text
帮助
你会做什么
怎么玩
```

机器人会返回可复制的例句，覆盖：

- UI 自动化
- 服务器状态
- 硬盘清理
- OpenClaw/Hermes 互相修复
- 记忆检索
- 邮箱和报告

### 2. 记忆系统从“整段上下文”升级为“可检索记忆”

现在支持：

```text
/memory
/memory search session lock
/memory search receive_id
/memory remember 今天修复了某个非敏感问题
```

设计原则：

- 借鉴 mem0 的长期记忆分层：用户偏好、项目状态、故障记录、运维手册。
- 借鉴 Letta 的 stateful agent 思路：Agent 要知道自己的身份、工具、边界。
- 不保存 Token、密码、App Secret、API Key。
- 普通聊天默认不携带完整记忆，避免未授权套出项目细节。

### 3. 继续使用轻量 Agent Router

当前不是把 OpenClaw/Hermes 拆成很多并发 CLI，而是在同一个桥梁服务里分工：

```text
chat-agent    普通聊天
ui-test-agent UI 自动化
ops-agent     服务器状态、修复、清理
doc-agent     作业进度、接手说明
memory-agent  记忆读取、检索、记录
```

这借鉴 LangGraph 的“显式节点/状态流”思路，但先用规则路由实现，减少模型误判和并发卡死。

## 推荐玩法

### 日常问状态

```text
你现在内存多少
你硬盘还剩多少
你现在卡不卡
看看 Hermes 的服务器状态
OpenClaw 硬盘还剩多少
```

### UI 自动化

```text
帮我跑一下 main 分支的 UI 自动化冒烟测试
如何使用 /run-ui-test main smoke
老师任务还差哪些
```

### 硬盘清理

```text
看看哪些东西占硬盘
khoj 可以清理吗
确认清理第 1 个
```

清理是两步确认：先扫描候选，再确认执行。

### 互相修复

```text
修复你自己
修复 Hermes
修复 OpenClaw
重启你自己
```

高风险操作仍然只走白名单脚本，不开放任意 shell 给普通自然语言。

### 记忆沉淀

```text
/memory remember OpenClaw 服务器今天清理了 khoj
/memory search khoj
/memory search 飞书重复消息
```

适合记录非敏感事实、踩坑和修复办法。

## 可以继续二改的方向

### A. 任务系统

增加 `data/tasks/`：

```text
todo.json
daily-summary.json
decisions.md
```

玩法：

```text
记一个任务：明天凌晨跑 UI 自动化
今天任务还差哪些
把昨天测试结果总结一下
```

### B. 技能注册表

把 `docs/skills/` 变成机器可读清单，例如：

```json
{
  "name": "server-ops",
  "examples": ["你现在内存多少", "修复 Hermes"],
  "risk": "medium",
  "requiresAuth": true
}
```

这样帮助菜单可以自动从技能生成，避免文档和代码不一致。

### C. 邮箱 Agent

让 Hermes 更偏邮箱和日报：

```text
查一下今天 UI 自动化邮件
把失败报告转发到 QQ 邮箱
创建一个测试用子邮箱
总结今天邮件里的错误
```

OpenClaw 继续做主入口，Hermes 做邮箱和备份入口。

### C2. 文件通道和微信 Bridge

文件不要直接塞给 OpenClaw/Hermes。推荐独立通道：

```text
文字 -> 飞书/OpenClaw/Hermes webhook
文件 -> FILE_CHANNEL_ROOT -> incoming-files.json -> 文员 agent 读取路径
```

现在已新增：

```text
scripts/file-channel.js
scripts/wechat-web-bridge.js
docs/微信WebBridge接入说明.md
```

玩法：

```text
文员，文件通道怎么玩
文员，最近文件通道收到哪些文件
微信 Bridge 计划怎么接
```

当前微信 Bridge 是 dry-run 脚手架，不会真实登录微信。后续启用 Playwright 后，再做扫码、session 持久化、消息轮询和文件收发。

### D. 夜间总结

定时每天凌晨：

- 跑 UI 自动化
- 汇总 GitHub Actions 结果
- 检查两台服务器健康
- 查邮箱是否有异常报告
- 发飞书和邮箱日报

当前已落地为“主动日报系统”：

```text
scripts/proactive-daily-digest.js
scripts/install-proactive-daily-digest.sh
```

推荐玩法：

```text
每天 08:30 OpenClaw 发主控日报
每天 08:35 Hermes 发邮箱/文员日报
```

日报包含：

- 邮件收发信统计
- Agent 工作摘要
- token / 耗时账本
- 服务器硬盘、内存、负载
- 新闻日报
- 明日建议

手动体验：

```bash
node scripts/proactive-daily-digest.js --dry-run --force --to 1693457391@qq.com
node scripts/proactive-daily-digest.js --force --to 1693457391@qq.com
```

新闻日报当前是可配置趋势摘要，可通过 `PROACTIVE_DIGEST_NEWS_ITEMS` 自定义。如果要升级成真正联网新闻，可以后续接 RSS/API，再让模型做摘要，不建议直接让模型编造“今日最新新闻”。

### E. 工程型接手

借鉴 OpenHands：任何工程任务都要留下证据。

推荐固定流程：

```text
读仓库状态 -> 改代码 -> npm test -> git diff --check -> 更新文档 -> 推送
```

别的 AI 接手时先读：

- `docs/AI接手核云服务器运维手册.md`
- `docs/Hermes双服务器拆分部署说明.md`
- `docs/云服务器接手说明.md`
- `docs/Agent玩法与二改优化路线.md`

## 不建议现在做的事

- 不建议在 2G/4G 小服务器上直接部署完整 LangGraph/CrewAI/OpenHands 常驻服务。
- 不建议让飞书自然语言执行任意 shell。
- 不建议 OpenClaw 和 Hermes 共用同一个模型 session 或同一个邮箱账号。
- 不建议把密钥写进记忆系统或文档。

当前最合适路线：OpenClaw 做主控，Hermes 做备份和邮箱，复杂代码开发继续交给本地 Codex/其他 AI；服务器只承担稳定的 ChatOps、测试调度、报告通知。

## 参考来源

- Mem0：<https://github.com/mem0ai/mem0>
- Letta stateful agents：<https://docs.letta.com/guides/agents/overview>
- Letta MemFS/git-backed memory：<https://docs.letta.com/letta-code/memory/>
- LangGraph agent orchestration：<https://www.langchain.com/agents>
- OpenHands：<https://github.com/OpenHands/OpenHands>
