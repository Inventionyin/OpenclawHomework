#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="hermes-clawemail-inbox-notifier"
PROJECT_DIR="/opt/OpenclawHomework"
NODE_BIN="/usr/bin/node"
ENV_FILE="/etc/hermes-feishu-bridge.env"
STATE_FILE="/var/lib/openclaw-homework/clawemail-inbox-state.json"
INTERVAL_MS="60000"
MAILBOX=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-name) UNIT_NAME="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --state-file) STATE_FILE="$2"; shift 2 ;;
    --interval-ms) INTERVAL_MS="$2"; shift 2 ;;
    --mailbox) MAILBOX="$2"; shift 2 ;;
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

if [[ ! -f "${PROJECT_DIR}/scripts/clawemail-inbox-notifier.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/clawemail-inbox-notifier.js" >&2
  exit 1
fi

mkdir -p "$(dirname "${STATE_FILE}")"

mailbox_arg=""
if [[ -n "${MAILBOX}" ]]; then
  mailbox_arg=" --mailbox ${MAILBOX}"
fi

cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=OpenclawHomework ClawEmail inbox notifier
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/clawemail-inbox-notifier.js --env-file ${ENV_FILE} --state-file ${STATE_FILE} --interval-ms ${INTERVAL_MS}${mailbox_arg}
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${UNIT_NAME}"
systemctl status "${UNIT_NAME}" --no-pager -l
