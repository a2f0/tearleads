#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
COMPOSE_FILE="${ROOT_DIR}/scripts/dev/garage/docker-compose.yml"
GARAGE_RPC_SECRET="${GARAGE_RPC_SECRET:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
GARAGE_ADMIN_TOKEN="${GARAGE_ADMIN_TOKEN:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"

export GARAGE_RPC_SECRET
export GARAGE_ADMIN_TOKEN

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose -f "${COMPOSE_FILE}" down
  exit 0
fi

if command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f "${COMPOSE_FILE}" down
  exit 0
fi

echo "Docker Compose is required (docker compose or docker-compose)." >&2
exit 1
