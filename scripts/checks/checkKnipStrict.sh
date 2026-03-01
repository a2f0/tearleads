#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"

MODE="${1:-}"

if [ "$MODE" = "--json" ]; then
  pnpm exec knip --config knip.ts --strict --tsConfig tsconfig.json --include dependencies,unlisted,unresolved,binaries,catalog --exclude files,exports,nsExports,types,nsTypes,classMembers,enumMembers,duplicates --reporter json \
    | pnpm exec tsx scripts/checks/knipStrictSummary.ts --json
  exit 0
fi

pnpm exec knip --config knip.ts --strict --tsConfig tsconfig.json --include dependencies,unlisted,unresolved,binaries,catalog --exclude files,exports,nsExports,types,nsTypes,classMembers,enumMembers,duplicates --reporter json \
  | pnpm exec tsx scripts/checks/knipStrictSummary.ts
