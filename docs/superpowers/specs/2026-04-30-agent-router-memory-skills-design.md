# Agent Router + Memory + Skills Design

## 背景

OpenclawHomework 当前已经完成飞书机器人、GitHub Actions UI 自动化、双服务器拆分、watchdog、飞书回调去重、OpenClaw CLI 串行队列等稳定性工作。近期主要问题来自三类：

- 飞书事件重复或非消息事件造成重复回复。
- OpenClaw CLI 并发调用导致 session file locked。
- OpenClaw/Hermes 聊天、测试触发、运维说明混在一个处理流程里，后续继续加功能会变难维护。

这次优化目标不是引入大型 Agent 框架，而是借鉴 mem0、Letta、LightAgent、ChatOps 等开源项目的思路，在现有 Node 桥梁服务上做轻量分层：让系统表现得像多个专业 agent，但底层仍保持单服务、白名单、可测试、可回滚。

## 目标

第一阶段要实现：

- 根据飞书消息意图路由到不同逻辑 agent。
- 给机器人提供轻量长期记忆，让它知道项目状态、用户偏好、历史故障。
- 把可执行能力整理成技能文档，方便当前机器人和未来 AI 接手。
- 保持 OpenClaw/Hermes CLI 串行调用，避免重新引入 session 锁冲突。
- 只允许安全白名单操作，不开放任意 shell。

非目标：

- 不引入向量数据库。
- 不把 OpenClaw/Hermes 变成多个并发 CLI agent。
- 不允许飞书直接执行任意服务器命令。
- 不把密钥、Token、服务器密码写入仓库。

## 参考模式

从高星/活跃开源项目借鉴的是模式，不直接引入重依赖：

- mem0：把记忆分成用户偏好、项目事实、事件历史。
- Letta：Agent 有身份、工具、记忆和边界。
- LightAgent：轻量工具调用和子 agent 概念。
- GitHub ChatOps：slash command、权限控制、操作白名单。

本项目采用保守版本：文件型记忆 + 规则路由 + 白名单工具。

## 架构

```text
飞书消息
  -> createServer
  -> 去重 / 非消息事件过滤 / 授权判断
  -> Agent Router
  -> chat-agent | ui-test-agent | ops-agent | doc-agent | memory-agent
  -> 安全工具层
  -> 飞书回复或 GitHub Actions 调度
```

Agent 不是独立进程，而是代码里的明确职责模块：

- `chat-agent`：普通聊天、解释项目，不触发危险操作。
- `ui-test-agent`：解析并触发 UI 自动化，查询 GitHub Actions run。
- `ops-agent`：只执行白名单健康检查，例如 status、health、watchdog、最近日志摘要。
- `doc-agent`：回答老师任务完成度、项目还差什么、如何接手。
- `memory-agent`：读取和更新长期记忆文件。

Router 的第一版可以放在 `scripts/feishu-bridge.js` 里，后续如果文件继续变大，再拆到 `scripts/agents/`。

## 记忆文件

新增目录：

```text
data/memory/
  user-profile.json
  project-state.json
  incident-log.md
  runbook-notes.md
```

建议内容：

- `user-profile.json`：语言偏好、回复风格、用户希望“直接执行但少 bug”的工作偏好。
- `project-state.json`：当前仓库、服务器、域名、服务名、最近稳定提交、功能完成度。
- `incident-log.md`：消息轰炸、receive_id、session lock、Hermes 绑定等故障记录和修复办法。
- `runbook-notes.md`：常用安全排查命令和注意事项。

安全规则：

- 记忆文件不能保存密码、Token、App Secret、API Key。
- 记忆文件可以保存“配置键名”和“检查路径”，不能保存秘密值。
- `memory-agent` 更新记忆必须走明确命令，例如 `/memory remember 项目状态 ...`。

## 技能文档

新增目录：

```text
docs/skills/
  ui-automation.md
  server-ops.md
  feishu-debug.md
  handoff.md
```

作用：

- `ui-automation.md`：触发 UI 自动化的命令格式、运行模式、报告入口。
- `server-ops.md`：服务器健康检查、systemd、watchdog 的白名单操作。
- `feishu-debug.md`：重复消息、receive_id、事件订阅、200 ack 的排查流程。
- `handoff.md`：给新 AI 接手时必须先做的检查。

这些文档既给人看，也给 `doc-agent` 和 `chat-agent` 拼接上下文时使用。

## 路由规则

第一版使用规则路由，避免模型误判导致误操作：

```text
/run-ui-test 或 “跑测试/冒烟/全量/UI 自动化” -> ui-test-agent
/status、/health、/watchdog、/logs -> ops-agent
/memory、记住、忘记、项目状态 -> memory-agent
老师任务、还差什么、接手、文档 -> doc-agent
其他普通消息 -> chat-agent
```

自动化和运维命令必须继续检查授权：

- 自动化触发要求绑定用户。
- 运维命令要求绑定用户，并且只允许白名单命令。
- 普通聊天可以更宽松，但群聊里仍要遵守“未提及不回复”的规则。

## 安全工具层

允许的 ops 工具：

```text
health: curl 本机 /health
service-status: systemctl is-active 指定桥梁服务
watchdog-status: systemctl is-active 指定 watchdog timer
recent-logs: journalctl 读取最近 N 行并做关键词摘要
git-version: git log --oneline -1
```

禁止：

```text
任意 shell
读取并回显 env 秘密值
修改 SSH、防火墙、Nginx、systemd
删除文件
git reset --hard
```

未来如果需要“互修”，只能通过固定脚本，例如 `openclaw-hermes-doctor check/smoke/restart-bridge`。

## 错误处理

- Router 识别不确定时，默认走 `chat-agent`，不执行动作。
- Agent 执行失败时，返回简短错误和下一步排查入口。
- OpenClaw CLI 和 Hermes CLI 继续串行队列，避免模型并发导致锁冲突。
- 飞书回复必须优先使用当前消息的 `chat_id` / `open_id`，没有可回复目标则静默忽略。
- 所有 webhook 仍必须快速返回 HTTP 200，后台慢任务异步执行。

## 测试计划

新增测试应覆盖：

- Router 把测试、运维、文档、记忆、普通聊天路由到正确 agent。
- 未授权用户不能触发 UI 自动化或运维命令。
- ops-agent 只允许白名单动作。
- memory-agent 不允许保存疑似秘密值。
- 没有回复目标的飞书事件不调用 agent。
- OpenClaw/Hermes CLI 调用仍保持串行。

验收命令：

```powershell
npm test
git diff --check
```

服务器部署后还要检查：

```bash
systemctl is-active openclaw-feishu-bridge
systemctl is-active hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

## 实施顺序

1. 新增记忆文件和技能文档，不接入运行时。
2. 新增 Router 纯函数和测试。
3. 新增 agent handler 纯函数和测试。
4. 将 `runWebhookInBackground` 接入 Router。
5. 增加安全 ops 白名单工具。
6. 更新运维手册和飞书使用说明。
7. 本地测试、提交、部署到两台服务器。

## 成功标准

- 飞书里问“项目还差什么”，机器人能结合记忆和文档回答。
- 飞书里发“跑 main 冒烟测试”，仍能触发 GitHub Actions。
- 飞书里发 `/status`，机器人能返回当前服务和 watchdog 摘要。
- 未绑定用户不能触发测试或运维命令。
- 不再新增重复消息、receive_id、session lock 类型问题。

