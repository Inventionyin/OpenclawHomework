#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="hermes-proactive-thinker"
PROJECT_DIR="/opt/OpenclawHomework"
NODE_BIN="/usr/bin/node"
ENV_FILE="/etc/hermes-feishu-bridge.env"
OUTPUT_DIR="/var/lib/openclaw-homework/proactive-thinker"
ON_CALENDAR="*-*-* 10:30:00,*-*-* 22:30:00"
EMAIL_MODE="--email"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-name) UNIT_NAME="$2"; shift 2 ;;
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --on-calendar) ON_CALENDAR="$2"; shift 2 ;;
    --email) EMAIL_MODE="--email"; shift ;;
    --no-email) EMAIL_MODE="--no-email"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/scripts/proactive-thinker.js" ]]; then
  echo "Missing ${PROJECT_DIR}/scripts/proactive-thinker.js" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"

ON_CALENDAR_LINES=""
IFS=',' read -r -a ON_CALENDAR_ENTRIES <<< "${ON_CALENDAR}"
for ENTRY in "${ON_CALENDAR_ENTRIES[@]}"; do
  ENTRY="${ENTRY#"${ENTRY%%[![:space:]]*}"}"
  ENTRY="${ENTRY%"${ENTRY##*[![:space:]]}"}"
  if [[ -n "${ENTRY}" ]]; then
    ON_CALENDAR_LINES+="OnCalendar=${ENTRY}"$'\n'
  fi
done

if [[ -z "${ON_CALENDAR_LINES}" ]]; then
  echo "Missing --on-calendar value." >&2
  exit 2
fi

cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=OpenclawHomework Hermes proactive thinker
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/scripts/proactive-thinker.js ${EMAIL_MODE} --output-dir ${OUTPUT_DIR}
EOF

cat > "/etc/systemd/system/${UNIT_NAME}.timer" <<EOF
[Unit]
Description=Run OpenclawHomework Hermes proactive thinker

[Timer]
${ON_CALENDAR_LINES}AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${UNIT_NAME}.timer"
systemctl status "${UNIT_NAME}.timer" --no-pager -l
