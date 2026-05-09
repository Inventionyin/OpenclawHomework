# Agent 玩法与二改优化路线

这份文档记录 OpenClaw 和 Hermes 后续可以怎么玩、怎么二改，以及哪些开源项目的思路值得借鉴。当前项目不建议直接塞入重型框架，优先把好思路做成轻量、可测试、可回滚的功能。

## 当前已安排进项目的优化

### 1. 帮助菜单升级为“大神版玩法菜单”

飞书里可以直接发：

```text
帮助
你会做什么
怎么玩
```

机器人会返回可复制的例句，覆盖：

- 日常体检（内存/硬盘/负载/健康）
- UI 自动化（触发 + 复盘）
- 邮箱/日报（文员流）
- token 工厂（训练流水线）
- 知识库（长期记忆）
- 互修（明确授权后执行）
- 测试资产（客服语料/评测题/矩阵）

建议在飞书里直接问：

```text
大神版怎么玩
你会做什么
如何变成大神版
```

返回风格会尽量“像产品菜单”，但仍坚持边界：

- 不保存密钥、token、密码
- 高风险操作只接受明确指令
- 硬盘清理先盘点后确认
- 邮件相关动作默认不自动发送

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

### D. 每日主动工作流

定时每天自动做三件事：

- OpenClaw 跑 UI 自动化，并把 Actions run 状态写入 state file
- Hermes 跑 QA Token Lab，消耗 LongCat 等低价额度生成客服/测试训练数据
- 主动日报汇总 RSS 新闻、GitHub 热榜、服务器状态、邮件账本、usage 账本和前两项自动任务状态

当前已落地脚本：

```text
scripts/news-digest.js
scripts/scheduled-ui-runner.js
scripts/install-scheduled-ui-runner.sh
scripts/scheduled-token-lab.js
scripts/install-scheduled-token-lab.sh
scripts/proactive-daily-digest.js
scripts/install-proactive-daily-digest.sh
```

推荐玩法：

```text
每天 00:10 OpenClaw 跑 UI 自动化 contracts
每天 01:20 Hermes 跑 QA Token Lab
每天 08:30 OpenClaw 发主控日报
每天 08:35 Hermes 发邮箱/文员日报
```

token lab 每个模型 job 默认 120 秒超时；如果 LongCat 或其它模型某次响应卡住，会把该条记成失败样本并继续下一条，避免整晚定时任务被单个请求拖死。

日报包含：

- 邮件收发信统计
- Agent 工作摘要
- token / 耗时账本
- 服务器硬盘、内存、负载
- RSS 新闻和 GitHub 热榜
- UI 自动化调度状态
- QA Token Lab 产出数量和 token 统计
- 明日建议

手动体验：

```bash
node scripts/proactive-daily-digest.js --dry-run --force --to 1693457391@qq.com
node scripts/proactive-daily-digest.js --force --to 1693457391@qq.com
```

新闻日报现在优先走 `scripts/news-digest.js`，会抓 RSS/Atom 和 GitHub Search API；失败时才降级到 `PROACTIVE_DIGEST_NEWS_ITEMS` 或内置趋势摘要。OpenClaw 更适合做主控 UI / GitHub Actions / 报告，Hermes 更适合做邮箱 / token lab / 归档。

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

### F. 三个开源项目思路的轻量内化

这次没有直接把外部大框架装进生产服务器，而是把思路拆成三个可测试模块：

```text
RD-Agent    -> scripts/research-dev-loop.js
Scrapling   -> scripts/web-content-fetcher.js
skflow      -> scripts/skill-flow-runner.js
```

对应飞书玩法：

```text
文员，启动 RD-Agent-lite 研发循环，优化 UI 自动化失败复盘
文员，抓一下 https://github.com/microsoft/RD-Agent 正文
文员，按 ui-automation 技能跑一轮流程
```

落地边界：

- `RD-Agent-lite` 只负责把目标变成 Research -> Plan -> Development -> Evaluation -> Learning -> Next 的可追踪任务，不直接乱改代码。
- `web-content-fetcher` 只抓白名单域名，默认拒绝 localhost、内网 IP 和未知域名；带“接口/抓包/CDP/截图”的请求仍走浏览器 Agent。
- `skflow-lite` 读取 `docs/skills/*.md`，把技能文档里的步骤写入任务中枢，适合做可恢复流程，而不是把脚本权限直接交给自然语言。

这三项的目标是让 Hermes/OpenClaw 更接近“会持续做事的项目助理”：先形成闭环、留痕和复盘，再逐步接真实执行器。

### G. Skill 中枢和风险分级

现在三项开源项目能力已经从散落命令收敛到 Skill 中枢：

```text
scripts/skills/skill-registry.js   -> 技能注册表：名称、action、风险、是否自动运行
scripts/skills/skill-router.js     -> 技能路由器：从自然语言选择对应 Skill
scripts/skills/skill-risk-gate.js  -> 风险闸门：决定自动跑、入队、还是拒绝
```

当前规则：

```text
web-fetch-summary  -> low    -> 可以自动跑，适合抓 GitHub/网页正文
research-dev-loop  -> medium -> 需要明确“启动/研发循环/RD-Agent-lite”这类指令
skill-flow         -> medium -> 需要明确技能名，例如 ui-automation/server-ops
daily-email        -> medium -> 明确要求把日报/报告发邮箱时启动，会校验邮箱格式
ui-automation-run  -> medium -> 明确要求跑 UI 自动化/冒烟/全量测试时启动
dify-testing       -> low    -> 测试用例、缺陷分析、测试报告整理可自动走测试助理
trend-intel        -> low    -> 开源热榜、热点新闻、值得学项目可自动分析
trend-token        -> medium -> 明确要求烧 token/LongCat 分析热点时启动
token-factory      -> medium -> 明确要求 token 工厂/训练数据流水线时启动
command-center     -> low    -> 项目总览、一屏看懂、今天进展
todo-summary       -> low    -> 待办、未完成、今日总结和明日计划
mailbox-workbench  -> low    -> 邮箱平台玩法、邮箱任务和邮件流水
mailbox-approvals  -> medium -> 只列出审批队列，不直接审批发送
server-ops-status  -> low    -> 明确问服务器/内存/硬盘/负载时查询状态
```

设计目标不是让 AI 看到任何话都启动工具，而是：

```text
普通聊天 -> 只回答
看链接/总结网页 -> 自动走 web-fetch-summary
明确研发循环 -> 建立 research-dev-loop 任务
明确按技能跑 -> 建立 skill-flow 任务
明确日报发邮箱 -> 走 daily-email，邮箱无效时交给 invalid-recipient 诊断
测试知识生成 -> 走 dify-testing-assistant
热点学习 -> 走 trend-intel
高 token 主动训练 -> 走 trend-token-factory 或 token-factory
项目状态/待办/邮箱工作台 -> 走 command-center/todo/mailbox 系列 Skill
服务器资源查询 -> 走 server-ops-status，但普通“今天状态怎么样”仍保持聊天
接口/CDP/抓包/截图/登录流程 -> 交给 browser-agent，不走普通网页抓取
```

这样后续继续增加 Skill 时，只需要先注册元数据和风险等级，再接执行器；不需要继续把所有判断塞进 `scripts/agents/router.js`。

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
