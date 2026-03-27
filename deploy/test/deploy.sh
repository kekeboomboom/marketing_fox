#!/bin/sh
set -eu

APP_DIR="${MARKETING_FOX_APP_DIR:-/srv/marketing_fox-test}"
ENV_FILE="${MARKETING_FOX_ENV_FILE:-.env.test}"
COMPOSE_FILE="${MARKETING_FOX_COMPOSE_FILE:-compose.test.yml}"

require_file() {
  if [ ! -f "$1" ]; then
    echo "Missing required file: $1" >&2
    exit 2
  fi
}

have() {
  command -v "$1" >/dev/null 2>&1
}

http_get_ok() {
  url="$1"
  if have curl; then
    curl -fsS "$url" >/dev/null
    return 0
  fi
  if have wget; then
    wget -qO- "$url" >/dev/null
    return 0
  fi
  echo "Need curl or wget for health checks." >&2
  return 1
}

echo "Deploying marketing_fox test stack from: $APP_DIR"
cd "$APP_DIR"

require_file "$COMPOSE_FILE"
require_file "$ENV_FILE"

# shellcheck disable=SC1090
. "./$ENV_FILE"

runtime_dir="${MARKETING_FOX_RUNTIME_DIR:-./runtime}"
mkdir -p \
  "$runtime_dir/service-data" \
  "$runtime_dir/artifacts" \
  "$runtime_dir/xhs-profile"

if [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  echo "Logging into GHCR as $GHCR_USERNAME (token provided via env)."
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
else
  echo "Skipping GHCR login (set GHCR_USERNAME and GHCR_TOKEN if needed)."
fi

echo "Pulling images."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull

echo "Starting services."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo "Stack status:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

backend_port="${MARKETING_FOX_BACKEND_PORT:-20001}"
frontend_port="${MARKETING_FOX_FRONTEND_PORT:-20000}"

echo "Health checks:"
http_get_ok "http://127.0.0.1:${backend_port}/api/v1/health"
http_get_ok "http://127.0.0.1:${frontend_port}/xhs"
echo "OK"

if [ "${NGINX_RELOAD:-0}" = "1" ]; then
  echo "NGINX_RELOAD=1 requested."
  if have nginx; then
    nginx -t
  fi
  if have systemctl; then
    systemctl reload nginx
  else
    echo "systemctl not found; reload Nginx manually." >&2
  fi
fi
