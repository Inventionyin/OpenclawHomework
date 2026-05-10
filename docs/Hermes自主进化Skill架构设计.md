# Hermes 自主进化 Skill 架构设计

## 1. 目标

Hermes 需要具备“自己学习开源项目、提炼经验、生成 skill、帮助 OpenClaw 进化”的能力，但不能变成随意改代码、随意执行 shell、随意发信或触发外部动作的黑箱。

本设计的目标是把自主进化做成可审计、可回滚、可确认的工程系统：

- Hermes 可以主动发现 GitHub、技术文章、优秀 Agent 项目和测试工具。
- Hermes 可以提取项目精华，生成结构化学习卡片。
- Hermes 可以把低风险经验生成 skill 草稿。
- Hermes 可以把高风险动作通过飞书通知给用户确认。
- Hermes 可以为 OpenClaw 生成改进建议、测试计划和 skill 草稿，但不能直接越权改 OpenClaw 生产服务。
- 所有进化动作必须写入任务中枢、记忆系统和可查看文件。

## 2. 当前问题

现在项目已经有很多能力：

- `trend-intel`：发现开源热榜和学习项目。
- `web-content-fetcher`：抓取白名单网页正文。
- `research-dev-loop`：把目标变成 RD-Agent-lite 研发循环。
- `skill-flow-runner`：读取 `docs/skills/*.md` 并生成可恢复步骤。
- `memory-autopilot`：把重要事件沉淀到记忆和 Obsidian。
- `GBrain`：旁路脑库检索和同步。
- `task-center`：任务状态、失败复盘、下一步计划。

但缺少统一闭环：

```text
发现项目
  -> 读取内容
  -> 提炼精华
  -> 判断风险
  -> 生成 skill 草稿
  -> 人工确认或自动归档
  -> 启用 skill
  -> 跑一次验证
  -> 写入记忆和任务中枢
```

如果继续用“遇到一个需求补一个脚本”的方式，后面会出现这些问题：

- skill 文件越来越乱，不知道哪些能用。
- Hermes 会把“学习建议”和“真实执行”混在一起。
- 高风险动作可能只靠关键词拦截，边界不稳定。
- OpenClaw 和 Hermes 之间没有清晰的进化职责分工。
- 记忆、GBrain、Obsidian、task-center 会各记各的，最后难以复盘。

## 3. 核心原则

### 3.1 先草稿，后启用

Hermes 不能直接把新 skill 写入 `docs/skills/*.md` 并启用。默认写入：

```text
docs/skills/drafts/<skill-id>.md
```

只有通过校验并获得确认后，才移动到：

```text
docs/skills/<skill-id>.md
```

### 3.2 高风险只通知，不执行

以下动作一律视为高风险或至少中风险：

- 修改服务器配置、重启服务、安装软件、清理文件。
- 发邮件、注册账号、领取福利、调用付费 API。
- 触发 GitHub Actions、push 代码、创建 PR、部署服务。
- 访问非白名单站点、绕过风控、爬取第三方敏感数据。
- 读取或写入密钥、Token、App Secret、密码。

高风险结果只允许：

```text
生成确认卡片/飞书通知
写入 task-center
写入 docs/skills/drafts
写入记忆候选
```

不允许自动执行。

### 3.3 低风险可以自动沉淀

低风险动作包括：

- 摘要 GitHub README。
- 提炼测试思路。
- 生成学习清单。
- 生成只读 skill 草稿。
- 把经验写入 Obsidian/GBrain。
- 写入任务中枢和日报。

低风险动作可以自动执行，但仍要可追踪。

### 3.4 Hermes 是学习和调度，OpenClaw 是执行和验证

推荐分工：

```text
Hermes
  - 发现开源项目
  - 提炼精华
  - 生成 skill 草稿
  - 做风险判断
  - 生成日报/复盘/记忆

OpenClaw
  - 执行 UI 自动化
  - 调度 GitHub Actions
  - 浏览器/CDP/协议验证
  - 服务器和项目执行层动作
```

Hermes 可以“帮 OpenClaw 进化”，但方式是给 OpenClaw 生成：

- skill 草稿
- 测试计划
- 修复建议
- 执行清单
- PR 方案

不是直接接管 OpenClaw 执行权限。

## 4. 总体架构

```text
外部信号源
  GitHub Trending / GitHub Search / RSS / 技术文章 / 用户指定 URL
        |
        v
Source Collector 信号采集层
  trend-intel / web-content-fetcher / hot-monitor / world-news
        |
        v
Essence Extractor 精华提炼层
  项目定位 / 核心方法 / 可借鉴点 / 风险 / 适合生成的 skill 类型
        |
        v
Risk Gate 风险闸门
  low -> 自动生成草稿和记忆
  medium -> 草稿 + 任务中枢 + 等待确认
  high -> 飞书通知 + 草稿隔离 + 不启用
        |
        v
Skill Draft Factory
  docs/skills/drafts/<skill-id>.md
  data/evolution/<date>/<skill-id>.json
        |
        v
Review & Promotion
  用户确认 / 自动校验 / 测试通过
        |
        v
Skill Runtime
  docs/skills/<skill-id>.md
  skill-flow-runner
        |
        v
Memory & Dashboard
  task-center / memory-autopilot / Obsidian / GBrain / dashboard
```

## 5. 模块设计

### 5.1 `source-intel`：信号采集

复用现有模块，不重新造：

- `scripts/trend-intel.js`
- `scripts/web-content-fetcher.js`
- `scripts/world-news-monitor.js`
- `scripts/hot-monitor.js`

新增统一输入结构：

```json
{
  "sourceUrl": "https://github.com/example/project",
  "sourceType": "github",
  "title": "example/project",
  "summary": "README 摘要",
  "content": "抽取后的正文",
  "tags": ["agent", "testing", "browser"],
  "collectedAt": "2026-05-10T00:00:00.000Z"
}
```

### 5.2 `essence-extractor`：精华提炼

把开源项目提炼为固定结构：

```json
{
  "project": "skill-flow/skflow",
  "oneLineValue": "把 Markdown 技能流程转成可恢复任务。",
  "usefulFor": ["Hermes skill", "OpenClaw workflow", "测试流程沉淀"],
  "patterns": [
    "Markdown-first workflow",
    "步骤可恢复",
    "风险边界写进 skill"
  ],
  "candidateSkills": [
    {
      "id": "markdown-skill-flow",
      "title": "Markdown Skill Flow",
      "riskLevel": "low",
      "target": "hermes"
    }
  ],
  "risks": ["不要自动执行陌生脚本"],
  "nextActions": ["生成 skill 草稿", "写入 GBrain", "加入日报"]
}
```

第一阶段可以规则 + 模板生成，第二阶段再接模型分析。

### 5.3 `skill-draft-factory`：Skill 草稿工厂

输出 `docs/skills/drafts/<skill-id>.md`。

草稿必须包含：

```markdown
# Skill Title

Purpose: ...

Source:
- ...

Extracted essence:
- ...

Allowed user commands:
- ...

Steps:
- ...

Safety:
- ...

Promotion checklist:
- 格式校验通过
- 无密钥
- 无高危自动执行
- 至少有一个测试或 dry-run 验证
```

### 5.4 `skill-risk-gate`：风险闸门

风险分级：

| 等级 | 可自动做什么 | 禁止做什么 |
| --- | --- | --- |
| low | 生成草稿、写记忆、写任务、同步 GBrain | 真实外部写操作 |
| medium | 生成草稿、写待确认任务、飞书提示 | 自动启用、自动执行 |
| high | 隔离草稿、飞书通知、写风险报告 | 启用、执行、发信、改服务器 |

高风险关键词只是第一层，后续要加模型二判：

```text
规则强保护 -> 模型二判 -> 规则兜底 -> 确认队列
```

### 5.5 `promotion-manager`：启用管理

确认启用的流程：

```text
用户：确认启用 markdown-skill-flow
  -> 找到 docs/skills/drafts/markdown-skill-flow.md
  -> validateSkillDraft
  -> 运行 skill-flow parser 测试
  -> 移动到 docs/skills/markdown-skill-flow.md
  -> 写 task-center completed
  -> 写 memory-autopilot
```

启用后不会自动加入 `skill-registry.js` 的静态核心技能列表。原因：

- 静态 registry 是系统核心能力。
- 动态 skill 属于 `docs/skills` 可运行技能。
- 两者分层可以避免 registry 膨胀。

### 5.6 `evolution-orchestrator`：自主进化调度器

Hermes 定时或用户触发：

```text
Hermes，自己去 GitHub 找项目提炼成 skill
Hermes，帮 OpenClaw 进化一下 UI 自动化能力
Hermes，今天自主学习了什么
```

调度器负责：

- 从 trend-intel 取候选项目。
- 抓取 README。
- 提炼精华。
- 生成 skill 草稿。
- 判断目标是 Hermes、OpenClaw 还是 shared。
- 写入任务中枢。
- 高风险发飞书通知。
- 低风险进入日报/记忆。

## 6. 数据目录

建议目录：

```text
docs/skills/
  drafts/
    <skill-id>.md
  <enabled-skill>.md

data/evolution/
  2026-05-10/
    candidates.json
    essence-<project>.json
    skill-draft-<skill-id>.json
    risk-report.json

data/memory/
  runbook-notes.md
  project-state.json

data/tasks/token-factory/
  skill-creator-*.json
```

## 7. 飞书交互设计

### 7.1 普通触发

```text
Hermes，自己去 GitHub 找项目提炼成 skill
```

回复：

```text
自主进化任务已建立。
- 本轮目标：从 GitHub 热门项目提炼低风险 skill 草稿
- 产物：docs/skills/drafts/xxx.md
- 风险：low
- 下一步：你可以说“确认启用 xxx”
```

### 7.2 帮 OpenClaw 进化

```text
Hermes，帮 OpenClaw 进化 UI 自动化能力
```

回复：

```text
已为 OpenClaw 生成进化草稿。
- 类型：测试执行增强
- 内容：UI 自动化失败复盘 skill / Allure 诊断 skill
- 状态：待确认
- 原因：涉及 GitHub Actions 或测试执行，不能自动启用
```

### 7.3 高风险通知

```text
高风险 skill 草稿需要确认。
- skill：server-auto-repair
- 风险：high
- 原因：包含服务器修改、重启、shell 执行
- 草稿：docs/skills/drafts/server-auto-repair.md
- 当前状态：未启用、未执行
```

### 7.4 启用确认

```text
确认启用 markdown-skill-flow
```

回复：

```text
skill 已启用。
- 文件：docs/skills/markdown-skill-flow.md
- 校验：通过
- 可运行：文员，按 markdown-skill-flow 技能跑
```

## 8. 实施阶段

### Phase 1：设计和只读闭环

目标：只学习、只生成草稿，不启用。

实现：

- `scripts/evolution/essence-extractor.js`
- `scripts/evolution/skill-draft-factory.js`
- `scripts/evolution/risk-gate.js`
- `scripts/evolution/evolution-orchestrator.js`
- 测试：草稿生成、风险判断、目录写入、任务中枢记录。

验收：

- 能从一个 GitHub URL 生成 skill 草稿。
- 高风险内容不会启用。
- 产物能在 dashboard/task-center 看到。

### Phase 2：飞书确认和启用

目标：接入飞书确认。

实现：

- 路由 `skill-create`、`skill-promote`、`skill-review`。
- 高风险飞书通知。
- `promotion-manager` 移动草稿到 active skills。
- 启用前跑 `parseSkillMarkdown` 校验。

验收：

- `确认启用 xxx` 后 skill 出现在 `docs/skills`。
- `文员，按 xxx 技能跑` 能进入 skill-flow。

### Phase 3：主动定时进化

目标：Hermes 每天自己挑 1-3 个项目学习。

实现：

- systemd timer：`hermes-evolution-orchestrator.timer`
- 默认只写邮件或日报，不刷飞书。
- 只有 high risk 才飞书通知。

验收：

- 每天生成进化日报。
- 每周至少沉淀 3 个 skill 草稿。
- 不产生无意义刷屏。

### Phase 4：帮 OpenClaw 进化

目标：Hermes 给 OpenClaw 生成执行层改进建议。

实现：

- target 字段支持 `hermes/openclaw/shared`。
- OpenClaw 相关 skill 默认 medium risk。
- 需要确认后才进入 OpenClaw 执行队列。

验收：

- Hermes 可以生成 OpenClaw UI 自动化增强草稿。
- 不直接触发 OpenClaw 生产修复。

## 9. 不做什么

第一版不做：

- 不自动安装陌生 GitHub 项目。
- 不自动执行第三方脚本。
- 不自动 push 代码。
- 不自动创建 PR。
- 不自动修改 systemd、nginx、env 文件。
- 不把所有动态 skill 写入静态 `skill-registry.js`。
- 不让模型自己绕过风险闸门。

## 10. 验收标准

完成后应满足：

- 用户不需要知道 GBrain、Obsidian、skill-flow 的细节。
- 用户可以自然语言说“自己去学点东西，生成 skill”。
- Hermes 能产出可读、可审计、可恢复的 skill 草稿。
- 高风险会飞书通知，且不会自动执行。
- OpenClaw 的进化建议和 Hermes 的学习产物分层清晰。
- 所有产物都能在任务中枢、dashboard、文档或记忆里追踪。

## 11. 推荐实现顺序

最稳顺序：

1. 先实现 `essence-extractor` 和 `skill-draft-factory`。
2. 再实现 `risk-gate`。
3. 再接 task-center。
4. 再接飞书路由和通知。
5. 最后接 promotion-manager。
6. 定时自主进化放到最后。

这条路线会比“先做最小闭环”慢一点，但后续不会越堆越乱。
