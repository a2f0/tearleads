#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "--" ]; then
  shift
fi

if command -v bun >/dev/null 2>&1; then
  bun test --coverage --concurrency="${PRE_PUSH_MAX_WORKERS:-${PRE_PUSH_VITEST_MAX_WORKERS:-4}}" "$@"
else
  vitest run --coverage --max-workers="${PRE_PUSH_MAX_WORKERS:-${PRE_PUSH_VITEST_MAX_WORKERS:-4}}" "$@"
fi
