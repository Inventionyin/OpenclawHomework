#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="hermes-world-news-monitor"
PROJECT_DIR="/opt/OpenclawHomework"
NODE_BIN="/usr/bin/node"
ENV_FILE="/etc/hermes-feishu-bridge.env"
OUTPUT_FILE="/var/lib/openclaw-homework/world-news-latest.json"
ON_CALENDAR="*-*-* 09:10:00,15:10:00,21:10:00"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-name) UNIT_NAME="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --output-file) OUTPUT_FILE="$2"; shift 2 ;;
    --on-calendar) ON_CALENDAR="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/scripts/world-news-monitor.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/world-news-monitor.js" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_FILE}")"

cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=OpenclawHomework world news monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/world-news-monitor.js --env-file ${ENV_FILE} --output-file ${OUTPUT_FILE}
EOF

cat > "/etc/systemd/system/${UNIT_NAME}.timer" <<EOF
[Unit]
Description=Run OpenclawHomework world news monitor three times daily

[Timer]
OnCalendar=${ON_CALENDAR}
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${UNIT_NAME}.timer"
systemctl status "${UNIT_NAME}.timer" --no-pager -l
