#!/usr/bin/env bash
set -euo pipefail

ROLE=""
MODE="leader"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/consolidate-production-timers.sh --role hermes|openclaw [--mode leader|standby] [--dry-run]

Keeps the production schedule simple:
- leader:  enable <role>-daily-agent-pipeline.timer and <role>-homework-watchdog.timer
- standby: enable <role>-homework-watchdog.timer only
- disabled: duplicate digest/token/ui standalone timers

This script only changes systemd timer enablement. It does not edit env files or secrets.
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

case "${ROLE}" in
  hermes|openclaw) ;;
  *)
    echo "Missing or invalid --role. Use hermes or openclaw." >&2
    exit 2
    ;;
esac

case "${MODE}" in
  leader|standby) ;;
  *)
    echo "Missing or invalid --mode. Use leader or standby." >&2
    exit 2
    ;;
esac

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

DAILY_TIMER="${ROLE}-daily-agent-pipeline.timer"
WATCHDOG_TIMER="${ROLE}-homework-watchdog.timer"

ENABLE_UNITS=("${DAILY_TIMER}" "${WATCHDOG_TIMER}")
DISABLE_UNITS=(
  "${ROLE}-proactive-daily-digest.timer"
  "${ROLE}-trend-token-factory.timer"
  "${ROLE}-scheduled-token-lab.timer"
  "${ROLE}-scheduled-ui-runner.timer"
  "${ROLE}-token-factory-worker.timer"
)

if [[ "${MODE}" == "standby" ]]; then
  ENABLE_UNITS=("${WATCHDOG_TIMER}")
  DISABLE_UNITS+=("${DAILY_TIMER}")
fi

if [[ "${ROLE}" == "openclaw" ]]; then
  DISABLE_UNITS+=("openclaw-hermes-watchdog.timer")
fi

run_systemctl() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    printf '[dry-run] systemctl'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  systemctl "$@"
}

timer_exists() {
  systemctl list-unit-files "$1" --no-legend --no-pager 2>/dev/null | grep -q "^$1"
}

run_systemctl daemon-reload

for unit in "${DISABLE_UNITS[@]}"; do
  if timer_exists "${unit}"; then
    run_systemctl disable --now "${unit}"
  else
    echo "skip missing ${unit}"
  fi
done

for unit in "${ENABLE_UNITS[@]}"; do
  if timer_exists "${unit}"; then
    run_systemctl enable --now "${unit}"
  else
    echo "warn missing ${unit}" >&2
  fi
done

systemctl list-timers --all | grep -E "(${ROLE}-(daily-agent-pipeline|homework-watchdog|proactive-daily-digest|trend-token-factory|scheduled-token-lab|scheduled-ui-runner|token-factory-worker)|openclaw-hermes-watchdog)" || true
