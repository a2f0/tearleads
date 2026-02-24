#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ ${#} -eq 0 ]]; then
  pnpm --filter @tearleads/api exec tsx "$ROOT_DIR/packages/api/src/apiCli.ts" make-admin --help
  exit 0
fi

if [[ "${1-}" != -* ]]; then
  set -- --email "$@"
fi

exec pnpm --filter @tearleads/api exec tsx "$ROOT_DIR/packages/api/src/apiCli.ts" make-admin "$@"
