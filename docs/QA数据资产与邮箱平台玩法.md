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
data/qa-assets/submailbox-registration-pool.json  6 条子邮箱测试账号池规则
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

### 4.0 Hermes 文员入口

Hermes 里的文员 agent 已经可以用自然语言把邮箱平台和 QA 数据资产串起来：

```text
文员，今天可以帮我干嘛
文员，邮箱平台现在怎么结合起来玩
文员，子邮箱可以拿去注册测试平台吗
文员，用 verify 邮箱设计一轮注册验证码测试
文员，今天邮箱里有哪些任务
文员，帮我生成一批电商平台客服训练数据
文员，启动高 token 训练场
文员，发送今天日报到邮箱
```

注意：文员默认只做整理、归档、统计和邮件摘要。只有明确说“发送日报到邮箱”时，才会调用 SMTP，把日报发到 `agent4.daily@claw.163.com`。它不会执行重启、清理硬盘、互修服务器。

### 4.0.1 子邮箱注册测试账号池

子邮箱可以拿去注册平台，但推荐只用于“测试账号池”，不要当成无限注册真实平台的工具。

适合使用的场景：

- 你自己的电商平台、测试环境、课程作业项目。
- 开源演示站、沙箱环境、明确允许创建测试账号的平台。
- UI 自动化里的注册、登录、找回密码、邮箱验证码回归测试。

不建议使用的场景：

- 批量注册真实外部平台账号。
- 绕过验证码、风控、邀请码、手机号限制。
- 用子邮箱制造垃圾账号或骚扰邮件。

推荐邮箱分工：

| 邮箱 | 用途 | 是否适合注册测试 |
| --- | --- | --- |
| `evasan.verify@claw.163.com` | 注册、登录、找回密码验证码 | 适合 |
| `evasan.account@claw.163.com` | 账号体系专项测试 | 适合 |
| `evasan.shop@claw.163.com` | 购物车、下单、支付沙箱账号 | 适合 |
| `agent4.support@claw.163.com` | 客服邮件模拟 | 只做内部模拟 |
| `hagent.eval@claw.163.com` | Agent 评测和模型对比 | 只做内部评测 |
| `agent3.archive@claw.163.com` | 失败样本、训练语料、复盘 | 只做归档 |

账号池建议字段：

```text
platform
email
account_status
verification_result
last_used_at
artifact_link
```

你可以直接对 Hermes 说：

```text
文员，给我生成一个电商平台注册测试账号池表格
文员，用 verify 邮箱设计一轮注册验证码测试
文员，今天邮箱里有哪些任务
```

### 4.0.2 高 token 训练场

如果今天想多消耗一些 LongCat 额度，同时留下真实资产，可以让 Hermes 文员启动训练场：

```text
文员，启动高 token 训练场
```

它会执行 `scripts/qa-token-lab.js`：

- 从电商客服、Agent 评测、UI 自动化矩阵、邮箱调度玩法里抽取任务。
- 按任务复杂度走 LongCat Flash-Lite / Chat / Thinking。
- 要求模型输出结构化 JSON，避免真实订单号、密钥和个人敏感信息。
- 每次模型调用写入 `/var/log/openclaw-homework/usage-ledger.jsonl`。
- 生成产物到 `data/qa-token-lab/`。
- 把摘要按邮箱动作发到 `archive`、`eval`、`report`。

服务器命令入口：

```bash
cd /opt/OpenclawHomework
npm run qa:token-lab -- --batch-size 12
```

可调环境变量：

```text
QA_TOKEN_LAB_BATCH_SIZE=12
QA_TOKEN_LAB_OUTPUT_DIR=/opt/OpenclawHomework/data/qa-token-lab
FEISHU_USAGE_LEDGER_ENABLED=true
FEISHU_USAGE_LEDGER_PATH=/var/log/openclaw-homework/usage-ledger.jsonl
```

想更“烧 token”时，把 `QA_TOKEN_LAB_BATCH_SIZE` 调大；建议先 12、24、60 这样逐步加，不建议一上来几千条，容易生成大量低质量样本。

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

可以让 Hermes 直接生成计划：

```text
文员，用 verify 邮箱设计一轮注册验证码测试
```

它会返回：

- 收件邮箱、报告邮箱、附件归档邮箱。
- 合法邮箱注册、验证码过期、错误验证码、重复发送、已注册邮箱等核心用例。
- Playwright/Cypress 与邮箱平台的配合方式。

## 5. 后续自动化方向

下一阶段可以继续做：

1. 邮件监听器：收到 `watchee.task@claw.163.com` 邮件后自动触发 GitHub Actions。
2. Agent 评测 runner：自动跑 `agent-eval-tasks.json`，生成评分报告。
3. 客服语料扩展器：用 Flash-Lite 把 144 条扩成 3000 条，再用 Thinking 抽检。
4. UI 用例生成器：把 `ui-automation-matrix.json` 自动转成 Playwright/Cypress 测试骨架。
5. 邮箱日报：每天汇总测试、客服、验证码、服务器状态并发到 `agent4.daily@claw.163.com`。

## 多 Agent 高 token 训练场

现在除了普通的 `高 token 训练场`，还可以直接让文员启动一套更像真实对打的多 Agent 流水线：

```text
文员，启动多 Agent 训练场
文员，启动多 Agent 训练场，用邮箱归档结果
```

最小流程分三段：

1. 生成：批量产出电商客服回复、测试思路、UI 自动化建议
2. 评审：用第二轮模型从风险、完整性、可执行性、是否乱编四个角度打分挑错
3. 总结：汇总赢家、失败模式和高价值样本

当前归档建议：

```text
archive -> 训练样本、失败样本、可复用提示词
eval    -> 模型对打结果、评分结论
report  -> 综合摘要、可发到飞书/邮箱的训练场结论
```

这套玩法比普通 token lab 更适合“烧 token 但沉淀测试资产”，后面可以继续扩成 OpenClaw vs Hermes 的真实多轮对打。
