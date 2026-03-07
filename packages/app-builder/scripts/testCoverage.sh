#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "--" ]; then
  shift
fi

if command -v bun >/dev/null 2>&1; then
  bun test --coverage src/generators/*.test.ts "$@"
else
  sh ../../scripts/tooling/pm.sh -w exec vitest run --coverage packages/app-builder/src/generators/*.test.ts "$@"
fi
