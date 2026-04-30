# Runbook Notes

## Local Checks

```powershell
npm test
git diff --check
git status --short --branch
```

## Server Checks

```bash
systemctl is-active openclaw-feishu-bridge
systemctl is-active hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
systemctl list-timers '*homework-watchdog*' --no-pager
```

## Safety Boundary

Feishu commands may inspect service health and recent logs through whitelisted helpers only. They must not run arbitrary shell or print secrets.
