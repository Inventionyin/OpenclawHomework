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
- [OpenClaw 讯飞 CodingPlan 模型接入说明](docs/OpenClaw讯飞CodingPlan模型接入说明.md)

## Minimum Demo Flow

1. Send a command in Feishu.
2. The webhook bridge parses the command, optionally using OpenClaw for natural language.
3. The bridge calls the GitHub API.
4. GitHub Actions runs UI automation tests.
5. The bridge can poll the workflow run and send the final result back to Feishu.

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
