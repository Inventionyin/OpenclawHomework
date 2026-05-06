#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="hermes-scheduled-token-lab"
PROJECT_DIR="/opt/OpenclawHomework"
NODE_BIN="/usr/bin/node"
ENV_FILE="/etc/hermes-feishu-bridge.env"
STATE_FILE="/var/lib/openclaw-homework/scheduled-token-lab-state.json"
ON_CALENDAR="*-*-* 01:20:00"
BATCH_SIZE="16"
OUTPUT_DIR="/opt/OpenclawHomework/data/qa-token-lab/scheduled"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-name) UNIT_NAME="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --state-file) STATE_FILE="$2"; shift 2 ;;
    --on-calendar) ON_CALENDAR="$2"; shift 2 ;;
    --batch-size) BATCH_SIZE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/scripts/scheduled-token-lab.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/scheduled-token-lab.js" >&2
  exit 1
fi

mkdir -p "$(dirname "${STATE_FILE}")" "${OUTPUT_DIR}"

cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=OpenclawHomework scheduled QA token lab
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/scheduled-token-lab.js --env-file ${ENV_FILE} --state-file ${STATE_FILE} --batch-size ${BATCH_SIZE} --output-dir ${OUTPUT_DIR}
EOF

cat > "/etc/systemd/system/${UNIT_NAME}.timer" <<EOF
[Unit]
Description=Run OpenclawHomework scheduled QA token lab

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
