#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="openclaw-token-factory-worker"
PROJECT_DIR="/opt/OpenclawHomework"
NODE_BIN="/usr/bin/node"
ENV_FILE="/etc/openclaw-feishu-bridge.env"
TIMER_INTERVAL="1min"
STALE_MS="1800000"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-name) UNIT_NAME="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --timer-interval) TIMER_INTERVAL="$2"; shift 2 ;;
    --stale-ms) STALE_MS="$2"; shift 2 ;;
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

if [[ ! -f "${PROJECT_DIR}/scripts/token-factory-worker.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/token-factory-worker.js" >&2
  exit 1
fi

cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=OpenclawHomework token-factory recovery worker
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/token-factory-worker.js --once --stale-ms ${STALE_MS}
EOF

cat > "/etc/systemd/system/${UNIT_NAME}.timer" <<EOF
[Unit]
Description=Run OpenclawHomework token-factory recovery worker

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
