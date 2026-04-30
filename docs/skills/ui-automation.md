# UI Automation Skill

Purpose: trigger and explain GitHub Actions UI automation for OpenclawHomework.

Allowed user commands:
- `/run-ui-test main smoke`
- `/run-ui-test main contracts`
- `帮我跑一下 main 分支的 UI 自动化冒烟测试`

Run modes:
- `contracts`: fastest contract/basic checks
- `smoke`: main user-flow smoke checks
- `all`: broader UI automation

Safety:
- Only bound/authorized users may trigger tests.
- Never expose GitHub tokens.
- Return GitHub Actions and Allure artifact links when available.
