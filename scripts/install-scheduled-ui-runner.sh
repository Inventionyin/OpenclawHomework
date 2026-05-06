#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="openclaw-scheduled-ui-runner"
PROJECT_DIR="/opt/OpenclawHomework"
NODE_BIN="/usr/bin/node"
ENV_FILE="/etc/openclaw-feishu-bridge.env"
STATE_FILE="/var/lib/openclaw-homework/scheduled-ui-runner-state.json"
ON_CALENDAR="*-*-* 00:10:00"
RUN_MODE="contracts"
MAILBOX_ACTION="report"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-name) UNIT_NAME="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --state-file) STATE_FILE="$2"; shift 2 ;;
    --on-calendar) ON_CALENDAR="$2"; shift 2 ;;
    --run-mode) RUN_MODE="$2"; shift 2 ;;
    --mailbox-action) MAILBOX_ACTION="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/scripts/scheduled-ui-runner.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/scheduled-ui-runner.js" >&2
  exit 1
fi

mkdir -p "$(dirname "${STATE_FILE}")"

cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=OpenclawHomework scheduled UI automation runner
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/scheduled-ui-runner.js --env-file ${ENV_FILE} --state-file ${STATE_FILE} --run-mode ${RUN_MODE} --mailbox-action ${MAILBOX_ACTION}
EOF

cat > "/etc/systemd/system/${UNIT_NAME}.timer" <<EOF
[Unit]
Description=Run OpenclawHomework scheduled UI automation runner

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
