#!/bin/sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"

echo "=== Resetting Postgres ==="
"$SCRIPT_DIR/postgres/reset.sh" "$@"

echo ""
echo "=== Resetting Redis ==="
"$SCRIPT_DIR/redis/reset.sh"

echo ""
echo "Full reset complete."
