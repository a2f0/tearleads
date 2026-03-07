#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "--" ]; then
  shift
fi

has_worker_flag=0
for arg in "$@"; do
  case "$arg" in
    --concurrency=*|--concurrency|--max-concurrency=*|--max-concurrency|--max-workers=*|--max-workers|--maxWorkers=*|--maxWorkers)
      has_worker_flag=1
      break
      ;;
  esac
done

if command -v bun >/dev/null 2>&1; then
  runner_bin='bun'
  runner_subcommand='test'
  default_worker_flag='--concurrency'
else
  runner_bin='vitest'
  runner_subcommand='run'
  default_worker_flag='--max-workers'
fi

if [ "$has_worker_flag" -eq 1 ]; then
  "$runner_bin" "$runner_subcommand" --coverage "$@"
else
  "$runner_bin" "$runner_subcommand" --coverage "${default_worker_flag}=${PRE_PUSH_MAX_WORKERS:-${PRE_PUSH_VITEST_MAX_WORKERS:-4}}" "$@"
fi
