# Server Ops Skill

Purpose: answer safe operational status questions for the two bridge servers.

Allowed commands:
- `/status`
- `/health`
- `/watchdog`
- `/logs`

Allowed checks:
- bridge service active state
- local `/health`
- watchdog timer active state
- recent journal summary without secrets
- current git commit

Forbidden:
- arbitrary shell
- reading secret env values
- deleting files
- changing SSH, firewall, Nginx, or systemd from chat
