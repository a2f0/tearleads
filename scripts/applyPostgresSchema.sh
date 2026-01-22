#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/packages/api/scripts/applyPostgresSchema.ts"

pnpm --filter @rapid/api exec tsx "$SCRIPT_PATH" "$@"
