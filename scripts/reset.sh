#!/bin/sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"

echo "=== Resetting Postgres ==="
"$SCRIPT_DIR/postgres/reset.sh" "$@"

if [ -f "$SCRIPT_DIR/localstack/reset.sh" ]; then
  echo ""
  echo "=== Resetting Local S3 ==="
  "$SCRIPT_DIR/localstack/reset.sh"
fi

echo ""
echo "=== Resetting Redis ==="
"$SCRIPT_DIR/redis/reset.sh"

echo ""
echo "Full reset complete."
