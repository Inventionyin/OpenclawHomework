#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root."
  exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-/opt/OpenclawHomework}"
SERVICE_NAME="${SERVICE_NAME:-openclaw-ecosystem-maintenance}"
ENV_FILE="${ENV_FILE:-/etc/openclaw-feishu-bridge.env}"
TIMER_ON_CALENDAR="${TIMER_ON_CALENDAR:-03:20}"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=OpenClaw/Hermes ecosystem maintenance
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${ENV_FILE}
ExecStart=/usr/bin/env node ${PROJECT_DIR}/scripts/ecosystem-manager.js --maintenance
User=root
EOF

cat > "/etc/systemd/system/${SERVICE_NAME}.timer" <<EOF
[Unit]
Description=Run OpenClaw/Hermes ecosystem maintenance daily

[Timer]
OnCalendar=*-*-* ${TIMER_ON_CALENDAR}:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.timer"
systemctl list-timers "${SERVICE_NAME}.timer" --no-pager
