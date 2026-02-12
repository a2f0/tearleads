#!/bin/sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"

pnpm --filter @tearleads/api exec tsx "$ROOT_DIR/packages/api/src/apiCli.ts" migrate "$@"
