#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "scripts/apply.sh now maps to scripts/apply01.sh (Terraform infrastructure step)."
exec "$SCRIPT_DIR/apply01.sh" "$@"
