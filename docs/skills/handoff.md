# Handoff Skill

Purpose: help a new AI or developer safely take over OpenclawHomework.

First checks:
```powershell
git status --short --branch
npm test
```

Server checks:
```bash
cd /opt/OpenclawHomework
git log --oneline -5
systemctl is-active openclaw-feishu-bridge
systemctl is-active hermes-feishu-bridge
curl -sS http://127.0.0.1:8788/health
```

Rules:
- Do not reset or revert user changes without explicit permission.
- Do not print secrets.
- Add tests before behavior changes.
