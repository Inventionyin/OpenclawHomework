# OpenClaw GitHub UI Automation Homework

## Project Goal

Use Feishu + OpenClaw to trigger GitHub Actions remotely, run UI automation tests, and return the execution result link.

## Learning Checklist

See the Chinese step-by-step task list:

- [老师任务学习清单](docs/老师任务学习清单.md)
- [流程图实现拆解](docs/流程图实现拆解.md)
- [已有项目复用方案](docs/已有项目复用方案.md)
- [飞书桥梁服务使用说明](docs/飞书桥梁服务使用说明.md)
- [云服务器接手说明](docs/云服务器接手说明.md)
- [AI 接手核云服务器运维手册](docs/AI接手核云服务器运维手册.md)
- [Hermes 双服务器拆分部署说明](docs/Hermes双服务器拆分部署说明.md)
- [OpenClaw 讯飞 CodingPlan 模型接入说明](docs/OpenClaw讯飞CodingPlan模型接入说明.md)

## Minimum Demo Flow

1. Send a command in Feishu.
2. The webhook bridge parses the command, optionally using OpenClaw for natural language.
3. The bridge calls the GitHub API.
4. GitHub Actions runs UI automation tests.
5. The bridge can poll the workflow run and send the final result back to Feishu.

## Proactive Daily Pipeline

The current "advanced" workflow is no longer only UI automation. The daily pipeline is:

```text
news-digest
  -> trend-intel
  -> trend-token-factory
  -> scheduled-ui-runner
  -> scheduled-token-lab
  -> proactive-daily-digest
```

This means the bots can collect live news and GitHub trends, spend model tokens analyzing useful projects, run UI automation, generate QA training data, and then send a daily summary. The task center is the source of truth for task history, failed runs, and next-step planning; runtime state files are local machine snapshots and should not be committed.

Useful Feishu examples:

```text
文员，查看今天自动流水线状态
文员，给我最近一次失败复盘
文员，查看任务中枢主控脑
文员，今天有什么值得学的开源项目
文员，烧 token 看新闻
文员，查看今天邮箱工作台
文员，列出待审批邮件
文员，审批第 1 封并发送
文员，忽略第 1 封
文员，把第 1 封整理成客服训练数据
文员，生成 ClawEmail 每日报告
文员，发送今天日报到邮箱
```

## Hot Monitor And Ecommerce Agent Playbook

The hot monitor can use GitHub/HN/RSS plus optional Tavily, Brave, SerpApi, and SearXNG sources. Search candidates are translated into Chinese summaries, filtered for expired benefits, and can be saved into protocol assets for later browser verification and contract test generation.

The ecommerce workflow is:

```text
hot monitor
  -> browser verification / CDP capture
  -> protocol asset store
  -> protocol test cases
  -> GitHub Actions UI automation
  -> customer-service training data and daily report
```

Useful commands:

```text
帮我搜今天电商测试和 AI 客服相关福利，过期的不要提醒
把最新福利候选做浏览器验证并协议入库
打开自有电商平台登录页做浏览器验证和抓包
把最近协议资产转成接口契约测试用例
```

## ClawEmail Workbench

The Feishu clerk agent now has a lightweight ClawEmail workbench. It reads recent inbox snapshots from the ClawEmail inbox notifier, combines them with the outbound mail ledger, classifies messages, and shows pending approval items before any risky reply is sent.

Natural language examples:

```text
文员，查看今天邮箱工作台
文员，列出待审批邮件
文员，审批第 1 封并发送
文员，忽略第 1 封
文员，把第 1 封整理成客服训练数据
文员，生成 ClawEmail 每日报告
文员，发送今天日报到邮箱
```

Important boundary: `生成 ClawEmail 每日报告` only previews the mailbox report. `发送今天日报到邮箱` is the command that actually calls the existing daily email sender.

Detailed docs:

- [飞书桥梁服务使用说明](docs/飞书桥梁服务使用说明.md)
- [AI 接手核云服务器运维手册](docs/AI接手核云服务器运维手册.md)

## Task Breakdown

### Phase 1: Minimal Working Version

- Prepare a GitHub repository.
- Create `.github/workflows/ui-tests.yml`.
- Enable `workflow_dispatch` for manual/API triggering.
- Create a GitHub PAT with `repo` and `workflow` permissions.
- Configure the token in OpenClaw.
- Write a trigger script for GitHub Actions.
- Connect the Feishu bot to OpenClaw.
- Use a fixed Feishu command format.
- Return the GitHub Actions run link to Feishu.

### Phase 2: Improvements

- Poll GitHub Actions execution status.
- Send success/failure updates to Feishu.
- Upload UI test reports as GitHub Actions artifacts.
- Add screenshots or logs for failed tests.
- Use Feishu message cards for clearer result display.

## Recommended Command Format

```text
@OpenClaw UI 自动化助手 /run-ui-test main contracts
```

When OpenClaw parsing is enabled, natural language can also be used:

```text
帮我跑一下 main 分支的 UI 自动化冒烟测试
```

## Recommended Repository Structure

```text
.
├── .github/
│   └── workflows/
│       └── ui-tests.yml
├── scripts/
│   ├── feishu-bridge.js
│   └── trigger-ui-tests.js
└── README.md
```
