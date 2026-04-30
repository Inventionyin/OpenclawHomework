# Server Ops Skill

Purpose: answer safe operational status questions for the two bridge servers.

Allowed commands:
- `/status`
- `/health`
- `/watchdog`
- `/logs`
- `/peer-status`
- `/peer-health`
- `/peer-logs`
- `/peer-restart`
- `/peer-repair`

Allowed checks:
- bridge service active state
- local `/health`
- watchdog timer active state
- recent journal summary without secrets
- current git commit
- peer server status through restricted SSH forced command
- peer bridge restart
- peer code repair: `git pull --ff-only`, `npm test`, restart bridge service

Forbidden:
- arbitrary shell
- reading secret env values
- deleting files
- changing SSH, firewall, Nginx, or systemd from chat except restarting the configured peer bridge service through the forced command

Peer repair model:
- OpenClaw can operate only the Hermes peer-control whitelist.
- Hermes can operate only the OpenClaw peer-control whitelist.
- The SSH key on each side is restricted by `authorized_keys command=...`; even if chat asks for shell, the remote side runs only `scripts/peer-control.js`.
- `/peer-repair` is intentionally stronger than `/peer-restart`: it pulls the current GitHub code, runs tests, and restarts the peer bridge. Use it for broken bridge deployments, not for arbitrary server administration.
