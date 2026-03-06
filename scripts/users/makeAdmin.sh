#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PM_SCRIPT="$ROOT_DIR/scripts/tooling/pm.sh"
API_CLI="$ROOT_DIR/packages/api/src/apiCli.ts"

if [[ ${#} -eq 0 ]]; then
  sh "$PM_SCRIPT" exec tsx "$API_CLI" make-admin --help
  exit 0
fi

if [[ "${1-}" != -* ]]; then
  set -- --email "$@"
fi

exec sh "$PM_SCRIPT" exec tsx "$API_CLI" make-admin "$@"
