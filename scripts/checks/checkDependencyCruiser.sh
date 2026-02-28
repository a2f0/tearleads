#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"

MODE="${1:-}"

if [ "$MODE" = "--json" ]; then
  exec pnpm exec depcruise --config .dependency-cruiser.json --output-type json packages
fi

if [ "$MODE" = "--dot" ]; then
  exec pnpm exec depcruise --config .dependency-cruiser.json --output-type dot packages
fi

exec pnpm exec depcruise --config .dependency-cruiser.json packages
