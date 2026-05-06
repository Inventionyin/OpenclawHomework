# Clerk Command Center Design

**日期**：2026-05-06

## Background

文员 Agent 已经能处理 token 统计、日报预览、日报发送、任务中枢、邮箱、文件通道、训练场等动作，但入口分散在 `agent-handlers.js` 和 `router.js` 里。用户自然说“今天有什么进展”“我现在该怎么玩”“给我一屏看懂”时，系统容易落到普通工作台、日报预览或待办整理中的某一个，缺少一个真正的总控视角。

上一轮已经明确数据边界：

- `task-center`：任务主数据源
- `usage-ledger`：token/耗时流水
- `mail-ledger`：邮件流水
- `daily-summary-state.json`：日报展示快照，只补最近 `runs`

本轮 C 方案要做一次更完整的文员重构：把总控数据装配、总控回复、路由入口从大文件中拆出来，让文员更像一个能一屏汇报项目状态的工作台。

## Goals

- 新增文员总控入口，覆盖“今天进展、现在该怎么玩、一屏看懂、先做什么”等自然语言。
- 抽出独立 builder，集中装配 `task-center + usage-ledger + mail-ledger + snapshot runs`。
- 保留现有 `todo-summary`、`daily-report`、`daily-email` 行为，不破坏旧入口。
- 让 `agent-handlers.js` 变瘦，把文员总控相关回复委托给独立模块。
- 补充测试，确保自然语言路由更稳定。

## Non-Goals

- 本轮不改变真正发邮件的安全边界。
- 本轮不让文员执行服务器重启、清理硬盘、互修。
- 本轮不重做 HTML 日报模板。
- 本轮不迁移或删除 `daily-summary-state.json`。

## Architecture

### New Module: clerk-command-center

新增 `scripts/agents/clerk-command-center.js`，负责三件事：

- `buildClerkCommandCenterState(options)`：汇总文员一屏总览需要的数据。
- `buildClerkCommandCenterReply(options)`：生成“今日总览 / 下一步 / 可复制口令”的回复。
- `buildClerkDailyReportReply(route, options)`：集中生成日报预览，保持 `task-center` 优先，再补日报快照。

### New Module: clerk-office-menu

如果实现时发现 `clerk-command-center.js` 过大，可以新增 `scripts/agents/clerk-office-menu.js`，只负责文案菜单和可复制口令。若总代码量不大，则先不拆第二个模块。

### Router Changes

新增 `command-center` action。以下话术应进入文员总控：

- 文员，给我一屏看懂
- 文员，今天有什么进展
- 文员，今天做了啥
- 文员，现在该怎么玩
- 文员，今天先做什么
- 文员，给我总览
- 文员，项目总览

保持旧边界：

- 明确“日报预览 / UI 自动化结果 / 报告”仍进 `daily-report`
- 明确“发送日报到邮箱”仍进 `daily-email`
- 明确“待办 / 未完成 / 下一步”仍进 `todo-summary`

## User Experience

`command-center` 回复应包含：

- 今日任务摘要：来自 `summarizeDailyPlan`
- 今日任务分布：来自 `task-center.byType`
- 最新 UI/日报快照：来自 `daily-summary-state.json` 的 `runs`
- token/耗时提示：来自 usage ledger
- 今日邮件流水提示：来自 mail ledger
- 下一步建议：可直接复制的话术

示例结构：

```text
文员总控：今天一屏看懂。
今天任务 5 个，完成 2 个，失败 1 个，运行中 2 个。重点类型：UI 自动化 2 个，token 工厂 1 个。

当前重点：
- 优先复盘失败任务：UI 自动化 ui-1。
- 补一轮 UI 自动化冒烟或 contracts 任务，顺手归档 Allure/Actions 链接。

可直接继续说：
- 文员，发送今天日报到邮箱
- 文员，查看失败任务
- 文员，今天机器人发了哪些邮件
- 文员，启动多 Agent 训练场
```

## Safety

- 总控只读，不执行发信、重启、清理、互修。
- 发邮件必须继续走 `daily-email` 明确入口。
- 坏账本、坏快照、空任务列表都要降级成可读提示，不中断回复。

## Testing

新增或更新测试：

- `routeAgentIntent('文员，给我一屏看懂')` -> `clerk-agent/command-center`
- `routeAgentIntent('文员，现在该怎么玩')` -> `clerk-agent/command-center`
- `routeAgentIntent('文员，发送今天日报到邮箱')` 仍 -> `daily-email`
- `buildClerkCommandCenterReply` 能汇总任务、usage、mail、runs
- `buildClerkAgentReply({ action: 'command-center' })` 能返回总控回复
- `daily-report` 仍通过新 builder 输出日报预览
- `todo-summary` 行为保持不变

## Migration

第一步只把新增总控和日报预览装配抽出，旧函数保留导出兼容。后续再逐步把邮箱工作台、文件通道、训练场文案继续拆出，避免一次性搬太多导致回归风险。
