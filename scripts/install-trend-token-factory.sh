#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="hermes-trend-token-factory"
PROJECT_DIR="/opt/OpenclawHomework"
NODE_BIN="/usr/bin/node"
ENV_FILE="/etc/hermes-feishu-bridge.env"
STATE_DIR="/var/lib/openclaw-homework/trend-token-factory"
OUTPUT_DIR="/var/lib/openclaw-homework/trend-token-factory/output"
ON_CALENDAR="*-*-* 02:10:00"
BATCH_SIZE="24"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-name) UNIT_NAME="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --on-calendar) ON_CALENDAR="$2"; shift 2 ;;
    --batch-size) BATCH_SIZE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/scripts/trend-intel.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/trend-intel.js" >&2
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/scripts/trend-token-factory.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/trend-token-factory.js" >&2
  exit 1
fi

mkdir -p "${STATE_DIR}" "${OUTPUT_DIR}"

cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=OpenclawHomework trend token factory
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${ENV_FILE}
Environment=TREND_INTEL_OUTPUT_FILE=${STATE_DIR}/latest-trend-intel.json
Environment=TREND_INTEL_INPUT_FILE=${STATE_DIR}/latest-trend-intel.json
Environment=TREND_TOKEN_FACTORY_OUTPUT_DIR=${OUTPUT_DIR}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/trend-intel.js
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/trend-token-factory.js --batch-size ${BATCH_SIZE} --email
EOF

cat > "/etc/systemd/system/${UNIT_NAME}.timer" <<EOF
[Unit]
Description=Run OpenclawHomework trend token factory

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
