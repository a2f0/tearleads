#!/bin/sh
set -eu

REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

echo "Flushing all Redis keys at ${REDIS_URL}..."

if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -u "${REDIS_URL}" FLUSHALL
else
  echo "redis-cli is not installed." >&2
  exit 1
fi

echo "Redis reset complete."
