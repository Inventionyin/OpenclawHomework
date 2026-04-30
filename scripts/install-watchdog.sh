#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="openclaw-homework-watchdog"
BRIDGE_SERVICE="openclaw-feishu-bridge"
PROJECT_DIR="/opt/OpenclawHomework"
NODE_BIN="/usr/bin/node"
ENV_FILE="/etc/openclaw-feishu-bridge.env"
HEALTH_URL="http://127.0.0.1:8788/health"
ACCESS_LOG="/var/log/nginx/access.log"
STATE_FILE="/var/lib/openclaw-homework-watchdog/state.json"
WINDOW_MINUTES="10"
POST_THRESHOLD="30"
NON_200_THRESHOLD="1"
ALERT_COOLDOWN_MINUTES="60"
TIMER_INTERVAL="5min"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-name) UNIT_NAME="$2"; shift 2 ;;
    --bridge-service) BRIDGE_SERVICE="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    --access-log) ACCESS_LOG="$2"; shift 2 ;;
    --state-file) STATE_FILE="$2"; shift 2 ;;
    --window-minutes) WINDOW_MINUTES="$2"; shift 2 ;;
    --post-threshold) POST_THRESHOLD="$2"; shift 2 ;;
    --non-200-threshold) NON_200_THRESHOLD="$2"; shift 2 ;;
    --alert-cooldown-minutes) ALERT_COOLDOWN_MINUTES="$2"; shift 2 ;;
    --timer-interval) TIMER_INTERVAL="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/scripts/server-watchdog.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/server-watchdog.js" >&2
  exit 1
fi

mkdir -p "$(dirname "${STATE_FILE}")"

cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=OpenclawHomework Feishu bridge watchdog
After=network-online.target nginx.service ${BRIDGE_SERVICE}.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/server-watchdog.js --service ${BRIDGE_SERVICE} --env-file ${ENV_FILE} --health-url ${HEALTH_URL} --access-log ${ACCESS_LOG} --state-file ${STATE_FILE} --window-minutes ${WINDOW_MINUTES} --post-threshold ${POST_THRESHOLD} --non-200-threshold ${NON_200_THRESHOLD} --alert-cooldown-minutes ${ALERT_COOLDOWN_MINUTES}
EOF

cat > "/etc/systemd/system/${UNIT_NAME}.timer" <<EOF
[Unit]
Description=Run OpenclawHomework Feishu bridge watchdog

[Timer]
OnBootSec=2min
OnUnitActiveSec=${TIMER_INTERVAL}
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${UNIT_NAME}.timer"
systemctl start "${UNIT_NAME}.service"
systemctl status "${UNIT_NAME}.timer" --no-pager -l
