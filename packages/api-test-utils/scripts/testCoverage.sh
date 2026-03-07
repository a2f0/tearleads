#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "--" ]; then
  shift
fi

has_worker_flag=0
for arg in "$@"; do
  case "$arg" in
    --max-concurrency=*|--max-concurrency|--max-workers=*|--max-workers|--maxWorkers=*|--maxWorkers)
      has_worker_flag=1
      break
      ;;
  esac
done

if command -v bun >/dev/null 2>&1; then
  if [ "$has_worker_flag" -eq 1 ]; then
    bun test --coverage "$@"
  else
    bun test --coverage --max-concurrency="${PRE_PUSH_VITEST_MAX_WORKERS:-4}" "$@"
  fi
else
  if [ "$has_worker_flag" -eq 1 ]; then
    vitest run --coverage "$@"
  else
    vitest run --coverage --max-workers="${PRE_PUSH_VITEST_MAX_WORKERS:-4}" "$@"
  fi
fi
