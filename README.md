# OpenClaw GitHub UI Automation Homework

## Project Goal

Use Feishu + OpenClaw to trigger GitHub Actions remotely, run UI automation tests, and return the execution result link.

## Minimum Demo Flow

1. Send a command in Feishu.
2. OpenClaw receives and parses the command.
3. OpenClaw calls the GitHub API.
4. GitHub Actions runs UI automation tests.
5. Feishu receives the workflow result link.

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
@龙虾 触发UI测试 仓库=my-app 环境=staging
```

## Recommended Repository Structure

```text
.
├── .github/
│   └── workflows/
│       └── ui-tests.yml
├── scripts/
│   └── trigger-ui-tests.js
└── README.md
```

