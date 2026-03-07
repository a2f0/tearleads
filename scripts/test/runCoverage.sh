#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "--" ]; then
  shift
fi

if command -v bun >/dev/null 2>&1; then
  runner_bin='bun'
  runner_subcommand='test'
  canonical_worker_flag='--concurrency'
else
  runner_bin='vitest'
  runner_subcommand='run'
  canonical_worker_flag='--max-workers'
fi

has_worker_flag=0
normalized_args=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      ;;
    --concurrency=*|--max-concurrency=*|--max-workers=*|--maxWorkers=*)
      has_worker_flag=1
      value=${1#*=}
      normalized_args="${normalized_args} ${canonical_worker_flag}=${value}"
      ;;
    --concurrency|--max-concurrency|--max-workers|--maxWorkers)
      has_worker_flag=1
      shift
      if [ "$#" -eq 0 ]; then
        normalized_args="${normalized_args} ${canonical_worker_flag}"
        break
      fi
      normalized_args="${normalized_args} ${canonical_worker_flag}=$1"
      ;;
    *)
      normalized_args="${normalized_args} $1"
      ;;
  esac
  shift
done

# shellcheck disable=SC2086
set -- $normalized_args

if [ "$has_worker_flag" -eq 1 ]; then
  "$runner_bin" "$runner_subcommand" --coverage "$@"
else
  "$runner_bin" "$runner_subcommand" --coverage "${canonical_worker_flag}=${PRE_PUSH_MAX_WORKERS:-${PRE_PUSH_VITEST_MAX_WORKERS:-4}}" "$@"
fi
