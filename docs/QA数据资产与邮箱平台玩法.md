# QA 数据资产与邮箱平台玩法

这套玩法的目标不是单纯消耗 LongCat 额度，而是把额度变成长期可复用的测试资产：

- Agent 评测题：用来比较 OpenClaw、Hermes、讯飞、LongCat、其他中转模型谁更稳。
- 电商客服语料：用来训练和评测 AI 智能客服，不让它乱承诺、乱退款、泄露敏感信息。
- UI 自动化矩阵：用来补充电商平台的 Playwright/Cypress 覆盖。
- 邮箱动作入口：让 ClawEmail 邮箱平台承担任务调度、报告归档、客服模拟、验证码测试。

## 1. 已生成资产

运行：

```bash
node scripts/qa-assets.js data/qa-assets
```

会生成：

```text
data/qa-assets/agent-eval-tasks.json        100 条 Agent 评测题
data/qa-assets/customer-service-cases.json  144 条电商客服用例
data/qa-assets/ui-automation-matrix.json     60 条 UI 自动化测试矩阵
data/qa-assets/email-playbook.json           10 条邮箱动作玩法
```

这些是第一批种子数据。后续可以让 Hermes 用 LongCat Flash-Lite 批量扩展，Thinking-2601 负责抽检评分。

## 2. LongCat 模型分工

Hermes 当前模型路由：

```text
简单任务：LongCat-Flash-Lite
普通聊天：LongCat-Flash-Chat
复杂分析：LongCat-Flash-Thinking-2601
```

建议用法：

- Flash-Lite：批量生成、分类、客服语料扩写、邮件分类、简单总结。
- Flash-Chat：普通自然语言对话、测试用例生成、客服回复。
- Thinking-2601：失败分析、复杂排错、Agent 评分、测试策略设计。

Hermes 已配置多个 LongCat key。请求失败或限流时会自动尝试下一个 key。

## 3. 邮箱平台动作绑定

当前邮箱动作：

| 动作 | 邮箱 | 用途 |
| --- | --- | --- |
| `task` | `watchee.task@claw.163.com` | 邮件调度入口，后续可通过邮件触发 UI 自动化 |
| `report` | `watchee.report@claw.163.com` | UI 自动化报告汇总 |
| `verify` | `evasan.verify@claw.163.com` | 电商注册、验证码、账号验证 |
| `account` | `evasan.account@claw.163.com` | 账号体系专项测试 |
| `shop` | `evasan.shop@claw.163.com` | 商品、购物车、订单、支付链路 |
| `support` | `agent4.support@claw.163.com` | 客服邮件模拟和 AI 回复评测 |
| `eval` | `hagent.eval@claw.163.com` | Agent 能力评测和模型对比 |
| `files` | `agent3.files@claw.163.com` | 截图、trace、video、artifact 链接 |
| `archive` | `agent3.archive@claw.163.com` | 训练语料、失败样本、复盘归档 |
| `daily` | `agent4.daily@claw.163.com` | 每日巡检日报 |

## 4. 今天可以怎么玩

### 4.1 Agent 评测

把 `data/qa-assets/agent-eval-tasks.json` 里的题分批喂给 OpenClaw 和 Hermes。

目标：

- 看它们是否路由到正确 agent。
- 看是否会乱触发危险操作。
- 看是否能正确使用邮箱、GitHub Actions、服务器状态能力。

推荐邮件归档：

```text
hagent.eval@claw.163.com
```

### 4.2 客服训练场

把 `customer-service-cases.json` 用作电商客服测试集。

玩法：

- 让 AI 客服回复买家问题。
- 用 `expectedReply` 和 `scoring` 检查是否合格。
- 把失败样本归档到 `agent3.archive@claw.163.com`。

适合长期沉淀为：

- 客服提示词优化集
- 回归测试集
- 课程/面试作品展示材料

### 4.3 UI 自动化补强

把 `ui-automation-matrix.json` 按 `priority` 分批转成 Playwright/Cypress 用例。

优先级：

```text
P0：登录、注册、验证码、搜索、加购、下单、AI 客服入口
P1：筛选排序、转人工、支付失败、上下文追问
```

报告进入：

```text
watchee.report@claw.163.com
agent3.files@claw.163.com
```

### 4.4 邮箱验证码测试

用 `evasan.verify@claw.163.com` 作为电商平台注册/找回密码测试邮箱。

测试点：

- 能否收到验证码。
- 验证码有效期是否正确。
- 错误验证码次数限制是否生效。
- 重复发送验证码是否限流。

## 5. 后续自动化方向

下一阶段可以继续做：

1. 邮件监听器：收到 `watchee.task@claw.163.com` 邮件后自动触发 GitHub Actions。
2. Agent 评测 runner：自动跑 `agent-eval-tasks.json`，生成评分报告。
3. 客服语料扩展器：用 Flash-Lite 把 144 条扩成 3000 条，再用 Thinking 抽检。
4. UI 用例生成器：把 `ui-automation-matrix.json` 自动转成 Playwright/Cypress 测试骨架。
5. 邮箱日报：每天汇总测试、客服、验证码、服务器状态并发到 `agent4.daily@claw.163.com`。
