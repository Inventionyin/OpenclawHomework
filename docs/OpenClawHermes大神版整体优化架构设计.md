# OpenClaw/Hermes 大神版整体优化架构设计

更新时间：2026-05-10

本文目标不是继续零散堆功能，而是把 OpenClaw/Hermes 做成一个长期可进化的个人 AI 工作系统。核心判断：好的产品不应该让用户记住 Obsidian、GBrain、MCP、Playwright、token 工厂这些底层名词；用户只需要用自然语言提出目标，系统自动选择能力、执行、记录、复盘和沉淀。

## 1. 结论先行

推荐采用 **Agent OS Kernel 架构**：

```text
飞书 / 微信公众号 / 邮箱 / WebUI
        ↓
Conversation Gateway 会话网关
        ↓
Intent Planner 意图规划层
        ↓
Task Center 任务中枢
        ↓
Skill Runtime 技能运行时
        ↓
Memory Autopilot 自动记忆层
        ↓
Observability + Eval 观测评测层
```

这个架构的关键不是“多装几个框架”，而是形成一套固定闭环：

```text
用户自然语言
  -> 意图识别
  -> 风险判断
  -> 任务编排
  -> 工具执行
  -> 结果反馈
  -> 自动记忆
  -> 自动复盘
  -> 下次自动变聪明
```

短期最优方案：

- 保留当前 Node.js 飞书桥服务作为主运行时，不整体替换为 LangGraph/CrewAI/Letta。
- 借鉴 LangMem/Mem0 做自动记忆，不让用户手动同步 Obsidian。
- 借鉴 Stagehand 做浏览器自动化的 `observe / act / extract` 三段式能力，但底层仍以 Playwright 和自有白名单为主。
- 借鉴 LangGraph 做显式状态流，不采用 CrewAI 式自由角色扮演作为生产主链路。
- 借鉴 LiteLLM 做模型路由和 key 池，但短期先实现轻量本地路由，不直接暴露重型网关到公网。
- 借鉴 Langfuse 和 Promptfoo 做可观测、回放和评测，不再靠感觉判断“智能不智能”。

## 2. 参考开源项目与取舍

| 方向 | 参考项目 | 值得借鉴 | 当前取舍 |
|---|---|---|---|
| 长期记忆 | Mem0 | 用户级、会话级、Agent 级记忆；聊天前检索，聊天后写入 | 借鉴结构，不直接替换现有 memory |
| 长期记忆 | LangMem | hot path 记忆工具 + background memory manager | 作为 Memory Autopilot 的主要产品形态 |
| 图谱记忆 | Graphiti/Zep | 时间知识图谱、事实随时间变化、来源追溯 | 第二阶段接入，先不重型化 |
| 状态 Agent | Letta/MemGPT | Agent 自己管理核心记忆和归档记忆 | 借鉴概念，不整体迁移 |
| 浏览器自动化 | Stagehand | `observe / act / extract / agent`，自然语言 + 代码混合 | 第一阶段吸收 API 形态 |
| 浏览器自动化 | browser-use | 快速原型、通用网页 Agent | 可实验，不作为生产默认执行器 |
| 浏览器工具 | Playwright MCP | 让模型通过 MCP 操作浏览器 | 可作为调试和研究工具，生产仍走白名单 |
| 抓取 | Scrapling / Crawl4AI / Firecrawl | 现代网页抓取、结构化抽取、去重 | 用思想做 source adapter，不盲目爬全网 |
| 多 Agent | LangGraph | 显式状态图、可恢复流程 | 借鉴为 Task Center 状态机 |
| 多 Agent | CrewAI | 快速组队、角色分工 | 适合实验，不做生产核心 |
| 多 Agent | AutoGen / Microsoft Agent Framework | 消息驱动、多 Agent 编排 | 借鉴事件和消息模型 |
| 工程 Agent | OpenHands | 代码、shell、浏览器、API 端到端工程执行 | 借鉴沙箱和任务边界 |
| 模型网关 | LiteLLM | 多模型统一接口、fallback、预算、日志 | 短期自研轻量路由；后期内网部署 |
| 观测 | Langfuse | trace、token、latency、prompt、tool call | 先 JSONL trace，后期可接 Langfuse |
| 评测 | Promptfoo | prompt/agent/RAG 回归评测和红队测试 | 建 golden intent + 行为回归集 |
| 技能 | skflow / skill-flow | Markdown skill 转成可恢复步骤 | 继续强化现有 `docs/skills` |
| 研发闭环 | RD-Agent | Research -> Development -> Evaluation -> Learning | 变成项目优化闭环，不直接跑大框架 |
| 工具协议 | MCP 生态 | 标准化工具接入 | 只接可信官方/白名单 MCP，并做隔离 |

## 3. 当前项目最大问题

目前项目已经有很多能力，但产品感还不够强，主要问题不是模型智商，而是架构还偏“命令集合”：

```text
用户要知道：同步 Obsidian、查 GBrain、启动 token 工厂、查看 task center、跑 trend radar
```

这不是好产品。好产品应该是：

```text
用户说：今天项目什么情况？
系统自动：查任务中枢、查失败复盘、查 token、查邮件、查 UI 测试、查热点、查长期记忆，合成一屏答案。
```

因此下一阶段不能继续堆命令，而要把能力变成后台自动协作。

## 4. 推荐总体架构

### 4.1 Conversation Gateway：会话网关

职责：

- 统一接入飞书、微信公众号、邮箱、后续 WebUI。
- 做消息去重、会话上下文、图片/文件暂存、用户授权。
- 不直接执行业务，只产出标准消息事件。

标准事件：

```json
{
  "channel": "feishu",
  "conversationId": "xxx",
  "userId": "xxx",
  "text": "今天项目什么情况",
  "attachments": [],
  "receivedAt": "2026-05-10T00:00:00.000Z"
}
```

### 4.2 Intent Planner：意图规划层

职责：

- 先规则强保护，再模型判断，最后规则兜底。
- 支持多意图拆解，例如“看内存、看硬盘、顺便发日报”。
- 输出结构化执行计划，而不是直接回复自然语言。

计划示例：

```json
{
  "intent": "multi_task",
  "risk": "low",
  "steps": [
    { "skill": "server-ops-status", "action": "disk-summary" },
    { "skill": "server-ops-status", "action": "memory-summary" },
    { "skill": "command-center", "action": "overview" }
  ],
  "needConfirm": false
}
```

### 4.3 Task Center：任务中枢

职责：

- 所有主动任务、后台任务、多 Agent 任务都进入任务中枢。
- 每个任务有状态机：`queued -> running -> completed / failed / degraded / interrupted`。
- 任务中枢负责历史、失败复盘、下一步计划。

任务类型建议统一：

```text
chat-response
daily-pipeline
ui-automation
trend-radar
token-factory
mail-workbench
browser-verify
memory-autopilot
server-repair
research-dev-loop
```

这能解决“现在项目不知道在干嘛”的问题。

### 4.4 Skill Runtime：技能运行时

职责：

- 把所有能力都做成 Skill，而不是散落在 handler 里。
- 每个 Skill 声明输入、输出、风险、权限、是否可自动运行。
- 高风险动作必须确认，低风险动作可自动执行。

Skill 定义建议：

```json
{
  "id": "ui-automation.run",
  "category": "testing",
  "risk": "medium",
  "autoRun": false,
  "inputs": ["env", "branch", "suite"],
  "outputs": ["runUrl", "allureUrl", "summary"],
  "memoryPolicy": "write_summary"
}
```

### 4.5 Memory Autopilot：自动记忆层

职责：

- 自动判断哪些内容值得记。
- 自动写入本地 memory、Obsidian、人类可读文档、后续 GBrain/Graphiti。
- 聊天前自动检索相关记忆。
- 不要求用户说“同步 Obsidian”。

记忆分层：

| 层级 | 内容 | 生命周期 |
|---|---|---|
| Session Memory | 当前聊天上下文、最近图片、最近意图 | 分钟到小时 |
| Task Memory | 任务执行结果、失败原因、报告链接 | 天到周 |
| Project Memory | 项目状态、服务器分工、长期配置 | 长期 |
| Procedure Memory | 解决问题步骤、测试流程、清理流程 | 长期 |
| User Preference | 用户偏好、回复风格、默认邮箱 | 长期 |
| Knowledge Vault | Obsidian/GBrain/文档索引 | 长期 |

自动触发点：

```text
UI 测试完成 -> 写测试摘要和失败原因
服务器修复完成 -> 写事故复盘和修复步骤
日报生成 -> 写今日总结和明日计划
用户说“记住/沉淀/以后别忘” -> 写长期记忆
热点分析完成 -> 写学习雷达和后续任务
模型切换/失败 -> 写模型质量和 token 成本
```

### 4.6 Browser Runtime：浏览器自动化层

职责：

- UI 自动化继续以 Playwright 为稳定核心。
- 借鉴 Stagehand，新增三类浏览器动作：

```text
observe：先观察页面上有什么可操作元素
act：执行一个自然语言动作
extract：按 schema 抽取结构化信息
```

生产策略：

- 自有电商平台、自己的 evanshine.me、项目测试环境：允许执行。
- 拼多多、京东等第三方平台：只允许学习公开页面、不要自动登录、下单、绕过风控或批量操作。
- CTF/比赛环境：必须明确目标域名和授权范围。

这能解决“研究 CDP/协议入库/自动化搜索”时边界混乱的问题。

### 4.7 Model Gateway：模型路由层

职责：

- 管理讯飞、LongCat、中转站、生图 key。
- 根据任务选择模型：闲聊、分类、总结、代码、长文、图片。
- 记录 token、耗时、失败、fallback。

短期不要急着上完整 LiteLLM 公网网关，原因：

- 你的服务器上已经有多个机器人和密钥，暴露网关会扩大风险面。
- LiteLLM 类项目很强，但需要版本固定、内网访问、鉴权、日志脱敏。
- 当前先用项目内轻量 `model-router` 更稳。

推荐路由：

```text
低成本分类/菜单/状态：LongCat Flash-Lite 或便宜模型
复杂总结/文档/测试用例：LongCat 2.x / 更强 coding 模型
代码修改/架构设计：Codex / Claude 类强模型
图片生成：独立 image gateway
失败兜底：讯飞 CodingPlan
```

### 4.8 Observability + Eval：观测评测层

职责：

- 每一次模型调用、工具调用、邮件发送、浏览器动作都记录 trace。
- 用 golden cases 测“自然语言是否路由正确”。
- 用回放机制定位为什么机器人不智能。

必须记录：

```text
trace_id
channel
user_text
selected_intent
selected_skill
confidence
model
latency_ms
tokens_in / tokens_out / estimated_tokens
tool_calls
result_status
error
memory_written
```

短期落地：

- 继续写 JSONL usage ledger。
- 增加 agent trace ledger。
- 增加 golden intent 测试集。

后期：

- 接 Langfuse 看 UI trace。
- 接 Promptfoo 做 prompt/agent 回归。

## 5. 最优实现路线

### 第一阶段：从“命令集合”升级成“自动中枢”

目标：用户不需要知道底层名词。

要做：

1. 新增 `agent-event-bus.js`：统一记录用户消息、任务完成、工具失败、记忆写入事件。
2. 新增 `memory-autopilot.js`：监听事件，自动生成记忆候选。
3. 每日流水线末尾自动调用 Obsidian/GBrain 同步。
4. 聊天前自动检索相关记忆并注入摘要。
5. 把“同步 Obsidian”降级成隐藏调试命令。

验收：

```text
用户说“这个问题以后别再踩坑”
系统自动写 memory + 同步 vault
用户下次问类似问题，回复能引用上次经验
```

### 第二阶段：从“自然语言路由”升级成“Planner + Skill Graph”

目标：多意图问题不会只回答第一个。

要做：

1. `intent-planner` 输出多步骤计划。
2. Skill Runtime 支持计划执行和中途降级。
3. 低风险自动执行，中风险生成确认卡，高风险拒绝或只给教程。
4. 每个执行计划写入 task-center。

验收：

```text
用户：看看内存、硬盘、今天任务、失败任务，再给我下一步计划
系统：分 4 个 skill 执行，最后合成一个答案
```

### 第三阶段：浏览器自动化升级为 observe/act/extract

目标：UI 自动化从固定脚本变成半自愈测试助手。

要做：

1. 对自有电商平台建立 browser adapter。
2. 增加 `observePage()`：返回页面可操作元素和风险。
3. 增加 `extractPageState(schema)`：抽取商品、订单、客服回复、登录状态。
4. 增加 protocol asset 入库：请求、响应、截图、失败信息。
5. 失败后自动生成“脚本修复建议”。

验收：

```text
用户：打开我的电商平台，看看客服入口还能不能用
系统：打开页面 -> 观察 -> 执行 -> 截图/协议入库 -> 给报告
```

### 第四阶段：观测和评测补齐

目标：不再靠感觉判断“智能不智能”。

要做：

1. 新增 `agent-trace-ledger.jsonl`。
2. 每条回复显示真实耗时、模型、是否命中记忆、执行了哪些 skill。
3. 建 50 条 golden intent case。
4. 建 20 条产品体验 case，例如“你好”“我该怎么玩”“今天项目什么情况”“为什么不回我”。
5. 每次改路由、提示词、模型，都跑 eval。

验收：

```text
npm test
node scripts/run-agent-evals.js
输出：路由准确率、误触发数、平均耗时、失败样例
```

### 第五阶段：引入外部重型组件

条件成熟后再做：

- Langfuse：如果 trace 数据多到 JSONL 难看。
- LiteLLM：如果模型 key 和供应商超过 10 个且需要统一预算。
- Graphiti：如果长期记忆超过几千条，且需要“事实随时间变化”的查询。
- Playwright MCP：如果需要让外部 IDE/Agent 操作浏览器。
- OpenHands：如果要单独做代码工程 Agent 沙箱。

## 6. 不建议现在做的事

### 6.1 不建议直接把项目重写成 LangGraph/CrewAI

原因：

- 当前系统已经有飞书、邮箱、GitHub、服务器、UI 测试、公众号等大量定制逻辑。
- 直接迁移会引入新问题，不一定提升体验。
- 最应该学的是“显式状态流”和“任务边界”，不是框架本身。

### 6.2 不建议让 MCP 无限制接管服务器

原因：

- MCP 生态很强，但安全边界复杂。
- 你的服务器里有 API key、邮箱、GitHub、飞书凭证。
- 只接官方或可信白名单 MCP，并且只给最小权限。

### 6.3 不建议让浏览器 Agent 随便操作第三方平台

原因：

- 第三方电商平台有风控、协议、账号风险。
- 适合学习公开页面结构，不适合自动登录、批量操作、下单、绕过限制。
- 自有平台和比赛授权环境才适合深入自动化。

### 6.4 不建议把 Obsidian 当成用户命令

Obsidian 应该是后台沉淀层。用户不应该说“同步 Obsidian”，而应该说：

```text
这个问题以后记住
今天做了什么
下次遇到这种失败先查什么
```

## 7. 目标产品体验

### 7.1 日常总览

用户：

```text
今天项目什么情况？
```

系统：

```text
今天项目 5 件事：
1. UI 自动化：最近一次失败在登录流程，建议先修 selector。
2. 邮件：日报已发送到 169 邮箱，ClawEmail 归档正常。
3. 热点：发现 3 个值得学的测试/Agent 项目。
4. token：LongCat 今日消耗 12.4k，失败 1 次，已切 backup key。
5. 下一步：先修 UI smoke，再跑一次报告。
```

### 7.2 自动记忆

用户：

```text
这个问题以后别再踩坑
```

系统：

```text
已沉淀：
- 类型：故障经验
- 关键词：UI 自动化 / Allure / workflow lookup
- 下次触发：当你问 UI 测试失败、报告没出来、GitHub Actions 卡住时自动引用
```

### 7.3 多意图执行

用户：

```text
看一下 Hermes 内存、硬盘、今天任务，再把下一步计划发我邮箱
```

系统：

```text
我会拆成 4 步：
1. 查 Hermes 内存
2. 查 Hermes 硬盘
3. 查任务中枢
4. 生成计划并发送邮件

前 3 步可自动执行，第 4 步涉及发信，需要你确认。
```

### 7.4 浏览器自动化

用户：

```text
打开我的电商平台，检查智能客服还能不能回答退款问题
```

系统：

```text
已完成：
- 页面打开成功
- 找到智能客服入口
- 输入退款问题
- 收到客服回复
- 截图和协议已入库
- 建议新增一条 Playwright 断言：客服回复必须包含退款流程说明
```

## 8. 文件结构建议

后续建议逐步整理成：

```text
scripts/
  agent-os/
    event-bus.js
    planner.js
    skill-runtime.js
    trace-ledger.js
  memory/
    memory-autopilot.js
    memory-extractor.js
    memory-retriever.js
    obsidian-adapter.js
    gbrain-adapter.js
  browser/
    browser-runtime.js
    observe.js
    act.js
    extract.js
    protocol-store.js
  model/
    model-router.js
    key-pool.js
    usage-ledger.js
  evals/
    golden-intents.json
    run-agent-evals.js
```

当前已有文件不用立刻大搬迁。先新建清晰边界，逐步把旧逻辑迁进去。

## 9. 实施优先级

| 优先级 | 模块 | 原因 |
|---|---|---|
| P0 | Agent Trace Ledger | 没有观测就无法判断哪里不智能 |
| P0 | Memory Autopilot | 解决 Obsidian/GBrain 手动化问题 |
| P0 | Planner 多意图执行 | 解决只回答第一个问题 |
| P1 | Skill Runtime 标准化 | 解决能力散乱 |
| P1 | Browser observe/act/extract | 提升 UI 自动化体验 |
| P1 | Eval golden cases | 防止越改越乱 |
| P2 | Langfuse 接入 | trace 多了再上 |
| P2 | LiteLLM 内网网关 | 模型通道复杂后再上 |
| P2 | Graphiti 图谱记忆 | 记忆规模大后再上 |

## 10. 最终判断

最优方案不是“找一个最强开源项目直接替换”，而是：

```text
保留现有 OpenClaw/Hermes 业务资产
吸收成熟项目的核心产品模式
用事件总线、任务中枢、技能运行时、自动记忆、观测评测把它们统一起来
```

这样做的好处：

- 不破坏已有飞书、邮箱、GitHub、服务器、UI 自动化链路。
- 每次优化都有测试和回滚点。
- 用户体验会从“记命令”变成“说目标”。
- 后续接 Langfuse、LiteLLM、Graphiti、MCP 都有明确位置。

下一步最推荐的实现计划：

```text
第一批：
1. agent-trace-ledger
2. memory-autopilot
3. daily-pipeline 自动触发记忆同步
4. 聊天前自动检索相关记忆
5. golden intent evals

第二批：
1. planner 多步骤执行
2. skill-runtime 标准化
3. browser observe/act/extract
4. UI 自动化失败自动复盘

第三批：
1. Langfuse 可视化
2. LiteLLM 内网网关
3. Graphiti 时间图谱
4. WebUI 总控台
```

## 11. Phase 1 落地状态

Phase 1 已选择最关键、能直接提升产品闭环的骨架，而不是把所有开源项目都装进来：

- Agent Trace Ledger：记录 `trace_id`、路由、skill、耗时、状态和错误，先用 JSONL，后续再接 Langfuse。
- Memory Autopilot：把明确记忆和关键任务事件自动沉淀，借鉴 Mem0/LangMem 的“自动写入、后台整理”思路。
- Daily Pipeline Memory Stage：每日流水线可选自动触发长期记忆沉淀和 Obsidian 同步，不再要求用户手动说“同步 Obsidian”。
- Golden Intent Evals：用固定样例检查自然语言路由，借鉴 Promptfoo 的回归评测思路。

暂不直接接入 LangGraph、CrewAI、Graphiti、LiteLLM、Langfuse、Stagehand。它们的思路已经映射到当前架构，等 trace/eval 稳定后再逐步接入。
