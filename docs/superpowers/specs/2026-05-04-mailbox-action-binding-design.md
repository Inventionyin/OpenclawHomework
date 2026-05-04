# 邮箱动作绑定设计

**日期**：2026-05-04

## 目标

把现有 30 个 ClawEmail 邮箱里的第一阶段核心邮箱，和真实自动化动作正式绑定起来，先覆盖：

- `report`
- `replay`
- `files`
- `daily`

本阶段重点不是把所有邮箱都接满，而是建立一套后续能继续扩展的“动作 -> 邮箱”注册表机制。

## 方案

采用 **方案 B：邮箱角色注册表**。

新增统一配置文件：

- `config/mailbox-action-map.json`

由代码只声明动作类型，不直接写死收件人；具体邮箱地址由注册表解析。

## 第一阶段绑定

- `report -> watchee.report@claw.163.com`
- `replay -> evasan.replay@claw.163.com`
- `files -> agent3.files@claw.163.com`
- `daily -> agent4.daily@claw.163.com`

## 代码结构

新增：

- `scripts/mailbox-action-config.js`
- `scripts/mailbox-action-router.js`
- `scripts/daily-summary.js`

修改：

- `scripts/feishu-bridge.js`

## 行为

UI 自动化完成后：

- 总结果邮件发送 `report`
- 失败任务额外发送 `replay`
- 有 artifact 链接时发送 `files`

日报入口：

- 使用 `sendDailySummaryNotification(...)`
- 路由到 `daily`

## 配置覆盖

支持环境变量临时覆盖：

- `MAILBOX_ACTION_REPORT_TO`
- `MAILBOX_ACTION_REPLAY_TO`
- `MAILBOX_ACTION_FILES_TO`
- `MAILBOX_ACTION_DAILY_TO`

## 验证标准

- 成功任务能发送 `report + files`
- 失败任务能发送 `report + replay + files`
- 日报入口能发送 `daily`
- 配置和文档能让后续 AI 直接接手
