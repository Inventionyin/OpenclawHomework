# OpenClaw/Hermes 自然语言总控与 GBrain 升级说明

## 1. 当前模型分工

当前保持双模型分工：

- OpenClaw：继续使用讯飞 CodingPlan，作为稳定入口和对照组。
- Hermes：继续使用 LongCat，作为自然语言、资料生成、评测和知识整理的主力实验组。

这样做的原因是：机器人“不像大神成品”的根因不只是模型，而是缺少统一的能力地图、长期记忆和自然语言总控。直接把两个机器人都切到 LongCat，可能会让问题变得更难定位。

## 2. 已加入的自然语言总控层

本次新增了能力注册表和规划器基础：

- `scripts/agents/capability-registry.js`：登记机器人会做什么。
- `scripts/agents/intent-planner.js`：生成模型可用的总控规划提示词，并解析 JSON 规划结果。
- `scripts/agents/router.js`：保留安全规则，同时新增自然语言能力发现、GBrain/Obsidian 记忆入口、模糊需求追问。

现在可以更自然地说：

- 我现在能让你做哪些事情
- 帮我生成一批电商平台客服训练数据
- Obsidian 存储和 GBrain 工作流怎么结合
- 查知识库 LongCat 模型分工
- 问脑库 UI 自动化报告怎么发邮箱
- 把这段经验沉淀到知识库：UI 自动化失败先看 Allure
- 帮我把项目优化一下

对于“帮我把项目优化一下”这类过大的请求，机器人会先追问方向，而不是乱执行。

## 3. GBrain/Obsidian 定位

GBrain 的 GitHub 项目定位是给 OpenClaw/Hermes 这类 Agent 加长期记忆和工作流脑库。它的 README 提到 Markdown brain repo、PGLite、本地检索、MCP server、skills、cron jobs、hybrid search 等能力。

推荐分工：

- Obsidian：给人看的长期笔记库。
- GBrain：给 Agent 检索和沉淀用的脑库层。
- OpenClaw/Hermes：负责聊天、调用工具、跑 UI 自动化、发邮件、修服务器。

短期不建议把所有外部 GBrain 组件一次性装进生产链路。更稳的方式是先让 OpenClaw/Hermes 形成自己的能力注册表和安全路由，再逐步把 Obsidian/GBrain 接为外部记忆源。

参考项目：

- https://github.com/garrytan/gbrain

## 4. 当前 Hermes 服务器上的 GBrain 状态

Hermes 服务器已经旁路安装 GBrain，不直接接管生产聊天链路：

- GBrain 源码目录：`/opt/gbrain`
- GBrain CLI：`/root/.bun/bin/gbrain`
- 默认本地 PGLite 脑库：`/root/.gbrain/brain.pglite`
- 导入缓存目录：`/opt/gbrain-import`
- 同步脚本：`scripts/sync-gbrain-knowledge.sh`

已导入三类资料：

- `docs/**/*.md`
- `data/memory`
- `data/qa-assets`

刷新脑库：

```bash
cd /opt/OpenclawHomework
bash scripts/sync-gbrain-knowledge.sh
```

飞书里可以这样查：

- 查知识库 OpenClaw Hermes LongCat
- 问脑库 UI 自动化报告怎么发邮箱
- 查知识库 GBrain 工作流

如果 GBrain CLI 不可用，机器人会自动回退到旧的本地记忆搜索，不影响 UI 自动化、服务器状态、邮箱报告等主功能。

## 5. 后续可继续增强

下一步可以继续做：

- 把 `intent-planner.js` 真正接入 Hermes LongCat，让低置信自然语言由模型判断。
- 把 `data/memory` 同步成 Obsidian vault 结构，并把 Obsidian 目录注册成 GBrain source。
- 研究是否安装 GBrain skillpack，例如 article-enrichment、concept-synthesis、perplexity-research。
- 增加每日知识沉淀任务：自动整理测试报告、服务器修复记录、邮箱通知记录。
- 给 OpenClaw/Hermes 各自生成“我会做什么”的动态能力卡片。
- 增加一个“文员 agent”：先负责日报、会议纪要、测试报告摘要、邮箱归档、待办清单和知识库沉淀；默认只整理和发送，不直接执行服务器危险动作。

安全原则：

- 明确命令、重启、修复、清理等高风险动作继续走规则白名单。
- 模型规划只负责建议路由，不直接执行危险动作。
- 密钥、服务器密码、邮箱授权码不写入 Obsidian/GBrain。

## 6. 文员 Agent 设计草案

文员 agent 适合放在 Hermes 侧先试，因为 Hermes 已经接入 LongCat 和 GBrain，更适合做自然语言整理。OpenClaw 可以保留为稳定执行和对照组。

第一阶段建议只做这些低风险工作：

- 整理今天 UI 自动化结果：从 GitHub Actions、Allure 链接、邮箱通知里生成摘要。
- 整理聊天待办：把“以后要做”“继续优化”“需要排查”的内容变成清单。
- 整理知识库：把明确经验写入 `data/memory`，再同步到 GBrain。
- 写日报/周报：从 usage 账本、测试结果、服务器状态中生成一封邮件。
- 邮箱归档：按测试报告、客服模拟、账号验证、监控审计分类归档。

自然语言示例：

- 文员，帮我整理今天做了什么
- 文员，把今天 UI 自动化结果发到邮箱
- 文员，整理一下还没完成的待办
- 文员，把这次排查经验沉淀到知识库
- 文员，统计今天 Hermes 和 OpenClaw 谁更费 token

当前已接入的第一批动作：

- `command-center`：文员总控，一屏汇总任务中枢、token/耗时、邮件流水和最近 UI 快照。
- `token-summary`：读取 `/var/log/openclaw-homework/usage-ledger.jsonl`，按机器人和模型汇总 token 与模型耗时。
- `workbench`：汇总文员当天可做的低风险工作，把 token 账本、QA 数据、daily/archive 邮箱入口串起来。
- `mailbox-workbench`：列出 ClawEmail 动作分工，例如 `task/report/verify/support/eval/files/archive/daily`。
- `training-data`：把电商客服训练数据、Agent 评测题和邮箱归档动作组织成训练工作流。
- `token-lab`：启动高 token 训练场，批量调用 LongCat 生成/质检 QA 资产，写 token 账本，并归档到邮箱动作。
- `multi-agent-lab`：启动真实的 `OpenClaw generate -> Hermes review -> Clerk summary` 三段式训练流水线，把结果归档到 `archive/eval/report`。
- `todo-summary`：给出待办整理模板和下一步清单，不执行危险动作。
- `daily-report`：给出日报结构，后续可接定时任务和邮箱发送。
- `daily-email`：只有明确说“发送日报到邮箱”时，才调用邮件发送，把日报发到 `daily` 邮箱动作。
- `knowledge-summary`：给出知识沉淀边界，强调不保存密钥。

## 日报边界补充

- `task-center`：任务主数据源，负责今日任务、失败任务、明日计划。
- `data/memory/daily-summary-state.json`：日报展示缓存，主要保存最近 `runs`。
- 文员 Agent / 主动日报优先读 `task-center`，只在展示补充时读取日报快照。

新增自然语言示例：

- 文员，给我一屏看懂
- 文员，今天有什么进展
- 文员，现在该怎么玩
- 文员，今天可以帮我干嘛
- 文员，邮箱平台现在怎么结合起来玩
- 文员，帮我生成一批电商平台客服训练数据
- 文员，启动高 token 训练场
- 文员，发送今天日报到邮箱

第二阶段再接入自动调度：

- 每天 0 点跑测试后，文员 agent 自动汇总结果并发邮件。
- 每天早上生成“昨日运行报告”：成功率、失败用例、token 用量、慢请求、服务器磁盘余量。
- 每周生成一次“测试资产清单”：新增客服训练数据、UI 测试矩阵、邮箱验证记录。

安全边界：

- 文员 agent 默认不能执行 `/exec`、重启、清理硬盘、互修。
- 需要执行动作时，只生成建议和确认问题。
- 发邮件、写 memory、查账本、查报告属于允许动作。
