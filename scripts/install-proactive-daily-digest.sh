#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="openclaw-proactive-daily-digest"
PROJECT_DIR="/opt/OpenclawHomework"
NODE_BIN="/usr/bin/node"
ENV_FILE="/etc/openclaw-feishu-bridge.env"
STATE_FILE="/var/lib/openclaw-homework/proactive-daily-digest-state.json"
ON_CALENDAR="*-*-* 08:30:00"
RECIPIENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-name) UNIT_NAME="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --state-file) STATE_FILE="$2"; shift 2 ;;
    --on-calendar) ON_CALENDAR="$2"; shift 2 ;;
    --to) RECIPIENT="$2"; shift 2 ;;
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

if [[ ! -f "${PROJECT_DIR}/scripts/proactive-daily-digest.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/proactive-daily-digest.js" >&2
  exit 1
fi

mkdir -p "$(dirname "${STATE_FILE}")"

EXTRA_ARGS=()
if [[ -n "${RECIPIENT}" ]]; then
  EXTRA_ARGS+=(--to "${RECIPIENT}")
fi

cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=OpenclawHomework proactive daily digest
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/proactive-daily-digest.js --once --env-file ${ENV_FILE} --state-file ${STATE_FILE}${RECIPIENT:+ --to ${RECIPIENT}}
EOF

cat > "/etc/systemd/system/${UNIT_NAME}.timer" <<EOF
[Unit]
Description=Run OpenclawHomework proactive daily digest

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
