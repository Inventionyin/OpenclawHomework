# Daily Summary Snapshot Boundary Design

**日期**：2026-05-06

## Background

项目已经形成两类状态来源：

- `task-center`：主动任务、失败任务、今日任务、明日计划的真实运行状态
- `data/memory/daily-summary-state.json`：日报相关的展示快照，当前主要保存 `runs`

最近新增的主动任务和文员 Agent 已经开始以 `task-center` 为中心组织“今日总结 + 明日计划”。继续让 `daily-summary-state.json` 承担混合职责，会让后续维护者分不清“真实状态”和“展示缓存”。

本次目标不是删除这个文件，而是把它的定位降级并写清边界，让系统在保持兼容的前提下更稳。

## Goals

- 明确 `task-center` 是任务主数据源
- 明确 `daily-summary-state.json` 只是日报展示缓存 / 快照层
- 让文员 Agent、日报入口、飞书桥接按统一边界读取数据
- 保留现有 `runs` 展示能力，不破坏已有日报和预览链路
- 让后续 AI 接手时能快速理解这层关系

## Non-Goals

- 本阶段不删除 `daily-summary-state.json`
- 本阶段不重做日报模板
- 本阶段不把所有日报字段都迁入 `task-center`
- 本阶段不改变 usage ledger、mail ledger 的现有职责

## Approaches Considered

### 1. Keep the file and demote it to snapshot cache

保留 `daily-summary-state.json`，但把它明确成“日报展示缓存”，主流程优先从 `task-center` 取任务状态，只在展示补充信息时读取快照。

Pros:

- 改动小，兼容当前实现
- 风险最低
- 易于逐步演进

Cons:

- 仍然存在两层状态，需要文档和命名约束

### 2. Replace the file immediately with task-center derived data

直接让日报完全从 `task-center` 和各类 ledger 现算，移除或极度弱化 `daily-summary-state.json`。

Pros:

- 架构更纯

Cons:

- 会同时影响飞书桥、日报预览、历史 `runs` 展示
- 回归风险更高

## Decision

采用方案 1。

`task-center` 负责“今天发生了什么、失败了什么、接下来做什么”，`daily-summary-state.json` 负责“日报界面或邮件里需要附带展示的快照数据”，尤其是最近几次 UI 自动化 `runs`。

## Ownership Boundaries

### task-center

职责：

- 任务事件记录
- 今日任务摘要
- 失败任务列表
- 明日计划建议
- 主动任务类型聚合

允许消费方：

- 文员 Agent
- 主动日报生成
- 今日/失败/续跑类自然语言入口

### usage-ledger / mail-ledger

职责：

- token、耗时、邮件投递等专项流水

允许消费方：

- 文员统计
- 日报补充信息
- 运维分析

### daily-summary-state.json

职责：

- 日报展示缓存
- 最近 UI 运行快照，如 `runs`
- 为日报预览和历史展示提供轻量补充

禁止承担：

- 任务主状态
- 失败恢复决策
- 明日计划主来源

## Read Rules

统一读取原则如下：

1. 任务类摘要优先读 `task-center`
2. token / 邮件统计优先读各自 ledger
3. 只有在日报展示需要历史快照时，才读 `daily-summary-state.json`
4. 如果快照文件缺失、为空或损坏：
   - 主流程继续工作
   - 日报退化为“无历史快照”
   - 不影响任务总结、失败任务、明日计划

## Write Rules

- `daily-summary-state.json` 只允许通过专门 helper 读写
- helper 命名应体现 `snapshot` / `cache` 语义
- 不允许在新逻辑里把它当通用状态文件直接扩写

## Architecture Changes

### Helpers

现有围绕 `daily-summary-state.json` 的读写 helper 需要集中和重命名，语义统一为：

- `readDailySummarySnapshot(...)`
- `writeDailySummarySnapshot(...)`
- `appendDailySummaryRunSnapshot(...)`

兼容期内可以保留旧函数名包装，但新调用点应优先使用带 `Snapshot` 的接口。

### Agent handlers

- `todo-summary`
  - 只基于 `task-center` 和必要 ledger 构建
- `daily-report`
  - 先生成 `task-center` 视角的今日总结 / 明日计划
  - 再补上 `daily-summary-state.json` 中的 `runs` 展示

### Feishu bridge

- 保留 UI 自动化完成后的 `runs` 快照写入
- 写入逻辑只承担“展示缓存更新”，不承担业务决策

## Failure Handling

需要保证以下降级行为：

- 快照文件不存在：返回空快照，不报错
- 快照文件 JSON 损坏：忽略该文件并记录安全日志
- 快照字段缺失：按空数组或空对象处理
- `task-center` 正常时，日报和文员总结仍可继续输出

## Testing

至少覆盖：

- `daily-report` 仍能优先使用 `task-center` 生成总结与计划
- 有快照时，`runs` 正常显示
- 无快照时，日报仍能输出
- 坏快照时，不影响主流程
- helper 的读写语义与旧路径兼容

## Implementation Notes

- 文档中统一把 `daily-summary-state.json` 描述为“日报展示缓存”或“日报快照”
- `task-center` 在文档和代码注释中统一描述为“任务主数据源”
- 本次改动优先做边界澄清、命名修正、测试补齐，不追求一次性重构所有日报数据来源

## Migration Path

后续如果要继续演进，推荐顺序如下：

1. 先完成本次边界澄清
2. 再逐步把更多日报字段迁到 `task-center + ledgers`
3. 最后只保留 `daily-summary-state.json` 作为极薄的历史展示兼容层
4. 等所有消费方都不再依赖它后，再考虑真正退场
