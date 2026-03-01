#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"

MODE="${1:-}"

if [ "$MODE" = "--json" ]; then
  exec pnpm exec depcruise --config .dependency-cruiser.json --output-type json packages
fi

if [ "$MODE" = "--dot" ]; then
  exec pnpm exec depcruise --config .dependency-cruiser.json --output-type dot packages
fi

if [ "$MODE" = "--summary" ]; then
  pnpm exec depcruise --config .dependency-cruiser.json --output-type json packages \
    | pnpm exec tsx scripts/checks/dependencyCruiserSummary.ts
  exit 0
fi

if [ "$MODE" = "--summary-json" ]; then
  pnpm exec depcruise --config .dependency-cruiser.json --output-type json packages \
    | pnpm exec tsx scripts/checks/dependencyCruiserSummary.ts --json
  exit 0
fi

exec pnpm exec depcruise --config .dependency-cruiser.json packages
