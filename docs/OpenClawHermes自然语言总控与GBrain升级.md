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

安全原则：

- 明确命令、重启、修复、清理等高风险动作继续走规则白名单。
- 模型规划只负责建议路由，不直接执行危险动作。
- 密钥、服务器密码、邮箱授权码不写入 Obsidian/GBrain。
