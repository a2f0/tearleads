#!/usr/bin/env sh

set -eu

REPO_ROOT=$(git rev-parse --show-toplevel)

cd "$REPO_ROOT"

if [ "$#" -eq 0 ]; then
  set -- --from-upstream
fi

exec bun scripts/lintSourceShape.ts --file-limits-only "$@"
