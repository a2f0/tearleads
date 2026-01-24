#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --filter @rapid/api exec tsx "$ROOT_DIR/packages/api/src/apiCli.ts" migrate "$@"
