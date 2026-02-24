#!/bin/sh
set -eu

REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

echo "Flushing all Redis keys at ${REDIS_URL}..."

if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -u "${REDIS_URL}" FLUSHALL
elif command -v docker >/dev/null 2>&1; then
  docker_redis_url=$(printf '%s\n' "${REDIS_URL}" | sed 's/localhost/host.docker.internal/; s/127\.0\.0\.1/host.docker.internal/')
  docker run --rm --add-host=host.docker.internal:host-gateway redis:alpine redis-cli -u "${docker_redis_url}" FLUSHALL
else
  echo "redis-cli is not installed and Docker is not available." >&2
  exit 1
fi

echo "Redis reset complete."
