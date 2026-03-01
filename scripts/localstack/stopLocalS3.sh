#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"
COMPOSE_FILE="${ROOT_DIR}/scripts/localstack/docker-compose.yml"

compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  echo "Docker Compose is required (docker compose or docker-compose)." >&2
  exit 1
}

compose_cmd -f "${COMPOSE_FILE}" down
