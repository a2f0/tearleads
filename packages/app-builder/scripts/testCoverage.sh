#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "--" ]; then
  shift
fi

if command -v bun >/dev/null 2>&1; then
  bun test --coverage src/generators/theme.test.ts src/generators/utils.test.ts "$@"
else
  sh ../../scripts/tooling/pm.sh -w exec vitest run --coverage packages/app-builder/src/generators/theme.test.ts packages/app-builder/src/generators/utils.test.ts "$@"
fi
