#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root."
  exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-/opt/OpenclawHomework}"
SERVICE_NAME="${SERVICE_NAME:-hermes-feishu-bridge}"
ENV_FILE="${ENV_FILE:-/etc/hermes-feishu-bridge.env}"
APP_PORT="${APP_PORT:-8788}"
DOMAIN_NAME="${DOMAIN_NAME:-hermes.evanshine.me}"
GITHUB_REPO_URL="${GITHUB_REPO_URL:-https://github.com/Inventionyin/OpenclawHomework.git}"

install_base_packages() {
  apt-get update
  apt-get install -y curl ca-certificates gnupg git nginx python3-certbot-nginx
}

install_nodejs() {
  if command -v node >/dev/null 2>&1; then
    return
  fi

  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
}

clone_or_update_repo() {
  if [[ -d "${PROJECT_DIR}/.git" ]]; then
    git -C "${PROJECT_DIR}" fetch origin main
    git -C "${PROJECT_DIR}" merge --ff-only origin/main
    return
  fi

  rm -rf "${PROJECT_DIR}"
  git clone "${GITHUB_REPO_URL}" "${PROJECT_DIR}"
}

install_dependencies() {
  cd "${PROJECT_DIR}"
  npm install
}

install_hermes_agent() {
  local hermes_dir="${HERMES_AGENT_DIR:-/usr/local/lib/hermes-agent}"
  local hermes_repo="${HERMES_AGENT_REPO:-https://github.com/NousResearch/hermes-agent.git}"
  local hermes_ref="${HERMES_AGENT_REF:-58a6171bfb0ba2ca10b1b08854511736cd77a623}"

  apt-get install -y build-essential python3 python3-venv

  if [[ ! -d "${hermes_dir}/.git" ]]; then
    rm -rf "${hermes_dir}"
    git clone "${hermes_repo}" "${hermes_dir}"
  fi

  git -C "${hermes_dir}" fetch origin
  git -C "${hermes_dir}" checkout "${hermes_ref}"
  git -C "${hermes_dir}" submodule update --init --recursive || true

  cd "${hermes_dir}"
  printf 'n\nn\n' | timeout 900 bash setup-hermes.sh || true
  if [[ ! -x "${hermes_dir}/venv/bin/hermes" ]]; then
    echo "Hermes CLI was not installed successfully."
    exit 1
  fi
  ln -sfn "${hermes_dir}/venv/bin/hermes" /usr/local/bin/hermes
}

write_env_template() {
  if [[ -f "${ENV_FILE}" ]]; then
    return
  fi

  cat > "${ENV_FILE}" <<EOF
PORT=${APP_PORT}
GITHUB_OWNER=Inventionyin
GITHUB_REPO=OpenclawHomework
GITHUB_WORKFLOW_ID=ui-tests.yml
GITHUB_REF_NAME=main
UI_TEST_RUN_MODE=contracts
UI_TEST_TARGET_REPOSITORY=Inventionyin/UItest
UI_TEST_TARGET_REF=main
UI_TEST_BASE_URL=http://127.0.0.1:5173

GITHUB_TOKEN=__FILL_ME__

OPENCLAW_PARSE_ENABLED=true
OPENCLAW_CHAT_ENABLED=true
OPENCLAW_MODEL=xfyun/astron-code-latest

HERMES_FALLBACK_ENABLED=false
HERMES_BIN=/usr/local/bin/hermes
HERMES_PROVIDER=custom
HERMES_MODEL=LongCat-Flash-Chat
HERMES_PARSE_TIMEOUT_MS=90000
HERMES_CHAT_TIMEOUT_MS=90000

FEISHU_CHAT_STREAMING_ENABLED=true
STREAMING_MODEL_BASE_URL=https://api.longcat.chat/openai/v1
STREAMING_MODEL_API_KEY=__FILL_LONGCAT_API_KEY__
STREAMING_MODEL_ID=LongCat-Flash-Chat
STREAMING_MODEL_ENDPOINT_MODE=chat_completions

FEISHU_RESULT_NOTIFY_ENABLED=true
FEISHU_WEBHOOK_ASYNC=true
FEISHU_CARD_ENABLED=true
FEISHU_REQUIRE_BINDING=true
FEISHU_AUTOMATION_RECEIPT_ENABLED=true
FEISHU_DEDUP_ENABLED=true
FEISHU_DEDUP_TTL_MS=300000
FEISHU_RUN_NOTIFICATION_DEDUP_TTL_MS=300000
FEISHU_GROUP_PASSIVE_REPLY_ENABLED=false
FEISHU_ENV_FILE=${ENV_FILE}

FEISHU_APP_ID=__FILL_HERMES_APP_ID__
FEISHU_APP_SECRET=__FILL_HERMES_APP_SECRET__
FEISHU_ALLOWED_USER_IDS=

HERMES_FEISHU_APP_ID=__FILL_HERMES_APP_ID__
HERMES_FEISHU_APP_SECRET=__FILL_HERMES_APP_SECRET__
HERMES_FEISHU_ALLOWED_USER_IDS=
EOF

  chmod 600 "${ENV_FILE}"
}

write_systemd_service() {
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Hermes Feishu Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/env node ${PROJECT_DIR}/scripts/feishu-bridge.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
}

write_nginx_site() {
  cat > "/etc/nginx/sites-available/${SERVICE_NAME}" <<EOF
server {
    server_name ${DOMAIN_NAME};

    location = /health {
        proxy_pass http://127.0.0.1:${APP_PORT}/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /webhook/feishu {
        proxy_pass http://127.0.0.1:${APP_PORT}/webhook/feishu/hermes;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    listen 80;
    listen [::]:80;
}
EOF

  ln -sfn "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
  nginx -t
  systemctl reload nginx
}

start_service() {
  systemctl restart "${SERVICE_NAME}"
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
}

print_next_steps() {
  cat <<EOF
Hermes host base install complete.

Next steps:
1. Edit ${ENV_FILE} and fill in:
   - GITHUB_TOKEN
   - FEISHU_APP_ID / FEISHU_APP_SECRET
   - HERMES_FEISHU_APP_ID / HERMES_FEISHU_APP_SECRET
   - STREAMING_MODEL_API_KEY (LongCat)
2. Make sure DNS A record points ${DOMAIN_NAME} to this server.
3. Run:
   certbot --nginx -d ${DOMAIN_NAME}
4. Restart service:
   systemctl restart ${SERVICE_NAME}
5. Verify:
   curl -sS http://127.0.0.1:${APP_PORT}/health
   curl -sS https://${DOMAIN_NAME}/health
EOF
}

install_base_packages
install_nodejs
clone_or_update_repo
install_dependencies
install_hermes_agent
write_env_template
write_systemd_service
write_nginx_site
start_service
print_next_steps
